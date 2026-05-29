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
