use serde_json::{Value, json};

use crate::error::NightingaleError;

const DEFAULT_DOWNTIFY_BASE_URL: &str = "http://karaoke.local:8000";

fn normalized_base_url(base_url: Option<&str>) -> String {
    let raw = base_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_DOWNTIFY_BASE_URL);
    raw.trim_end_matches('/').to_string()
}

pub fn load_queue(base_url: Option<&str>) -> Result<Vec<Value>, NightingaleError> {
    let endpoint = format!("{}/api/queue", normalized_base_url(base_url));
    let resp = ureq::get(&endpoint)
        .call()
        .map_err(|e| NightingaleError::Other(format!("Downtify queue failed: {e}")))?;

    resp.into_body()
        .read_json()
        .map_err(|e| NightingaleError::Other(format!("Downtify queue parse failed: {e}")))
}

fn song_identity(song: &Value) -> Option<String> {
    let obj = song.as_object()?;
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

pub fn search_songs(query: &str, base_url: Option<&str>) -> Result<Vec<Value>, NightingaleError> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let endpoint = format!("{}/api/songs/search", normalized_base_url(base_url));
    let resp = ureq::get(&endpoint)
        .query("query", query)
        .call()
        .map_err(|e| NightingaleError::Other(format!("Downtify search failed: {e}")))?;

    resp.into_body()
        .read_json()
        .map_err(|e| NightingaleError::Other(format!("Downtify search parse failed: {e}")))
}

pub fn queue_download(song: Value, base_url: Option<&str>) -> Result<(), NightingaleError> {
    let incoming_identity = song_identity(&song);
    if let Some(incoming_identity) = incoming_identity.as_deref() {
        let queue = load_queue(base_url)?;
        for entry in queue {
            let Some(obj) = entry.as_object() else {
                continue;
            };
            let status = obj.get("status").and_then(Value::as_str).unwrap_or_default();
            if status == "error" {
                continue;
            }
            let Some(existing_song) = obj.get("song") else {
                continue;
            };
            if song_identity(existing_song).as_deref() == Some(incoming_identity) {
                return Err(NightingaleError::Other(
                    "This song is already in the Downtify queue".to_string(),
                ));
            }
        }
    }

    let endpoint = format!("{}/api/download/batch", normalized_base_url(base_url));
    let payload = json!({
        "songs": [song],
        "generate_m3u": false,
    });

    ureq::post(&endpoint)
        .header("Content-Type", "application/json")
        .send_json(payload)
        .map_err(|e| NightingaleError::Other(format!("Downtify queue failed: {e}")))?;

    Ok(())
}
