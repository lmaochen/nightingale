use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::sync::RwLock;

pub type ClientId = u64;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub fn next_client_id() -> ClientId {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

/// Single shared playback state for the jukebox session. The server is the
/// source of truth; every browser sees the same snapshot rebroadcast over WS.
#[derive(Clone, Debug, Serialize)]
pub struct JukeboxState {
    pub karaoke_enabled: bool,
    pub session_pin: String,
    pub participants: Vec<JukeboxParticipant>,
    pub queue: Vec<JukeboxQueueItem>,
    pub next_queue_item_id: u64,
    pub allow_guest_controls: bool,
    pub current_song: Option<String>,
    pub paused: bool,
    pub position_ms: u64,
    pub guide_volume: f64,
    pub mic_monitoring: bool,
    pub pitch_hz: Option<f32>,
    pub rms: Option<f32>,
    pub mic_owner: Option<ClientId>,
    pub controller: Option<ClientId>,
    pub host: Option<ClientId>,
    pub theme: Option<usize>,
    pub score: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JukeboxRole {
    Host,
    Guest,
}

#[derive(Clone, Debug, Serialize)]
pub struct JukeboxParticipant {
    pub client_id: ClientId,
    pub display_name: String,
    pub role: JukeboxRole,
    pub joined_at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct JukeboxQueueItem {
    pub id: u64,
    pub title: String,
    pub artist: String,
    pub requested_by_client_id: ClientId,
    pub requested_by_display_name: String,
    pub added_at_ms: u64,
    pub song: serde_json::Value,
}

impl JukeboxState {
    pub fn new(karaoke_enabled: bool, session_pin: String, allow_guest_controls: bool) -> Self {
        Self {
            karaoke_enabled,
            session_pin,
            participants: Vec::new(),
            queue: Vec::new(),
            next_queue_item_id: 1,
            allow_guest_controls,
            current_song: None,
            paused: false,
            position_ms: 0,
            guide_volume: 0.3,
            mic_monitoring: false,
            pitch_hz: None,
            rms: None,
            mic_owner: None,
            controller: None,
            host: None,
            theme: None,
            score: 0,
        }
    }
}

pub struct JukeboxStore {
    state: RwLock<JukeboxState>,
}

impl Default for JukeboxStore {
    fn default() -> Self {
        Self::new(true, "0000".to_string(), true)
    }
}

impl JukeboxStore {
    pub fn new(karaoke_enabled: bool, session_pin: String, allow_guest_controls: bool) -> Self {
        Self {
            state: RwLock::new(JukeboxState::new(
                karaoke_enabled,
                session_pin,
                allow_guest_controls,
            )),
        }
    }

    pub async fn snapshot(&self) -> JukeboxState {
        self.state.read().await.clone()
    }

    pub async fn mutate<F>(&self, f: F) -> JukeboxState
    where
        F: FnOnce(&mut JukeboxState),
    {
        let mut guard = self.state.write().await;
        f(&mut guard);
        guard.clone()
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
