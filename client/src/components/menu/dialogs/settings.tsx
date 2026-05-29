import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useEffect, useRef, useState } from "react";
import { useDialogNav } from "@/hooks/navigation/use-dialog-nav";
import { setFullScreen, isFullScreen as tauriIsFullScreen } from "@/bridge/fullScreen";
import { getPlaybackWarmupStatus, warmServerPcmCache, warmStemsCache } from "@/bridge/playback";
import { loadSongs } from "@/bridge/songs";
import { useDialog } from "@/hooks/use-dialog";
import { useConfig } from "@/queries/use-config";
import { useConfigMutation } from "@/mutations/use-config-mutation";
import { useMicDevices } from "@/hooks/use-mic-pitch";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { LyricsPosition } from "@/types/LyricsPosition";
import { toast } from "sonner";

const SEPARATORS = [
  { value: "karaoke", label: "UVR Karaoke" },
  { value: "demucs", label: "Demucs" },
];

const LYRICS_POSITIONS: { value: LyricsPosition; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "center", label: "Center" },
  { value: "bottom", label: "Bottom" },
];

const ASR_ENGINES = [
  { value: "whisper", label: "Whisper" },
  { value: "parakeet", label: "Parakeet v3 (Experimental)" },
];

const MODELS = ["large-v3", "large-v3-turbo", "medium", "small", "base", "tiny"];

const DEFAULT_MODEL: (typeof MODELS)[number] = "large-v3";
const DEFAULT_SEPARATOR = "karaoke";
const DEFAULT_ASR_ENGINE = "whisper";

const DEFAULT_BEAM_BATCH_SIZE = 8;
const DEFAULT_MIC_MONITOR_GAIN = 0.65;
const MIC_MONITOR_GAIN_STEP = 0.01;
const MIC_MONITOR_GAIN_MAX = 2;

const DEFAULT_LYRICS_POSITION: LyricsPosition = "bottom";
const DEFAULT_LYRICS_FONT_SCALE = 1;
const LYRICS_FONT_SCALE_MIN = 0.5;
const LYRICS_FONT_SCALE_MAX = 2;
const LYRICS_FONT_SCALE_STEP = 0.05;
const DEFAULT_PLAYBACK_PERFORMANCE_MODE = false;
const DEFAULT_PLAYBACK_SHOW_PITCH_GRAPH = true;
const DEFAULT_PLAYBACK_AUDIO_DECODE_MODE = "client_mp3";
const DEFAULT_PLAYBACK_WARMUP_CACHE_ENABLED = true;
const DEFAULT_AUTO_RESCAN_SECONDS = 0;
const AUTO_RESCAN_SECONDS_MIN = 0;
const AUTO_RESCAN_SECONDS_MAX = 3600;
const AUTO_RESCAN_SECONDS_STEP = 30;
const DEFAULT_AUTO_ANALYZE_NEW_CONTENT = false;
const DEFAULT_DOWNTIFY_BASE_URL = "http://karaoke.local:8000";
const DEFAULT_KARAOKE_ENABLED = true;
const DEFAULT_KARAOKE_PIN = "1234";
const DEFAULT_KARAOKE_DISPLAY_NAME = "Host";
const DEFAULT_KARAOKE_ALLOW_GUEST_CONTROLS = true;
const WAV_STEREO_44K16_BYTES_PER_MINUTE_PER_STEM = 44_100 * 2 * 2 * 60;

const MIC_MONITOR_GAIN_SEGMENT = 2;

// The playback/tuning rows sit between Batch Size and the footer.
const SETTINGS_STOPS_WHISPER = [2, 1, 1, 1, 1, 1, 16, 16, 3, 1, 2, 2, 1, 2, 1, 1, 2, 1, 1, 2, 2];
const SETTINGS_STOPS_PARAKEET = [2, 1, 1, 1, 1, 16, 3, 1, 2, 2, 1, 2, 1, 1, 2, 1, 1, 2, 2];

const RING = "ring-2 ring-primary";
const NO_FOCUS_RING = "focus-visible:ring-0 focus-visible:border-transparent";

function formatBytesEstimate(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const fixed = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(fixed)} ${units[idx]}`;
}

function formatWarmupProgress(
  status:
    | {
        running: boolean;
        total: number;
        processed: number;
        warmed: number;
        failed: number;
        skipped: number;
      }
    | undefined,
): string {
  if (!status) return "Status unavailable";
  const total = Math.max(0, status.total);
  const processed = Math.max(0, Math.min(status.processed, total || status.processed));
  const done = total > 0 && !status.running && processed >= total;
  const prefix = status.running ? "Running" : done ? "Complete" : "Idle";
  return `${prefix}: ${processed}/${total || "?"} | warm ${status.warmed} | failed ${status.failed} | skipped ${status.skipped}`;
}

export const SettingsDialog = () => {
  const micDevices = useMicDevices();
  const { mode, close } = useDialog();
  const { data: config } = useConfig();
  const { mutate } = useConfigMutation();
  const { data: pcmEstimateSongs } = useQuery({
    queryKey: ["settings-server-pcm-estimate"],
    queryFn: async () =>
      loadSongs({
        search: null,
        filters: { artist: null, album: null, query: null },
        skip: 0,
        take: 10000,
      }),
    staleTime: 60_000,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullScreen, setIsFullScreen] = useState<boolean | null | undefined>(config?.fullscreen);

  const open = mode === "settings";
  const { data: warmupStatus } = useQuery({
    queryKey: ["playback-warmup-status"],
    queryFn: getPlaybackWarmupStatus,
    enabled: open,
    refetchInterval: (data) => {
      if (!data) return 3000;
      return data.stems.running || data.server_pcm.running ? 1000 : 3000;
    },
  });

  const micMonitorGainRef = useRef(config?.mic_monitor_gain ?? DEFAULT_MIC_MONITOR_GAIN);
  useEffect(() => {
    micMonitorGainRef.current = config?.mic_monitor_gain ?? DEFAULT_MIC_MONITOR_GAIN;
  }, [config?.mic_monitor_gain]);

  const lyricsFontScaleRef = useRef(config?.lyrics_font_scale ?? DEFAULT_LYRICS_FONT_SCALE);
  useEffect(() => {
    lyricsFontScaleRef.current = config?.lyrics_font_scale ?? DEFAULT_LYRICS_FONT_SCALE;
  }, [config?.lyrics_font_scale]);
  const autoRescanSecondsRef = useRef(config?.auto_rescan_seconds ?? DEFAULT_AUTO_RESCAN_SECONDS);
  useEffect(() => {
    autoRescanSecondsRef.current = config?.auto_rescan_seconds ?? DEFAULT_AUTO_RESCAN_SECONDS;
  }, [config?.auto_rescan_seconds]);
  const [downtifyBaseUrlDraft, setDowntifyBaseUrlDraft] = useState(
    config?.downtify_base_url ?? DEFAULT_DOWNTIFY_BASE_URL,
  );
  useEffect(() => {
    setDowntifyBaseUrlDraft(config?.downtify_base_url ?? DEFAULT_DOWNTIFY_BASE_URL);
  }, [config?.downtify_base_url]);
  const [karaokePinDraft, setKaraokePinDraft] = useState(config?.karaoke_pin ?? DEFAULT_KARAOKE_PIN);
  const [karaokeDisplayNameDraft, setKaraokeDisplayNameDraft] = useState(
    config?.karaoke_display_name ?? DEFAULT_KARAOKE_DISPLAY_NAME,
  );
  useEffect(() => {
    setKaraokePinDraft(config?.karaoke_pin ?? DEFAULT_KARAOKE_PIN);
  }, [config?.karaoke_pin]);
  useEffect(() => {
    setKaraokeDisplayNameDraft(config?.karaoke_display_name ?? DEFAULT_KARAOKE_DISPLAY_NAME);
  }, [config?.karaoke_display_name]);

  const asrEngine = config?.asr_engine ?? DEFAULT_ASR_ENGINE;
  const isParakeet = asrEngine === "parakeet";

  const stops = isParakeet ? SETTINGS_STOPS_PARAKEET : SETTINGS_STOPS_WHISPER;
  const itemCount = stops.reduce((sum, n) => sum + n, 0);
  const footerSegment = stops.length - 1;

  // Batch Size is the last engine-specific segment; playback rows follow it.
  const batchSegment = isParakeet ? 5 : 7;
  const lyricsPositionSegment = batchSegment + 1;
  const lyricsFontSegment = batchSegment + 2;
  const playbackPerformanceSegment = batchSegment + 3;
  const pitchGraphSegment = batchSegment + 4;
  const autoRescanSegment = batchSegment + 5;
  const autoAnalyzeSegment = batchSegment + 6;
  const warmStemsSegment = batchSegment + 7;
  const downtifyBaseUrlSegment = batchSegment + 8;
  const karaokeEnabledSegment = batchSegment + 9;
  const karaokePinSegment = batchSegment + 10;
  const karaokeDisplayNameSegment = batchSegment + 11;
  const karaokeAllowGuestControlsSegment = batchSegment + 12;

  const { isFocused } = useDialogNav({
    open,
    itemCount,
    stops,
    onBack: close,
    containerRef,
    onAction: (segment, _slot, action) => {
      if (!action.left && !action.right) return false;
      if (segment === MIC_MONITOR_GAIN_SEGMENT) {
        const delta = action.right ? MIC_MONITOR_GAIN_STEP : -MIC_MONITOR_GAIN_STEP;
        const next = Math.min(MIC_MONITOR_GAIN_MAX, Math.max(0, micMonitorGainRef.current + delta));
        micMonitorGainRef.current = next;
        mutate({ mic_monitor_gain: next });
        return true;
      }
      if (segment === lyricsFontSegment) {
        const delta = action.right ? LYRICS_FONT_SCALE_STEP : -LYRICS_FONT_SCALE_STEP;
        const next = Math.min(
          LYRICS_FONT_SCALE_MAX,
          Math.max(LYRICS_FONT_SCALE_MIN, lyricsFontScaleRef.current + delta),
        );
        lyricsFontScaleRef.current = next;
        mutate({ lyrics_font_scale: next });
        return true;
      }
      if (segment === autoRescanSegment) {
        const delta = action.right ? AUTO_RESCAN_SECONDS_STEP : -AUTO_RESCAN_SECONDS_STEP;
        const next = Math.min(
          AUTO_RESCAN_SECONDS_MAX,
          Math.max(AUTO_RESCAN_SECONDS_MIN, autoRescanSecondsRef.current + delta),
        );
        autoRescanSecondsRef.current = next;
        mutate({ auto_rescan_seconds: next });
        return true;
      }
      return false;
    },
  });

  useEffect(() => {
    const updateIsFullScreen = async () => {
      setIsFullScreen(await tauriIsFullScreen());
    };

    updateIsFullScreen();
  }, []);

  const toggleWindowMode = (fullscreen: boolean) => {
    setIsFullScreen(fullscreen);
    setFullScreen(fullscreen);
    mutate({ fullscreen });
  };

  const generateRingClassName = (segment: number, slot?: number) => {
    return cn(NO_FOCUS_RING, isFocused(segment, slot) && RING);
  };

  const generateNumberSelect = (
    settingName: "beam_size" | "batch_size",
    value: number,
    segment: number,
  ) => {
    return Array.from({ length: 16 })
      .fill(null)
      .map((_, idx) => {
        const idxToRender = idx + 1;

        return (
          <Button
            onClick={() => mutate({ [settingName]: idxToRender })}
            variant={value === idxToRender ? "default" : "outline"}
            className={generateRingClassName(segment, idx)}
          >
            {idx + 1}
          </Button>
        );
      });
  };

  const batchSize = config?.batch_size ?? DEFAULT_BEAM_BATCH_SIZE;
  const beamSize = config?.beam_size ?? DEFAULT_BEAM_BATCH_SIZE;
  const micMonitorGainPct = Math.round(
    (config?.mic_monitor_gain ?? DEFAULT_MIC_MONITOR_GAIN) * 100,
  );

  const lyricsPosition = config?.lyrics_position ?? DEFAULT_LYRICS_POSITION;
  const lyricsFontPct = Math.round(
    (config?.lyrics_font_scale ?? DEFAULT_LYRICS_FONT_SCALE) * 100,
  );
  const playbackPerformanceMode =
    config?.playback_performance_mode ?? DEFAULT_PLAYBACK_PERFORMANCE_MODE;
  const playbackShowPitchGraph =
    config?.playback_show_pitch_graph ?? DEFAULT_PLAYBACK_SHOW_PITCH_GRAPH;
  const playbackAudioDecodeMode =
    config?.playback_audio_decode_mode === "server_pcm"
      ? "server_pcm"
      : DEFAULT_PLAYBACK_AUDIO_DECODE_MODE;
  const playbackWarmupCacheEnabled =
    config?.playback_warmup_cache_enabled ?? DEFAULT_PLAYBACK_WARMUP_CACHE_ENABLED;
  const autoRescanSeconds = config?.auto_rescan_seconds ?? DEFAULT_AUTO_RESCAN_SECONDS;
  const autoAnalyzeNewContent =
    config?.auto_analyze_new_content ?? DEFAULT_AUTO_ANALYZE_NEW_CONTENT;
  const downtifyBaseUrl = config?.downtify_base_url ?? DEFAULT_DOWNTIFY_BASE_URL;
  const karaokeEnabled = config?.karaoke_enabled ?? DEFAULT_KARAOKE_ENABLED;
  const karaokeAllowGuestControls =
    config?.karaoke_allow_guest_controls ?? DEFAULT_KARAOKE_ALLOW_GUEST_CONTROLS;
  const totalDurationSeconds = (pcmEstimateSongs?.processed ?? []).reduce(
    (sum, song) => sum + (song.duration_secs > 0 ? song.duration_secs : 0),
    0,
  );
  const estimatedPcmBytes =
    (totalDurationSeconds / 60) * WAV_STEREO_44K16_BYTES_PER_MINUTE_PER_STEM * 2;
  const estimatedPcmSizeLabel = formatBytesEstimate(estimatedPcmBytes);
  const estimatedSongCount = pcmEstimateSongs?.processed.length ?? 0;

  const commitDowntifyBaseUrl = () => {
    const trimmed = downtifyBaseUrlDraft.trim();
    mutate({ downtify_base_url: trimmed.length > 0 ? trimmed : null });
  };
  const commitKaraokePin = () => {
    const trimmed = karaokePinDraft.trim();
    mutate({ karaoke_pin: trimmed.length > 0 ? trimmed : null });
  };
  const commitKaraokeDisplayName = () => {
    const trimmed = karaokeDisplayNameDraft.trim();
    mutate({ karaoke_display_name: trimmed.length > 0 ? trimmed : null });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto pr-2">
        <div ref={containerRef} className="contents">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              You can modify the preferred model to use for the stem separation and transcript and
              tweak model parameters
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Label>Window</Label>
              <ButtonGroup>
                <Button
                  variant={isFullScreen === true ? "outline" : "default"}
                  onClick={() => toggleWindowMode(false)}
                  className={generateRingClassName(0, 0)}
                >
                  Windowed
                </Button>
                <Button
                  variant={isFullScreen === false ? "outline" : "default"}
                  onClick={() => toggleWindowMode(true)}
                  className={generateRingClassName(0, 1)}
                >
                  Fullscreen
                </Button>
              </ButtonGroup>
            </Field>
          </FieldGroup>
          <FieldGroup>
            <Field>
              <Label>Microphone</Label>
              <FieldDescription>Select which microphone to use for pitch scoring</FieldDescription>
              <Select
                onValueChange={(value) =>
                  mutate({
                    preferred_mic: value === "__default__" ? null : value,
                  })
                }
                value={config?.preferred_mic ?? "__default__"}
              >
                <SelectTrigger className={generateRingClassName(1)}>
                  <SelectValue placeholder="Default microphone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Microphone</SelectLabel>
                    <SelectItem value="__default__">Default</SelectItem>
                    {micDevices.map(({ deviceId, label }) => (
                      <SelectItem key={deviceId} value={deviceId}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label>Mic monitor gain</Label>
              <FieldDescription>
                Volume of your microphone played back through the speakers while monitoring (
                {micMonitorGainPct}%)
              </FieldDescription>
              <Slider
                min={0}
                max={200}
                step={1}
                value={[micMonitorGainPct]}
                onValueChange={([pct]) => mutate({ mic_monitor_gain: pct / 100 })}
                className={generateRingClassName(2)}
              />
            </Field>
            <Field>
              <Label htmlFor="model-1">Separator</Label>
              <FieldDescription>
                Karaoke removes backing vocals for cleaner lyrics; Demucs is faster
              </FieldDescription>
              <Select
                onValueChange={(value) => mutate({ separator: value })}
                value={config?.separator ?? DEFAULT_SEPARATOR}
              >
                <SelectTrigger id="separator-1" className={generateRingClassName(3)}>
                  <SelectValue placeholder="Select a separator" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Separator</SelectLabel>
                    {SEPARATORS.map(({ value, label }) => (
                      <SelectItem value={value}>{label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="asr-engine-1">ASR Engine</Label>
              <FieldDescription>
                Whisper is multilingual and supports custom model sizes; Parakeet v3 is faster and
                covers 25 European languages (falls back to Whisper otherwise)
              </FieldDescription>
              <Select onValueChange={(value) => mutate({ asr_engine: value })} value={asrEngine}>
                <SelectTrigger id="asr-engine-1" className={generateRingClassName(4)}>
                  <SelectValue placeholder="Select an engine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>ASR Engine</SelectLabel>
                    {ASR_ENGINES.map(({ value, label }) => (
                      <SelectItem value={value}>{label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {!isParakeet && (
              <>
                <Field>
                  <Label htmlFor="model-1">Model</Label>
                  <FieldDescription>
                    Smaller models are faster but produce worse results
                  </FieldDescription>
                  <Select
                    onValueChange={(value) => mutate({ whisper_model: value })}
                    value={config?.whisper_model ?? DEFAULT_MODEL}
                  >
                    <SelectTrigger id="model-1" className={generateRingClassName(5)}>
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Model</SelectLabel>
                        {MODELS.map((model) => (
                          <SelectItem value={model}>{model}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <Label>Beam Size</Label>
                  <FieldDescription>
                    Higher values improve accuracy at the cost of speed
                  </FieldDescription>
                  <ButtonGroup>{generateNumberSelect("beam_size", beamSize, 6)}</ButtonGroup>
                </Field>
              </>
            )}
            <Field>
              <Label>Batch Size</Label>
              <FieldDescription>Higher values use more memory but process faster</FieldDescription>
              <ButtonGroup>
                {generateNumberSelect("batch_size", batchSize, batchSegment)}
              </ButtonGroup>
            </Field>
            <Field>
              <Label>Lyrics Position</Label>
              <FieldDescription>Where lyrics are anchored on screen during playback</FieldDescription>
              <ButtonGroup>
                {LYRICS_POSITIONS.map(({ value, label }, idx) => (
                  <Button
                    key={value}
                    variant={lyricsPosition === value ? "default" : "outline"}
                    onClick={() => mutate({ lyrics_position: value })}
                    className={generateRingClassName(lyricsPositionSegment, idx)}
                  >
                    {label}
                  </Button>
                ))}
              </ButtonGroup>
            </Field>
            <Field>
              <Label>Lyrics Size</Label>
              <FieldDescription>Size of the lyrics text during playback ({lyricsFontPct}%)</FieldDescription>
              <Slider
                min={LYRICS_FONT_SCALE_MIN * 100}
                max={LYRICS_FONT_SCALE_MAX * 100}
                step={LYRICS_FONT_SCALE_STEP * 100}
                value={[lyricsFontPct]}
                onValueChange={([pct]) => mutate({ lyrics_font_scale: pct / 100 })}
                className={generateRingClassName(lyricsFontSegment)}
              />
            </Field>
            <Field>
              <Label>Playback Performance Mode</Label>
              <FieldDescription>
                Reduces animation/render workload for low-power tablets and older devices
              </FieldDescription>
              <ButtonGroup className="w-full flex-wrap [&>*]:flex-1">
                <Button
                  variant={playbackPerformanceMode ? "default" : "outline"}
                  onClick={() => mutate({ playback_performance_mode: true })}
                  className={generateRingClassName(playbackPerformanceSegment, 0)}
                >
                  On
                </Button>
                <Button
                  variant={!playbackPerformanceMode ? "default" : "outline"}
                  onClick={() => mutate({ playback_performance_mode: false })}
                  className={generateRingClassName(playbackPerformanceSegment, 1)}
                >
                  Off
                </Button>
              </ButtonGroup>
            </Field>
            <Field>
              <Label>Pitch Graph Overlay</Label>
              <FieldDescription>
                Show/hide the top pitch graph independently from performance mode
              </FieldDescription>
              <ButtonGroup className="w-full flex-wrap [&>*]:flex-1">
                <Button
                  variant={playbackShowPitchGraph ? "default" : "outline"}
                  onClick={() => mutate({ playback_show_pitch_graph: true })}
                  className={generateRingClassName(pitchGraphSegment, 0)}
                >
                  Show
                </Button>
                <Button
                  variant={!playbackShowPitchGraph ? "default" : "outline"}
                  onClick={() => mutate({ playback_show_pitch_graph: false })}
                  className={generateRingClassName(pitchGraphSegment, 1)}
                >
                  Hide
                </Button>
              </ButtonGroup>
            </Field>
            <Field>
              <Label>Playback Audio Decode</Label>
              <FieldDescription>
                Client MP3 uses browser decode; Server PCM serves preconverted WAV stems to reduce
                decode load on weak tablets
              </FieldDescription>
              <ButtonGroup className="w-full flex-wrap [&>*]:flex-1">
                <Button
                  variant={playbackAudioDecodeMode === "client_mp3" ? "default" : "outline"}
                  onClick={() => mutate({ playback_audio_decode_mode: "client_mp3" })}
                >
                  Client MP3
                </Button>
                <Button
                  variant={playbackAudioDecodeMode === "server_pcm" ? "default" : "outline"}
                  onClick={() => mutate({ playback_audio_decode_mode: "server_pcm" })}
                >
                  Server PCM
                </Button>
              </ButtonGroup>
            </Field>
            <Field>
              <Label>Queue Warmup Cache</Label>
              <FieldDescription>
                Host pre-decodes upcoming songs in the queue; disable this if weak tablets become
                unstable
              </FieldDescription>
              <ButtonGroup className="w-full flex-wrap [&>*]:flex-1">
                <Button
                  variant={playbackWarmupCacheEnabled ? "default" : "outline"}
                  onClick={() => mutate({ playback_warmup_cache_enabled: true })}
                >
                  On
                </Button>
                <Button
                  variant={!playbackWarmupCacheEnabled ? "default" : "outline"}
                  onClick={() => mutate({ playback_warmup_cache_enabled: false })}
                >
                  Off
                </Button>
              </ButtonGroup>
            </Field>
            <Field>
              <Label>Auto Rescan Library</Label>
              <FieldDescription>
                Automatically rescan your library every{" "}
                {autoRescanSeconds > 0 ? `${autoRescanSeconds} seconds` : "disabled"}
              </FieldDescription>
              <Slider
                min={AUTO_RESCAN_SECONDS_MIN}
                max={AUTO_RESCAN_SECONDS_MAX}
                step={AUTO_RESCAN_SECONDS_STEP}
                value={[autoRescanSeconds]}
                onValueChange={([seconds]) => mutate({ auto_rescan_seconds: seconds })}
                className={generateRingClassName(autoRescanSegment)}
              />
            </Field>
            <Field>
              <Label>Auto Analyze New Content</Label>
              <FieldDescription>
                Automatically analyze songs and videos newly discovered during scans
              </FieldDescription>
              <ButtonGroup className="w-full flex-wrap [&>*]:flex-1">
                <Button
                  variant={autoAnalyzeNewContent ? "default" : "outline"}
                  onClick={() => mutate({ auto_analyze_new_content: true })}
                  className={generateRingClassName(autoAnalyzeSegment, 0)}
                >
                  On
                </Button>
                <Button
                  variant={!autoAnalyzeNewContent ? "default" : "outline"}
                  onClick={() => mutate({ auto_analyze_new_content: false })}
                  className={generateRingClassName(autoAnalyzeSegment, 1)}
                >
                  Off
                </Button>
              </ButtonGroup>
            </Field>
            <Field>
              <Label>Stem Cache Warmup</Label>
              <FieldDescription>
                Background precompute for analyzed songs so playback starts faster on slower devices
              </FieldDescription>
              <p className="text-xs text-muted-foreground">
                {formatWarmupProgress(warmupStatus?.stems)}
              </p>
              <Button
                variant="outline"
                className={generateRingClassName(warmStemsSegment)}
                onClick={async () => {
                  try {
                    const started = await warmStemsCache();
                    if (started) toast.success("Stem cache warmup started in background.");
                    else toast.message("Stem cache warmup is already running.");
                  } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    toast.error(`Failed to start stem warmup: ${message}`);
                  }
                }}
              >
                Warm Stem Cache Now
              </Button>
            </Field>
            <Field>
              <Label>Server PCM Cache Warmup</Label>
              <FieldDescription>
                Pre-convert cached stems to WAV for server PCM mode. Estimated extra disk:{" "}
                {estimatedPcmSizeLabel} across ~{estimatedSongCount} songs.
              </FieldDescription>
              <p className="text-xs text-muted-foreground">
                {formatWarmupProgress(warmupStatus?.server_pcm)}
              </p>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const started = await warmServerPcmCache();
                    if (started) toast.success("Server PCM warmup started in background.");
                    else toast.message("Server PCM warmup is already running.");
                  } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    toast.error(`Failed to start server PCM warmup: ${message}`);
                  }
                }}
              >
                Warm Server PCM Cache Now
              </Button>
            </Field>
            <Field>
              <Label>Downtify Base URL</Label>
              <FieldDescription>
                Nightingale uses this service for Request Song search/download ({downtifyBaseUrl})
              </FieldDescription>
              <Input
                value={downtifyBaseUrlDraft}
                onChange={(e) => setDowntifyBaseUrlDraft(e.target.value)}
                onBlur={commitDowntifyBaseUrl}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitDowntifyBaseUrl();
                  }
                }}
                placeholder={DEFAULT_DOWNTIFY_BASE_URL}
                className={generateRingClassName(downtifyBaseUrlSegment)}
              />
            </Field>
            <Field>
              <Label>Karaoke Session Mode</Label>
              <FieldDescription>Enable host/guest phone control mode</FieldDescription>
              <ButtonGroup className="w-full flex-wrap [&>*]:flex-1">
                <Button
                  variant={karaokeEnabled ? "default" : "outline"}
                  onClick={() => mutate({ karaoke_enabled: true })}
                  className={generateRingClassName(karaokeEnabledSegment, 0)}
                >
                  On
                </Button>
                <Button
                  variant={!karaokeEnabled ? "default" : "outline"}
                  onClick={() => mutate({ karaoke_enabled: false })}
                  className={generateRingClassName(karaokeEnabledSegment, 1)}
                >
                  Off
                </Button>
              </ButtonGroup>
            </Field>
            <Field>
              <Label>Karaoke Join Code</Label>
              <FieldDescription>Guests join with this PIN on their phones</FieldDescription>
              <Input
                value={karaokePinDraft}
                onChange={(e) => setKaraokePinDraft(e.target.value)}
                onBlur={commitKaraokePin}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitKaraokePin();
                  }
                }}
                placeholder={DEFAULT_KARAOKE_PIN}
                className={generateRingClassName(karaokePinSegment)}
              />
            </Field>
            <Field>
              <Label>Host Display Name</Label>
              <FieldDescription>Name shown when host controls the session</FieldDescription>
              <Input
                value={karaokeDisplayNameDraft}
                onChange={(e) => setKaraokeDisplayNameDraft(e.target.value)}
                onBlur={commitKaraokeDisplayName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitKaraokeDisplayName();
                  }
                }}
                placeholder={DEFAULT_KARAOKE_DISPLAY_NAME}
                className={generateRingClassName(karaokeDisplayNameSegment)}
              />
            </Field>
            <Field>
              <Label>Guest Control Permissions</Label>
              <FieldDescription>
                Allow guests to use playback/settings/admin actions (not just queue)
              </FieldDescription>
              <ButtonGroup className="w-full flex-wrap [&>*]:flex-1">
                <Button
                  variant={karaokeAllowGuestControls ? "default" : "outline"}
                  onClick={() => mutate({ karaoke_allow_guest_controls: true })}
                  className={generateRingClassName(karaokeAllowGuestControlsSegment, 0)}
                >
                  Allow
                </Button>
                <Button
                  variant={!karaokeAllowGuestControls ? "default" : "outline"}
                  onClick={() => mutate({ karaoke_allow_guest_controls: false })}
                  className={generateRingClassName(karaokeAllowGuestControlsSegment, 1)}
                >
                  Queue Only
                </Button>
              </ButtonGroup>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                mutate({
                  separator: DEFAULT_SEPARATOR,
                  asr_engine: DEFAULT_ASR_ENGINE,
                  whisper_model: DEFAULT_MODEL,
                  beam_size: DEFAULT_BEAM_BATCH_SIZE,
                  batch_size: DEFAULT_BEAM_BATCH_SIZE,
                  mic_monitor_gain: DEFAULT_MIC_MONITOR_GAIN,
                  auto_rescan_seconds: DEFAULT_AUTO_RESCAN_SECONDS,
                  auto_analyze_new_content: DEFAULT_AUTO_ANALYZE_NEW_CONTENT,
                  downtify_base_url: null,
                  karaoke_enabled: null,
                  karaoke_pin: null,
                  karaoke_display_name: null,
                  karaoke_allow_guest_controls: null,
                  lyrics_position: DEFAULT_LYRICS_POSITION,
                  lyrics_font_scale: DEFAULT_LYRICS_FONT_SCALE,
                  playback_performance_mode: DEFAULT_PLAYBACK_PERFORMANCE_MODE,
                  playback_show_pitch_graph: DEFAULT_PLAYBACK_SHOW_PITCH_GRAPH,
                  playback_audio_decode_mode: DEFAULT_PLAYBACK_AUDIO_DECODE_MODE,
                  playback_warmup_cache_enabled: DEFAULT_PLAYBACK_WARMUP_CACHE_ENABLED,
                })
              }
              className={generateRingClassName(footerSegment, 0)}
            >
              Restore Defaults
            </Button>
            <Button
              variant="outline"
              onClick={close}
              className={generateRingClassName(footerSegment, 1)}
            >
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
