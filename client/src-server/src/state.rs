use std::sync::Arc;

use crate::events::EventBus;
use crate::jukebox::JukeboxStore;

#[derive(Clone)]
pub struct AppState {
    pub events: Arc<EventBus>,
    pub jukebox: Arc<JukeboxStore>,
}

impl AppState {
    pub fn new() -> Self {
        let config = app_core::AppConfig::load();
        Self {
            events: Arc::new(EventBus::new()),
            jukebox: Arc::new(JukeboxStore::new(
                config.karaoke_enabled(),
                config.karaoke_pin(),
                config.karaoke_allow_guest_controls(),
                config.guide_volume.unwrap_or(0.3),
            )),
        }
    }
}
