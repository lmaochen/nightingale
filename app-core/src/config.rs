use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cache::config_path;
use crate::secret;

/// Where the user wants Nightingale to source songs from. Persisted in
/// `config.json` and consumed by both the scanner and the analyzer.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum LibrarySource {
    Folder {
        path: PathBuf,
    },
    Jellyfin {
        base_url: String,
        user_id: String,
        username: String,
        /// Access token returned by `/Users/AuthenticateByName`. At rest in
        /// `config.json` this value is an encrypted envelope; in-memory and
        /// over IPC it's the plaintext token. See `secret.rs` for the on-disk
        /// format + migration semantics.
        access_token: String,
        /// Stable per-install identifier we hand to Jellyfin in the
        /// `X-Emby-Authorization` header. Generated once at connect time.
        device_id: String,
    },
    Navidrome {
        base_url: String,
        username: String,
        /// Subsonic user password. Same secret-at-rest envelope as the
        /// Jellyfin `access_token` (encrypted in `config.json`, plaintext
        /// in-memory). Required at request time because the Subsonic auth
        /// token is `MD5(password + salt)` with a fresh salt per call.
        password: String,
    },
}

impl LibrarySource {
    /// Apply `transform` to every credential field that lives in the
    /// secret-at-rest envelope (Jellyfin's access token, Navidrome's
    /// password). New remote sources that carry secrets must extend this
    /// match.
    fn map_secret(self, transform: impl FnOnce(&str) -> String) -> Self {
        match self {
            Self::Folder { path } => Self::Folder { path },
            Self::Jellyfin {
                base_url,
                user_id,
                username,
                access_token,
                device_id,
            } => Self::Jellyfin {
                base_url,
                user_id,
                username,
                access_token: transform(&access_token),
                device_id,
            },
            Self::Navidrome {
                base_url,
                username,
                password,
            } => Self::Navidrome {
                base_url,
                username,
                password: transform(&password),
            },
        }
    }
}

/// Vertical anchor for the lyrics during playback. Persisted globally so the
/// choice applies to every song rather than per-track.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum LyricsPosition {
    Top,
    Center,
    #[default]
    Bottom,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AppConfig {
    #[serde(default = "default_data_path_option")]
    pub data_path: Option<PathBuf>,
    /// Deprecated. Kept for one-shot migration into `library_source`; never
    /// written by code that has been through `with_defaults`.
    pub last_folder: Option<PathBuf>,
    #[serde(default)]
    pub library_source: Option<LibrarySource>,
    pub last_theme: Option<usize>,
    pub guide_volume: Option<f64>,
    pub fullscreen: Option<bool>,
    pub dark_mode: Option<bool>,
    pub mic_active: Option<bool>,
    /// `serde(alias = "mic_mirroring")` keeps configs written by builds that
    /// called this feature "mic mirroring" loading without a manual migration;
    /// the next `save` rewrites them under the new name.
    #[serde(alias = "mic_mirroring")]
    pub mic_monitoring: Option<bool>,
    #[serde(alias = "mic_mirror_gain")]
    pub mic_monitor_gain: Option<f64>,
    pub preferred_mic: Option<String>,
    pub whisper_model: Option<String>,
    pub beam_size: Option<u32>,
    pub batch_size: Option<u32>,
    pub last_video_flavor: Option<usize>,
    pub separator: Option<String>,
    pub asr_engine: Option<String>,
    pub language_overrides: Option<HashMap<String, String>>,
    /// Enables host/guest karaoke session mode in the web UI.
    pub karaoke_enabled: Option<bool>,
    /// Join code guests must enter on their phones.
    pub karaoke_pin: Option<String>,
    /// Default display name for the host controller.
    pub karaoke_display_name: Option<String>,
    /// Whether non-host guests can use playback/settings/admin controls.
    pub karaoke_allow_guest_controls: Option<bool>,
    /// Base URL for the local Downtify instance used by "Request Song".
    pub downtify_base_url: Option<String>,
    /// Periodically trigger a background library rescan. `None`/`0` disables
    /// automatic rescans.
    pub auto_rescan_seconds: Option<u64>,
    /// Automatically enqueue newly discovered songs/videos for analysis right
    /// after each completed scan.
    pub auto_analyze_new_content: Option<bool>,
    /// Vertical anchor for lyrics during playback (top / center / bottom).
    pub lyrics_position: Option<LyricsPosition>,
    /// Multiplier applied to the lyrics font size; `1.0` is the default size.
    pub lyrics_font_scale: Option<f64>,
    /// Reduce visual rendering cost on low-power devices.
    pub playback_performance_mode: Option<bool>,
    /// Show the pitch graph overlay during playback.
    pub playback_show_pitch_graph: Option<bool>,
    /// Whether animated/moving playback backgrounds are enabled.
    pub playback_moving_backgrounds: Option<bool>,
    /// Audio decode strategy for playback: `client_mp3` (default) or
    /// `server_pcm` (serve WAV stems when available).
    pub playback_audio_decode_mode: Option<String>,
    /// Enable host-side queue prewarm decode cache for faster transitions.
    pub playback_warmup_cache_enabled: Option<bool>,
    /// Keep a small sticky in-memory predecode buffer for smoother transitions.
    pub playback_sticky_predecode: Option<bool>,
    /// Start playback after instrumental decode and attach vocals when ready.
    pub playback_fast_start_instrumental_first: Option<bool>,
}

fn default_data_path_option() -> Option<PathBuf> {
    Some(AppConfig::default_data_path())
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            data_path: default_data_path_option(),
            last_folder: None,
            library_source: None,
            last_theme: None,
            guide_volume: None,
            fullscreen: None,
            dark_mode: None,
            mic_active: None,
            mic_monitoring: None,
            mic_monitor_gain: None,
            preferred_mic: None,
            whisper_model: None,
            beam_size: None,
            batch_size: None,
            last_video_flavor: None,
            separator: None,
            asr_engine: None,
            language_overrides: None,
            karaoke_enabled: None,
            karaoke_pin: None,
            karaoke_display_name: None,
            karaoke_allow_guest_controls: None,
            downtify_base_url: None,
            auto_rescan_seconds: None,
            auto_analyze_new_content: None,
            lyrics_position: None,
            lyrics_font_scale: None,
            playback_performance_mode: None,
            playback_show_pitch_graph: None,
            playback_moving_backgrounds: None,
            playback_audio_decode_mode: None,
            playback_warmup_cache_enabled: None,
            playback_sticky_predecode: None,
            playback_fast_start_instrumental_first: None,
        }
    }
}

impl AppConfig {
    pub fn default_data_path() -> PathBuf {
        crate::cache::default_nightingale_dir()
    }

    pub fn effective_data_path(&self) -> PathBuf {
        self.data_path
            .clone()
            .unwrap_or_else(Self::default_data_path)
    }

    fn with_defaults(mut self) -> Self {
        if self.data_path.is_none() {
            self.data_path = Some(Self::default_data_path());
        }
        // One-shot promotion of the legacy `last_folder` field into the new
        // `library_source` enum so old installs keep scanning the same folder.
        if self.library_source.is_none() {
            if let Some(path) = self.last_folder.take() {
                self.library_source = Some(LibrarySource::Folder { path });
            }
        }
        self
    }

    /// Pre-Jellyfin builds never wrote `last_folder` — the chosen folder lived
    /// only in `library_meta.folder` inside the DB. Recover it here so users
    /// upgrading with a pre-existing library don't lose their source (and the
    /// Rescan button doesn't get stuck disabled).
    fn migrate_from_library_db(&mut self) -> bool {
        if self.library_source.is_some() {
            return false;
        }

        let Ok((folder, count)) = crate::library_db::read_library_meta() else {
            return false;
        };

        if folder.is_empty() {
            return false;
        }

        let path = PathBuf::from(folder);
        if count == 0 || !path.is_dir() {
            return false;
        }

        self.library_source = Some(LibrarySource::Folder { path });

        true
    }

    pub fn load() -> Self {
        let path = config_path();

        let loaded = if path.is_file() {
            std::fs::read_to_string(&path).ok().and_then(|s| {
                let has_library_source_key = serde_json::from_str::<serde_json::Value>(&s)
                    .ok()
                    .and_then(|value| {
                        value
                            .as_object()
                            .map(|obj| obj.contains_key("library_source"))
                    })
                    .unwrap_or(false);

                serde_json::from_str::<Self>(&s)
                    .ok()
                    .map(|config| (config, has_library_source_key))
            })
        } else {
            None
        };

        let (mut config, mut should_save, allow_db_source_migration) = match loaded {
            Some((mut cfg, has_library_source_key)) => {
                let had_data_path = cfg.data_path.is_some();
                let had_library_source = cfg.library_source.is_some();
                let had_legacy_folder = cfg.last_folder.is_some();
                let had_plaintext_secret = cfg
                    .library_source
                    .as_ref()
                    .is_some_and(has_plaintext_secret);
                let needs_save = !had_data_path
                    || (!had_library_source && had_legacy_folder)
                    || had_plaintext_secret;
                if let Some(src) = cfg.library_source.take() {
                    cfg.library_source = Some(src.map_secret(secret::decrypt_string));
                }
                (cfg.with_defaults(), needs_save, !has_library_source_key)
            }
            None => (Self::default().with_defaults(), true, false),
        };

        if allow_db_source_migration && config.migrate_from_library_db() {
            should_save = true;
        }

        if should_save {
            config.save();
        }

        config
    }

    pub fn save(&self) {
        let path = config_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut for_disk = self.clone();
        if let Some(src) = for_disk.library_source.take() {
            for_disk.library_source = Some(src.map_secret(secret::encrypt_string));
        }
        if let Ok(json) = serde_json::to_string_pretty(&for_disk) {
            let _ = std::fs::write(&path, json);
        }
    }

    pub fn whisper_model(&self) -> &str {
        self.whisper_model.as_deref().unwrap_or("large-v3")
    }

    pub fn beam_size(&self) -> u32 {
        self.beam_size.unwrap_or(8)
    }

    pub fn batch_size(&self) -> u32 {
        self.batch_size.unwrap_or(8)
    }

    pub fn separator(&self) -> &str {
        self.separator.as_deref().unwrap_or("karaoke")
    }

    pub fn asr_engine(&self) -> &str {
        self.asr_engine.as_deref().unwrap_or("whisper")
    }

    pub fn mic_monitor_gain(&self) -> f32 {
        self.mic_monitor_gain
            .map(|v| v as f32)
            .unwrap_or(0.65)
            .clamp(0.0, 2.0)
    }

    pub fn language_override(&self, file_hash: &str) -> Option<&str> {
        self.language_overrides
            .as_ref()
            .and_then(|m| m.get(file_hash))
            .map(|s| s.as_str())
    }

    pub fn auto_rescan_seconds(&self) -> Option<u64> {
        self.auto_rescan_seconds
            .and_then(|seconds| {
                if seconds == 0 {
                    None
                } else {
                    Some(seconds)
                }
            })
            .map(|seconds| seconds.clamp(5, 86_400))
    }

    pub fn auto_analyze_new_content(&self) -> bool {
        self.auto_analyze_new_content.unwrap_or(false)
    }

    pub fn karaoke_enabled(&self) -> bool {
        self.karaoke_enabled.unwrap_or(true)
    }

    pub fn karaoke_pin(&self) -> String {
        self.karaoke_pin
            .as_deref()
            .map(str::trim)
            .filter(|pin| !pin.is_empty())
            .unwrap_or("1234")
            .to_string()
    }

    pub fn karaoke_display_name(&self) -> String {
        self.karaoke_display_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or("Host")
            .to_string()
    }

    pub fn karaoke_allow_guest_controls(&self) -> bool {
        self.karaoke_allow_guest_controls.unwrap_or(true)
    }

    pub fn playback_performance_mode(&self) -> bool {
        self.playback_performance_mode.unwrap_or(false)
    }

    pub fn playback_show_pitch_graph(&self) -> bool {
        self.playback_show_pitch_graph.unwrap_or(true)
    }

    pub fn playback_audio_decode_mode(&self) -> &str {
        match self
            .playback_audio_decode_mode
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            Some("server_pcm") => "server_pcm",
            _ => "client_mp3",
        }
    }

    pub fn playback_warmup_cache_enabled(&self) -> bool {
        self.playback_warmup_cache_enabled.unwrap_or(true)
    }

    pub fn playback_sticky_predecode(&self) -> bool {
        self.playback_sticky_predecode.unwrap_or(false)
    }

    pub fn playback_fast_start_instrumental_first(&self) -> bool {
        self.playback_fast_start_instrumental_first.unwrap_or(false)
    }

    pub fn set_language_override(&mut self, file_hash: String, lang: String) {
        self.language_overrides
            .get_or_insert_with(HashMap::new)
            .insert(file_hash, lang);
    }
}

/// Detects credentials still sitting on disk in plaintext (older builds or a
/// hand-edited `config.json`). `load` uses this to know whether to re-save
/// after decrypting, so the next write re-wraps the secret in the at-rest
/// envelope. Any new remote source that persists a secret must extend this.
fn has_plaintext_secret(src: &LibrarySource) -> bool {
    let secret = match src {
        LibrarySource::Folder { .. } => return false,
        LibrarySource::Jellyfin { access_token, .. } => access_token,
        LibrarySource::Navidrome { password, .. } => password,
    };
    !secret.is_empty() && !secret::is_encrypted(secret)
}
