//! Source-agnostic scan dispatcher. The actual file walking lives in
//! `source::folder`; Jellyfin lives in `source::jellyfin`. This module owns:
//!  - resolving the configured `LibrarySource` and instantiating the right adapter
//!  - bumping the cancellation generation
//!  - spawning the scan thread
//!  - exposing `SongsStore` load/load_meta entry points used by the bridge

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tracing::{info, warn};

use crate::{
    analyzer,
    cache::CacheDir,
    config::AppConfig,
    library_db,
    library_model::{LibraryMenuFilters, LoadSongsParams, SongsMeta, SongsStore},
    analyzer::enqueue_one,
    source::{ScanContext, active_source_from_config},
};

static AUTO_RESCAN_LOOP_STARTED: AtomicBool = AtomicBool::new(false);
static DOWNTIFY_QUEUE_LOOP_STARTED: AtomicBool = AtomicBool::new(false);

impl SongsStore {
    pub fn load_all() -> Self {
        let processed = library_db::load_all_songs().unwrap_or_default();
        let (folder, count) = library_db::read_library_meta().unwrap_or((String::new(), 0));
        let processed_count = processed.len();
        SongsStore {
            count,
            folder,
            processed,
            processed_count,
        }
    }

    pub fn load(params: &LoadSongsParams) -> Self {
        library_db::load_songs_page(params).unwrap_or_else(|_| SongsStore {
            count: 0,
            folder: String::new(),
            processed: Vec::new(),
            processed_count: 0,
        })
    }

    pub fn load_meta() -> SongsMeta {
        library_db::load_meta_sql().unwrap_or_default()
    }
}

/// Trigger a scan using whatever `LibrarySource` is currently configured.
/// Returns immediately; the scan runs on a background thread.
pub fn start_scan() {
    let scan_generation = library_db::bump_scan_generation();
    let before_hashes = library_db::load_song_hash_strings().unwrap_or_default();

    let source = match active_source_from_config(&AppConfig::load()) {
        Ok(Some(s)) => s,
        Ok(None) => {
            warn!("[scanner] No library source configured; ignoring scan request");
            return;
        }
        Err(e) => {
            warn!("[scanner] Failed to instantiate library source: {e}");
            return;
        }
    };

    // If the active source's identity changed (folder → Jellyfin, different
    // Jellyfin server, different folder path) the rows already in the DB
    // belong to a different library and would otherwise stick around — each
    // source's per-scan pruning only touches its own rows. Wipe everything
    // up front so the upcoming scan starts from a clean slate.
    let new_label = source.label();
    let (existing_label, _) = library_db::read_library_meta().unwrap_or_default();
    if existing_label != new_label {
        let _ = library_db::replace_all_songs_sorted(&[]);
        let _ = library_db::analysis_queue_clear();
        let _ = library_db::update_library_meta(&new_label, 0);
    }

    std::thread::spawn(move || {
        let cache = CacheDir::new();
        let ctx = ScanContext {
            generation: scan_generation,
            cache: &cache,
        };
        if let Err(e) = source.scan(&ctx) {
            warn!("[scanner] Scan failed: {e}");
            return;
        }

        if !library_db::scan_generation_is_current(scan_generation) {
            return;
        }

        let config = AppConfig::load();
        if config.auto_analyze() {
            analyzer::enqueue_all(&LibraryMenuFilters::default());
        }

        if !config.auto_analyze_new_content() {
            return;
        }

        let after_hashes = library_db::load_song_hash_strings().unwrap_or_default();
        let mut newly_discovered: Vec<String> = after_hashes
            .difference(&before_hashes)
            .cloned()
            .collect();
        newly_discovered.sort_unstable();

        if !newly_discovered.is_empty() {
            info!(
                "[scanner] Auto-enqueueing {} newly discovered item(s) for analysis",
                newly_discovered.len()
            );
            for file_hash in newly_discovered {
                enqueue_one(&file_hash);
            }
        }
    });
}

/// Background supervisor that checks `AppConfig.auto_rescan_seconds` and
/// periodically triggers scans when enabled. Runs in both desktop and web
/// server mode because both call `app_core::startup()`.
pub fn ensure_auto_rescan_loop() {
    if AUTO_RESCAN_LOOP_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    std::thread::spawn(|| {
        let mut next_due: Option<Instant> = None;

        loop {
            let config = AppConfig::load();
            let maybe_interval = config.auto_rescan_seconds().map(Duration::from_secs);

            let Some(interval) = maybe_interval else {
                next_due = None;
                std::thread::sleep(Duration::from_secs(2));
                continue;
            };

            let now = Instant::now();
            if next_due.is_none() {
                next_due = Some(now + interval);
            }

            let due_at = next_due.expect("next_due set above");
            if now < due_at {
                let wait = (due_at - now).min(Duration::from_secs(2));
                std::thread::sleep(wait);
                continue;
            }

            let meta = SongsStore::load_meta();
            if meta.processed_count < meta.count {
                // A scan is still running (or was just triggered). Delay a bit
                // so auto-rescan doesn't immediately cancel the in-flight scan
                // by bumping generation again.
                next_due = Some(now + Duration::from_secs(5));
                continue;
            }

            start_scan();
            next_due = Some(now + interval);
        }
    });
}

/// Watches Downtify's queue endpoint and triggers an immediate rescan when its
/// active download queue transitions from non-empty to empty.
pub fn ensure_downtify_queue_loop() {
    if DOWNTIFY_QUEUE_LOOP_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    std::thread::spawn(|| {
        let mut previously_active = false;

        loop {
            let config = AppConfig::load();
            let queue = match crate::downtify::load_queue(config.downtify_base_url.as_deref()) {
                Ok(queue) => queue,
                Err(_) => {
                    // Downtify may be offline; retry quietly.
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };

            let active_now = queue.iter().any(|entry| {
                entry
                    .as_object()
                    .and_then(|obj| obj.get("status"))
                    .and_then(|status| status.as_str())
                    .is_some_and(|status| status == "queued" || status == "downloading")
            });

            if previously_active && !active_now {
                info!("[scanner] Downtify queue drained; triggering immediate rescan");
                start_scan();
            }

            previously_active = active_now;
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}
