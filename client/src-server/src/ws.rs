use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::events::EventEnvelope;
use crate::jukebox::{
    ClientId, JukeboxParticipant, JukeboxQueueItem, JukeboxRole, JukeboxState, next_client_id,
    now_ms,
};
use crate::state::AppState;

pub async fn handle_upgrade(
    State(state): State<AppState>,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    upgrade.on_upgrade(move |socket| run(state, socket))
}

async fn run(state: AppState, socket: WebSocket) {
    let client_id = next_client_id();
    tracing::debug!(%client_id, "ws connected");

    let (mut sender, mut receiver) = socket.split();
    let mut events = state.events.subscribe();

    // Tell the client its session id, then snapshot current session state so it
    // can render immediately.
    if let Ok(text) = serde_json::to_string(&EventEnvelope {
        r#type: "jukebox.client".to_string(),
        payload: json!({ "clientId": client_id }),
    }) {
        let _ = sender.send(Message::Text(text)).await;
    }
    if let Ok(text) = serde_json::to_string(&EventEnvelope {
        r#type: "jukebox.session".to_string(),
        payload: serde_json::to_value(state.jukebox.snapshot().await).unwrap_or(Value::Null),
    }) {
        let _ = sender.send(Message::Text(text)).await;
    }
    // Backward compatibility for existing listeners.
    if let Ok(text) = serde_json::to_string(&EventEnvelope {
        r#type: "jukebox".to_string(),
        payload: serde_json::to_value(state.jukebox.snapshot().await).unwrap_or(Value::Null),
    }) {
        let _ = sender.send(Message::Text(text)).await;
    }

    let outbound = {
        let mut sender = sender;
        async move {
            loop {
                match events.recv().await {
                    Ok(envelope) => {
                        let Ok(text) = serde_json::to_string(&envelope) else {
                            continue;
                        };
                        if sender.send(Message::Text(text)).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        // Slow consumer: drop the backlog and keep the socket
                        // alive rather than disconnecting.
                        tracing::warn!(%client_id, %skipped, "ws lagged behind broadcast");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    };

    let inbound = {
        let state = state.clone();
        async move {
            while let Some(msg) = receiver.next().await {
                let Ok(msg) = msg else { break };
                if let Message::Text(text) = msg {
                    handle_client_message(&state, client_id, &text).await;
                } else if let Message::Close(_) = msg {
                    break;
                }
            }
        }
    };

    tokio::select! {
        _ = outbound => {},
        _ = inbound => {},
    }

    // Release any session-scoped state the client owned.
    let next = state
        .jukebox
        .mutate(|s| {
            s.participants.retain(|p| p.client_id != client_id);
            if s.mic_owner == Some(client_id) {
                s.mic_owner = None;
            }
            if s.controller == Some(client_id) {
                s.controller = None;
            }
            if s.host == Some(client_id) {
                s.host = None;
            }
        })
        .await;
    broadcast_jukebox(&state, &next);

    tracing::debug!(%client_id, "ws disconnected");
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ClientFrame {
    #[serde(rename = "jukebox.claim_mic")]
    ClaimMic,
    #[serde(rename = "jukebox.release_mic")]
    ReleaseMic,
    #[serde(rename = "jukebox.set")]
    Set {
        #[serde(default)]
        force: bool,
        #[serde(flatten)]
        patch: JukeboxPatch,
    },
    #[serde(rename = "jukebox.pitch")]
    Pitch {
        #[serde(default)]
        hz: Option<f32>,
        #[serde(default)]
        rms: Option<f32>,
    },
    #[serde(rename = "jukebox.score")]
    Score { delta: i32 },
    #[serde(rename = "session.join")]
    SessionJoin {
        pin: String,
        display_name: String,
        #[serde(default)]
        as_host: bool,
    },
    #[serde(rename = "session.leave")]
    SessionLeave,
    #[serde(rename = "queue.add")]
    QueueAdd { song: Value },
    #[serde(rename = "queue.remove")]
    QueueRemove { id: u64 },
    #[serde(rename = "queue.reorder")]
    QueueReorder { id: u64, to_index: usize },
    #[serde(rename = "playback.patch")]
    PlaybackPatch {
        #[serde(default)]
        current_song: Option<Option<String>>,
        #[serde(default)]
        paused: Option<bool>,
        #[serde(default)]
        position_ms: Option<u64>,
    },
    #[serde(rename = "settings.patch")]
    SettingsPatch {
        #[serde(default)]
        theme: Option<Option<usize>>,
        #[serde(default)]
        guide_volume: Option<f64>,
        #[serde(default)]
        mic_monitoring: Option<bool>,
        #[serde(default)]
        allow_guest_controls: Option<bool>,
    },
    #[serde(rename = "admin.action")]
    AdminAction { action: String },
}

#[derive(Debug, Default, Deserialize)]
pub struct JukeboxPatch {
    #[serde(default)]
    current_song: Option<Option<String>>,
    #[serde(default)]
    paused: Option<bool>,
    #[serde(default)]
    position_ms: Option<u64>,
    #[serde(default)]
    theme: Option<Option<usize>>,
    #[serde(default)]
    score: Option<u32>,
}

#[derive(Debug, Serialize)]
struct DenyMessage {
    reason: &'static str,
}

fn queue_identity(song: &Value) -> Option<String> {
    let obj = song.as_object()?;
    if let Some(file_hash) = obj.get("file_hash").and_then(Value::as_str) {
        if !file_hash.trim().is_empty() {
            return Some(format!("file_hash:{}", file_hash.trim()));
        }
    }
    if let Some(song_id) = obj.get("song_id").and_then(Value::as_str) {
        if !song_id.trim().is_empty() {
            return Some(format!("song_id:{}", song_id.trim()));
        }
    }
    if let Some(url) = obj.get("url").and_then(Value::as_str) {
        if !url.trim().is_empty() {
            return Some(format!("url:{}", url.trim()));
        }
    }
    None
}

fn participant_for(state: &JukeboxState, client_id: ClientId) -> Option<&JukeboxParticipant> {
    state.participants.iter().find(|p| p.client_id == client_id)
}

fn can_control(state: &JukeboxState, client_id: ClientId) -> bool {
    if state.host == Some(client_id) {
        return true;
    }
    state.allow_guest_controls && participant_for(state, client_id).is_some()
}

fn can_admin(state: &JukeboxState, client_id: ClientId) -> bool {
    state.host == Some(client_id)
}

async fn handle_client_message(state: &AppState, client_id: ClientId, raw: &str) {
    let Ok(frame) = serde_json::from_str::<ClientFrame>(raw) else {
        tracing::trace!("dropping malformed ws frame: {raw}");
        return;
    };

    match frame {
        ClientFrame::ClaimMic => {
            let next = state
                .jukebox
                .mutate(|s| {
                    if s.mic_owner.is_none() {
                        s.mic_owner = Some(client_id);
                        if s.controller.is_none() {
                            s.controller = Some(client_id);
                        }
                    }
                })
                .await;
            if next.mic_owner != Some(client_id) {
                state.events.emit("jukebox.deny", &DenyMessage { reason: "mic-owned" });
                return;
            }
            broadcast_jukebox(state, &next);
        }
        ClientFrame::ReleaseMic => {
            let next = state
                .jukebox
                .mutate(|s| {
                    if s.mic_owner == Some(client_id) {
                        s.mic_owner = None;
                    }
                })
                .await;
            broadcast_jukebox(state, &next);
        }
        ClientFrame::Set { force, patch } => {
            let next = state
                .jukebox
                .mutate(|s| {
                    if s.controller.is_none() || force {
                        s.controller = Some(client_id);
                    }
                    if s.controller != Some(client_id) {
                        return;
                    }
                    apply_patch(s, patch);
                })
                .await;
            broadcast_jukebox(state, &next);
        }
        ClientFrame::Pitch { hz, rms } => {
            let next = state
                .jukebox
                .mutate(|s| {
                    if s.mic_owner != Some(client_id) {
                        return;
                    }
                    s.pitch_hz = hz;
                    s.rms = rms;
                })
                .await;
            broadcast_jukebox(state, &next);
        }
        ClientFrame::Score { delta } => {
            let next = state
                .jukebox
                .mutate(|s| {
                    if delta.is_negative() {
                        let mag = (-delta) as u32;
                        s.score = s.score.saturating_sub(mag);
                    } else {
                        s.score = s.score.saturating_add(delta as u32);
                    }
                })
                .await;
            broadcast_jukebox(state, &next);
        }
        ClientFrame::SessionJoin {
            pin,
            display_name,
            as_host,
        } => {
            let display_name = display_name.trim();
            if display_name.is_empty() {
                state.events.emit("jukebox.deny", &DenyMessage { reason: "name-required" });
                return;
            }

            let mut denied: Option<&'static str> = None;
            let next = state
                .jukebox
                .mutate(|s| {
                    if !s.karaoke_enabled {
                        denied = Some("karaoke-disabled");
                        return;
                    }
                    if pin.trim() != s.session_pin {
                        denied = Some("invalid-pin");
                        return;
                    }

                    if as_host && s.host.is_some() && s.host != Some(client_id) {
                        denied = Some("host-occupied");
                        return;
                    }

                    let role = if as_host {
                        JukeboxRole::Host
                    } else {
                        JukeboxRole::Guest
                    };

                    s.participants.retain(|p| p.client_id != client_id);
                    s.participants.push(JukeboxParticipant {
                        client_id,
                        display_name: display_name.to_string(),
                        role,
                        joined_at_ms: now_ms(),
                    });

                    if as_host {
                        s.host = Some(client_id);
                        s.controller = Some(client_id);
                    }
                })
                .await;

            if let Some(reason) = denied {
                state.events.emit("jukebox.deny", &DenyMessage { reason });
                return;
            }
            broadcast_jukebox(state, &next);
        }
        ClientFrame::SessionLeave => {
            let next = state
                .jukebox
                .mutate(|s| {
                    if !s.karaoke_enabled {
                        return;
                    }
                    s.participants.retain(|p| p.client_id != client_id);
                    if s.mic_owner == Some(client_id) {
                        s.mic_owner = None;
                    }
                    if s.controller == Some(client_id) {
                        s.controller = None;
                    }
                    if s.host == Some(client_id) {
                        s.host = None;
                    }
                })
                .await;
            broadcast_jukebox(state, &next);
        }
        ClientFrame::QueueAdd { song } => {
            let next = state
                .jukebox
                .mutate(|s| {
                    if !s.karaoke_enabled {
                        return;
                    }
                    let Some(participant) = participant_for(s, client_id).cloned() else {
                        return;
                    };

                    let incoming_identity = queue_identity(&song);
                    if let Some(identity) = incoming_identity {
                        let exists = s
                            .queue
                            .iter()
                            .any(|item| queue_identity(&item.song).as_deref() == Some(identity.as_str()));
                        if exists {
                            return;
                        }
                    }

                    let id = s.next_queue_item_id;
                    s.next_queue_item_id = s.next_queue_item_id.saturating_add(1);
                    let title = song
                        .get("title")
                        .and_then(Value::as_str)
                        .filter(|s| !s.trim().is_empty())
                        .or_else(|| {
                            song.get("name")
                                .and_then(Value::as_str)
                                .filter(|s| !s.trim().is_empty())
                        })
                        .unwrap_or("Unknown title")
                        .to_string();
                    let artist = song
                        .get("artist")
                        .and_then(Value::as_str)
                        .filter(|s| !s.trim().is_empty())
                        .map(|s| s.to_string())
                        .or_else(|| {
                            song.get("artists")
                                .and_then(Value::as_array)
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(Value::as_str)
                                        .filter(|s| !s.trim().is_empty())
                                        .collect::<Vec<_>>()
                                        .join(", ")
                                })
                                .filter(|s| !s.is_empty())
                        })
                        .unwrap_or_else(|| "Unknown artist".to_string());

                    s.queue.push(JukeboxQueueItem {
                        id,
                        title,
                        artist,
                        requested_by_client_id: participant.client_id,
                        requested_by_display_name: participant.display_name,
                        added_at_ms: now_ms(),
                        song,
                    });

                    if s.current_song.is_none() {
                        s.current_song = s.queue.last().map(|item| {
                            queue_identity(&item.song).unwrap_or_else(|| item.title.clone())
                        });
                        s.skip_intro_target = None;
                        s.skip_outro_target = None;
                        s.paused = false;
                        s.position_ms = 0;
                    }
                })
                .await;
            broadcast_jukebox(state, &next);
        }
        ClientFrame::QueueRemove { id } => {
            let next = state
                .jukebox
                .mutate(|s| {
                    if !s.karaoke_enabled {
                        return;
                    }
                    if can_control(s, client_id) {
                        s.queue.retain(|item| item.id != id);
                        return;
                    }
                    s.queue
                        .retain(|item| !(item.id == id && item.requested_by_client_id == client_id));
                })
                .await;
            broadcast_jukebox(state, &next);
        }
        ClientFrame::QueueReorder { id, to_index } => {
            let next = state
                .jukebox
                .mutate(|s| {
                    if !s.karaoke_enabled {
                        return;
                    }
                    if !can_control(s, client_id) || s.queue.is_empty() {
                        return;
                    }
                    let Some(from_idx) = s.queue.iter().position(|item| item.id == id) else {
                        return;
                    };
                    let item = s.queue.remove(from_idx);
                    let insert_at = to_index.min(s.queue.len());
                    s.queue.insert(insert_at, item);
                })
                .await;
            broadcast_jukebox(state, &next);
        }
        ClientFrame::PlaybackPatch {
            current_song,
            paused,
            position_ms,
        } => {
            let next = state
                .jukebox
                .mutate(|s| {
                    if !s.karaoke_enabled {
                        return;
                    }
                    if !can_control(s, client_id) {
                        return;
                    }
                    if let Some(song) = current_song {
                        s.current_song = song;
                    }
                    if let Some(paused) = paused {
                        s.paused = paused;
                    }
                    if let Some(position_ms) = position_ms {
                        s.position_ms = position_ms;
                    }
                })
                .await;
            broadcast_jukebox(state, &next);
        }
        ClientFrame::SettingsPatch {
            theme,
            guide_volume,
            mic_monitoring,
            allow_guest_controls,
        } => {
            let next = state
                .jukebox
                .mutate(|s| {
                    if !s.karaoke_enabled {
                        return;
                    }
                    if !can_control(s, client_id) {
                        return;
                    }
                    if let Some(theme) = theme {
                        s.theme = theme;
                    }
                    if let Some(guide_volume) = guide_volume {
                        s.guide_volume = guide_volume.clamp(0.0, 1.0);
                    }
                    if let Some(mic_monitoring) = mic_monitoring {
                        s.mic_monitoring = mic_monitoring;
                    }
                    if let Some(allow_guest_controls) = allow_guest_controls {
                        if can_admin(s, client_id) {
                            s.allow_guest_controls = allow_guest_controls;
                        }
                    }
                })
                .await;
            if let Some(guide_volume) = guide_volume {
                let mut config = app_core::AppConfig::load();
                config.guide_volume = Some(guide_volume.clamp(0.0, 1.0));
                config.save();
            }
            broadcast_jukebox(state, &next);
        }
        ClientFrame::AdminAction { action } => {
            let action = action.trim();
            let mut should_trigger_scan = false;
            let next = state
                .jukebox
                .mutate(|s| {
                    if !s.karaoke_enabled {
                        return;
                    }
                    match action {
                        "clear-queue" => {
                            if can_admin(s, client_id) {
                                s.queue.clear()
                            }
                        }
                        "next-song" => {
                            if !can_control(s, client_id) {
                                return;
                            }
                            if !s.queue.is_empty() {
                                let item = s.queue.remove(0);
                                s.current_song = queue_identity(&item.song).or(Some(item.title));
                                s.skip_intro_target = None;
                                s.skip_outro_target = None;
                                s.position_ms = 0;
                                s.paused = false;
                            } else {
                                s.current_song = None;
                                s.skip_intro_target = None;
                                s.skip_outro_target = None;
                            }
                        }
                        "skip-intro" => {
                            if can_control(s, client_id) {
                                if let Some(current_song) = s.current_song.clone() {
                                    s.skip_intro_target = Some(current_song);
                                    s.skip_intro_signal = s.skip_intro_signal.saturating_add(1);
                                }
                            }
                        }
                        "skip-outro" => {
                            if can_control(s, client_id) {
                                if let Some(current_song) = s.current_song.clone() {
                                    s.skip_outro_target = Some(current_song);
                                    s.skip_outro_signal = s.skip_outro_signal.saturating_add(1);
                                }
                            }
                        }
                        "rescan-library" => {
                            if can_admin(s, client_id) {
                                should_trigger_scan = true;
                            }
                        }
                        _ => {}
                    }
                })
                .await;

            if should_trigger_scan {
                app_core::start_scan();
            }
            broadcast_jukebox(state, &next);
        }
    }
}

fn apply_patch(state: &mut JukeboxState, patch: JukeboxPatch) {
    if let Some(song) = patch.current_song {
        state.current_song = song;
    }
    if let Some(paused) = patch.paused {
        state.paused = paused;
    }
    if let Some(position_ms) = patch.position_ms {
        state.position_ms = position_ms;
    }
    if let Some(theme) = patch.theme {
        state.theme = theme;
    }
    if let Some(score) = patch.score {
        state.score = score;
    }
}

fn broadcast_jukebox(state: &AppState, snapshot: &JukeboxState) {
    state.events.emit("jukebox", snapshot);
    state.events.emit("jukebox.session", snapshot);
}
