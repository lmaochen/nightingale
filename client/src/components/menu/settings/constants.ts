import {
  DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  MAX_MIC_LATENCY_COMPENSATION_SEC,
} from "@/lib/pitch/constants";
import type { AppConfig } from "@/types/AppConfig";

export type SettingsTab = "general" | "playback" | "analysis" | "library" | "karaoke";
export type SettingsOption = { value: string; label: string; description?: string };

export const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: "general", label: "General" },
  { value: "playback", label: "Playback" },
  { value: "analysis", label: "Analysis" },
  { value: "library", label: "Library" },
  { value: "karaoke", label: "Karaoke" },
];

const TAB_COUNT = SETTINGS_TABS.length;

export const SEPARATORS: SettingsOption[] = [
  {
    value: "karaoke",
    label: "UVR Karaoke",
    description: "Usually separates more cleanly, but can occasionally slip on tricky parts.",
  },
  {
    value: "demucs",
    label: "Demucs",
    description:
      "Smoother and more consistent with fewer abrupt artifacts, though slightly less crisp overall.",
  },
];

export const ASR_ENGINES: SettingsOption[] = [
  {
    value: "whisper",
    label: "Whisper",
    description: "Works in any language and lets you pick a model size below.",
  },
  {
    value: "parakeet",
    label: "Parakeet v3 (Experimental)",
    description:
      "Much faster and produces its own word timings (skipping alignment), but only covers 25 European languages. Whisper takes over for anything else.",
  },
];

export const ALIGN_BACKENDS: SettingsOption[] = [
  {
    value: "whisperx",
    label: "WhisperX",
    description: "The reliable default, timing words with a proven decoder.",
  },
  {
    value: "ctc",
    label: "CTC Forced Alignment (Experimental)",
    description:
      "Calculates word start/end points with a different algorithm, and runs much faster on GPU and Apple Silicon. Falls back to WhisperX if a line trips it up.",
  },
  {
    value: "qwen",
    label: "Qwen Forced Alignment (Experimental)",
    description:
      "A fast AI model covering 11 languages. Timing quality varies song to song, but it can do better on Chinese, Japanese, and Korean. Falls back to WhisperX otherwise.",
  },
];

export const MODELS = ["large-v3", "large-v3-turbo", "medium", "small", "base", "tiny"];

export const LYRICS_VERTICAL_POSITIONS: SettingsOption[] = [
  { value: "bottom", label: "Bottom" },
  { value: "center", label: "Center" },
  { value: "top", label: "Top" },
];

export const LYRICS_HORIZONTAL_POSITIONS: SettingsOption[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

export const DEFAULTS = {
  separator: "karaoke",
  asr_engine: "whisper",
  align_backend: "whisperx",
  vocal_detection_threshold_pct: 0.15,
  whisper_model: "large-v3",
  beam_size: 8,
  batch_size: 8,
  mic_monitor_gain: 0.65,
  mic_latency_compensation_sec: DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  auto_analyze: false,
  lyrics_vertical_position: "bottom",
  lyrics_horizontal_position: "center",
  lyrics_font_scale: 1,
  playback_performance_mode: false,
  playback_show_pitch_graph: true,
  playback_moving_backgrounds: null,
  playback_audio_decode_mode: "client_mp3",
  playback_warmup_cache_enabled: true,
  playback_sticky_predecode: false,
  playback_fast_start_instrumental_first: false,
  auto_rescan_seconds: 0,
  auto_analyze_new_content: false,
  downtify_base_url: null,
  karaoke_enabled: null,
  karaoke_pin: null,
  karaoke_display_name: null,
  karaoke_allow_guest_controls: null,
} satisfies Pick<
  AppConfig,
  | "separator"
  | "asr_engine"
  | "align_backend"
  | "vocal_detection_threshold_pct"
  | "whisper_model"
  | "beam_size"
  | "batch_size"
  | "mic_monitor_gain"
  | "mic_latency_compensation_sec"
  | "auto_analyze"
  | "lyrics_vertical_position"
  | "lyrics_horizontal_position"
  | "lyrics_font_scale"
  | "playback_performance_mode"
  | "playback_show_pitch_graph"
  | "playback_moving_backgrounds"
  | "playback_audio_decode_mode"
  | "playback_warmup_cache_enabled"
  | "playback_sticky_predecode"
  | "playback_fast_start_instrumental_first"
  | "auto_rescan_seconds"
  | "auto_analyze_new_content"
  | "downtify_base_url"
  | "karaoke_enabled"
  | "karaoke_pin"
  | "karaoke_display_name"
  | "karaoke_allow_guest_controls"
>;

// Display fallbacks for nullable fields whose real defaults live in the backend.
export const DEFAULT_DOWNTIFY_BASE_URL = "http://karaoke.local:8000";
export const DEFAULT_KARAOKE_ENABLED = true;
export const DEFAULT_KARAOKE_PIN = "1234";
export const DEFAULT_KARAOKE_DISPLAY_NAME = "Host";
export const DEFAULT_KARAOKE_ALLOW_GUEST_CONTROLS = true;

export const MIC_MONITOR_GAIN_STEP = 0.01;
export const MIC_MONITOR_GAIN_MAX = 2;
export const MIC_LATENCY_STEP = 0.005;
export const MIC_LATENCY_MAX = MAX_MIC_LATENCY_COMPENSATION_SEC;
export const LYRICS_FONT_SCALE_MIN = 0.5;
export const LYRICS_FONT_SCALE_MAX = 2;
export const LYRICS_FONT_SCALE_STEP = 0.05;
export const AUTO_RESCAN_SECONDS_MIN = 0;
export const AUTO_RESCAN_SECONDS_MAX = 3600;
export const AUTO_RESCAN_SECONDS_STEP = 30;
// Vocal-detection threshold is stored as a fraction of peak RMS (0-1) but shown
// as a percentage. Capped at 60% since anything higher trims almost everything.
export const VOCAL_THRESHOLD_STEP = 0.01;
export const VOCAL_THRESHOLD_MIN = 0;
export const VOCAL_THRESHOLD_MAX = 0.6;
export const NUMBER_PICKER_SIZE = 16;

export const NAV = {
  tabSegment: 0,
  general: {
    window: 1,
    microphone: 2,
    micMonitorGain: 3,
    micLatency: 4,
    lyricsVerticalPosition: 5,
    lyricsHorizontalPosition: 6,
    lyricsFontScale: 7,
  },
  playback: {
    performanceMode: 1,
    pitchGraph: 2,
    movingBackgrounds: 3,
    audioDecodeMode: 4,
    warmupCache: 5,
    stickyPredecode: 6,
    fastStart: 7,
    warmStems: 8,
    warmServerPcm: 9,
  },
  library: {
    autoRescan: 1,
    autoAnalyzeNewContent: 2,
    downtifyBaseUrl: 3,
  },
  karaoke: {
    enabled: 1,
    pin: 2,
    displayName: 3,
    allowGuestControls: 4,
  },
} as const;

// The Whisper-only "Model size" + "Beam Size" fields sit right after the
// transcription model, so every later field shifts by two segments when
// Parakeet hides them. Fields that aren't rendered map to -1 so focus rings
// never match them.
export function getAnalysisNav(isParakeet: boolean) {
  return isParakeet
    ? {
        separator: 1,
        asrEngine: 2,
        whisperModel: -1,
        beamSize: -1,
        alignBackend: 3,
        autoAnalyze: 4,
        vocalThreshold: 5,
        batchSize: 6,
      }
    : {
        separator: 1,
        asrEngine: 2,
        whisperModel: 3,
        beamSize: 4,
        alignBackend: 5,
        autoAnalyze: 6,
        vocalThreshold: 7,
        batchSize: 8,
      };
}

export function getSettingsStops(tab: SettingsTab, isParakeet: boolean) {
  if (tab === "general") {
    return [TAB_COUNT, 2, 1, 1, 2, 1, 1, 1, 2];
  }

  if (tab === "playback") {
    return [TAB_COUNT, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2];
  }

  if (tab === "library") {
    return [TAB_COUNT, 1, 2, 1, 2];
  }

  if (tab === "karaoke") {
    return [TAB_COUNT, 2, 1, 1, 2, 2];
  }

  return isParakeet
    ? [TAB_COUNT, 1, 1, 1, 2, 1, NUMBER_PICKER_SIZE, 2]
    : [TAB_COUNT, 1, 1, 1, NUMBER_PICKER_SIZE, 1, 2, 1, NUMBER_PICKER_SIZE, 2];
}
