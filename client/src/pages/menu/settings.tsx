import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { setFullScreen, isFullScreen as tauriIsFullScreen } from "@/bridge/fullScreen";
import { getPlaybackWarmupStatus, warmServerPcmCache, warmStemsCache } from "@/bridge/playback";
import { getPreloadedSongsMeta, loadSongsMeta } from "@/bridge/songs";
import { useMicDevices } from "@/queries/use-mic-devices";
import { useConfigMutation } from "@/mutations/use-config-mutation";
import { useConfig } from "@/queries/use-config";
import type { AppConfig } from "@/types/AppConfig";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  ALIGN_BACKENDS,
  ASR_ENGINES,
  AUTO_RESCAN_SECONDS_MAX,
  AUTO_RESCAN_SECONDS_MIN,
  AUTO_RESCAN_SECONDS_STEP,
  DEFAULT_DOWNTIFY_BASE_URL,
  DEFAULT_KARAOKE_ALLOW_GUEST_CONTROLS,
  DEFAULT_KARAOKE_DISPLAY_NAME,
  DEFAULT_KARAOKE_ENABLED,
  DEFAULT_KARAOKE_PIN,
  DEFAULTS,
  LYRICS_FONT_SCALE_MAX,
  LYRICS_FONT_SCALE_MIN,
  LYRICS_FONT_SCALE_STEP,
  LYRICS_HORIZONTAL_POSITIONS,
  LYRICS_VERTICAL_POSITIONS,
  MODELS,
  NAV,
  SEPARATORS,
  SETTINGS_TABS,
  VOCAL_THRESHOLD_MAX,
  getAnalysisNav,
  type SettingsTab,
} from "@/components/menu/settings/constants";
import { MicLatencyField } from "@/components/menu/settings/mic-latency-field";
import {
  Hint,
  NumberButtonGroup,
  PageHeader,
  SettingsSelect,
} from "@/components/menu/settings/settings-controls";
import { useSettingsNavigation } from "@/hooks/navigation/use-settings-navigation";

const DEFAULT_MIC_ID = "__default__";

// WAV sizes used to estimate the extra disk the server PCM cache would need.
const WAV_STEREO_44K16_BYTES_PER_MINUTE_PER_STEM = 44_100 * 2 * 2 * 60;
const WAV_MONO_22K16_BYTES_PER_MINUTE_PER_STEM = 22_050 * 2 * 1 * 60;
const ESTIMATED_AVG_SONG_SECONDS = 240;

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

export const SettingsPage = () => {
  const micDevices = useMicDevices();
  const navigate = useNavigate();
  const { data: config } = useConfig();
  const { mutate } = useConfigMutation();

  const containerRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [isFullScreen, setIsFullScreen] = useState<boolean | null | undefined>(config?.fullscreen);
  const [micMonitorGain, setMicMonitorGain] = useState(
    config?.mic_monitor_gain ?? DEFAULTS.mic_monitor_gain,
  );
  const [micLatencySec, setMicLatencySec] = useState(
    config?.mic_latency_compensation_sec ?? DEFAULTS.mic_latency_compensation_sec,
  );
  const [vocalThresholdPct, setVocalThresholdPct] = useState(
    config?.vocal_detection_threshold_pct ?? DEFAULTS.vocal_detection_threshold_pct,
  );
  const [lyricsFontScale, setLyricsFontScale] = useState(
    config?.lyrics_font_scale ?? DEFAULTS.lyrics_font_scale,
  );
  const [autoRescanSeconds, setAutoRescanSeconds] = useState(
    config?.auto_rescan_seconds ?? DEFAULTS.auto_rescan_seconds,
  );
  const [downtifyBaseUrlDraft, setDowntifyBaseUrlDraft] = useState(
    config?.downtify_base_url ?? DEFAULT_DOWNTIFY_BASE_URL,
  );
  const [karaokePinDraft, setKaraokePinDraft] = useState(
    config?.karaoke_pin ?? DEFAULT_KARAOKE_PIN,
  );
  const [karaokeDisplayNameDraft, setKaraokeDisplayNameDraft] = useState(
    config?.karaoke_display_name ?? DEFAULT_KARAOKE_DISPLAY_NAME,
  );

  const close = () => navigate("/");
  const asrEngine = config?.asr_engine ?? DEFAULTS.asr_engine;
  const isParakeet = asrEngine === "parakeet";
  const analysisNav = getAnalysisNav(isParakeet);

  const micOptions = useMemo(
    () => [
      { value: DEFAULT_MIC_ID, label: "Default" },
      ...micDevices.map(({ deviceId, label }) => ({ value: deviceId, label })),
    ],
    [micDevices],
  );
  const modelOptions = useMemo(() => MODELS.map((model) => ({ value: model, label: model })), []);
  const micMonitorGainPct = Math.round(micMonitorGain * 100);
  const vocalThresholdDisplayPct = Math.round(vocalThresholdPct * 100);
  const lyricsFontPct = Math.round(lyricsFontScale * 100);
  const batchSize = config?.batch_size ?? DEFAULTS.batch_size;
  const beamSize = config?.beam_size ?? DEFAULTS.beam_size;

  const playbackPerformanceMode =
    config?.playback_performance_mode ?? DEFAULTS.playback_performance_mode;
  const playbackShowPitchGraph =
    config?.playback_show_pitch_graph ?? DEFAULTS.playback_show_pitch_graph;
  const playbackMovingBackgrounds = config?.playback_moving_backgrounds ?? !playbackPerformanceMode;
  const playbackAudioDecodeMode =
    config?.playback_audio_decode_mode === "server_pcm" ? "server_pcm" : "client_mp3";
  const playbackWarmupCacheEnabled =
    config?.playback_warmup_cache_enabled ?? DEFAULTS.playback_warmup_cache_enabled;
  const playbackStickyPredecode =
    config?.playback_sticky_predecode ?? DEFAULTS.playback_sticky_predecode;
  const playbackFastStartInstrumentalFirst =
    config?.playback_fast_start_instrumental_first ??
    DEFAULTS.playback_fast_start_instrumental_first;
  const autoAnalyzeNewContent =
    config?.auto_analyze_new_content ?? DEFAULTS.auto_analyze_new_content;
  const downtifyBaseUrl = config?.downtify_base_url ?? DEFAULT_DOWNTIFY_BASE_URL;
  const karaokeEnabled = config?.karaoke_enabled ?? DEFAULT_KARAOKE_ENABLED;
  const karaokeAllowGuestControls =
    config?.karaoke_allow_guest_controls ?? DEFAULT_KARAOKE_ALLOW_GUEST_CONTROLS;

  const { data: warmupStatus } = useQuery({
    queryKey: ["playback-warmup-status"],
    queryFn: getPlaybackWarmupStatus,
    enabled: tab === "playback",
    refetchInterval: (data) => {
      if (!data) return 3000;
      return data.stems.running || data.server_pcm.running ? 1000 : 3000;
    },
  });

  const { data: pcmEstimateMeta } = useQuery({
    queryKey: ["settings-server-pcm-estimate-meta"],
    queryFn: loadSongsMeta,
    initialData: getPreloadedSongsMeta(),
    enabled: tab === "playback",
    staleTime: 60_000,
  });

  const estimatedSongCount = pcmEstimateMeta?.processed_count ?? 0;
  const pcmBytesPerMinutePerStem = playbackPerformanceMode
    ? WAV_MONO_22K16_BYTES_PER_MINUTE_PER_STEM
    : WAV_STEREO_44K16_BYTES_PER_MINUTE_PER_STEM;
  const estimatedPcmSizeLabel = formatBytesEstimate(
    ((estimatedSongCount * ESTIMATED_AVG_SONG_SECONDS) / 60) * pcmBytesPerMinutePerStem * 2,
  );

  useEffect(() => {
    setMicMonitorGain(config?.mic_monitor_gain ?? DEFAULTS.mic_monitor_gain);
  }, [config?.mic_monitor_gain]);

  useEffect(() => {
    setMicLatencySec(config?.mic_latency_compensation_sec ?? DEFAULTS.mic_latency_compensation_sec);
  }, [config?.mic_latency_compensation_sec]);

  useEffect(() => {
    setVocalThresholdPct(
      config?.vocal_detection_threshold_pct ?? DEFAULTS.vocal_detection_threshold_pct,
    );
  }, [config?.vocal_detection_threshold_pct]);

  useEffect(() => {
    setLyricsFontScale(config?.lyrics_font_scale ?? DEFAULTS.lyrics_font_scale);
  }, [config?.lyrics_font_scale]);

  useEffect(() => {
    setAutoRescanSeconds(config?.auto_rescan_seconds ?? DEFAULTS.auto_rescan_seconds);
  }, [config?.auto_rescan_seconds]);

  useEffect(() => {
    setDowntifyBaseUrlDraft(config?.downtify_base_url ?? DEFAULT_DOWNTIFY_BASE_URL);
  }, [config?.downtify_base_url]);

  useEffect(() => {
    setKaraokePinDraft(config?.karaoke_pin ?? DEFAULT_KARAOKE_PIN);
  }, [config?.karaoke_pin]);

  useEffect(() => {
    setKaraokeDisplayNameDraft(config?.karaoke_display_name ?? DEFAULT_KARAOKE_DISPLAY_NAME);
  }, [config?.karaoke_display_name]);

  useEffect(() => {
    const updateIsFullScreen = async () => {
      setIsFullScreen(await tauriIsFullScreen());
    };

    updateIsFullScreen();
  }, []);

  const updateMicMonitorGain = (gain: number) => {
    setMicMonitorGain(gain);
    mutate({ mic_monitor_gain: gain });
  };

  const updateMicLatency = (latencySec: number) => {
    setMicLatencySec(latencySec);
    mutate({ mic_latency_compensation_sec: latencySec });
  };

  const updateVocalThreshold = (pct: number) => {
    setVocalThresholdPct(pct);
    mutate({ vocal_detection_threshold_pct: pct });
  };

  const updateLyricsFontScale = (scale: number) => {
    setLyricsFontScale(scale);
    mutate({ lyrics_font_scale: scale });
  };

  const updateAutoRescanSeconds = (seconds: number) => {
    setAutoRescanSeconds(seconds);
    mutate({ auto_rescan_seconds: seconds });
  };

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

  const toggleWindowMode = (fullscreen: boolean) => {
    setIsFullScreen(fullscreen);
    setFullScreen(fullscreen);
    mutate({ fullscreen });
  };

  const resetDefaults = () => {
    mutate(DEFAULTS);
    setMicMonitorGain(DEFAULTS.mic_monitor_gain);
    setMicLatencySec(DEFAULTS.mic_latency_compensation_sec);
    setVocalThresholdPct(DEFAULTS.vocal_detection_threshold_pct);
    setLyricsFontScale(DEFAULTS.lyrics_font_scale);
    setAutoRescanSeconds(DEFAULTS.auto_rescan_seconds);
    setDowntifyBaseUrlDraft(DEFAULT_DOWNTIFY_BASE_URL);
    setKaraokePinDraft(DEFAULT_KARAOKE_PIN);
    setKaraokeDisplayNameDraft(DEFAULT_KARAOKE_DISPLAY_NAME);
  };

  const { footerSegment, getFocusClassName, syncFocusFromElement } = useSettingsNavigation({
    containerRef,
    tab,
    isParakeet,
    micMonitorGain,
    micLatencySec,
    vocalThresholdPct,
    lyricsFontScale,
    autoRescanSeconds,
    onBack: close,
    onTabChange: setTab,
    onMicMonitorGainChange: updateMicMonitorGain,
    onMicLatencyChange: updateMicLatency,
    onVocalThresholdChange: updateVocalThreshold,
    onLyricsFontScaleChange: updateLyricsFontScale,
    onAutoRescanSecondsChange: updateAutoRescanSeconds,
  });

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto px-4 pb-5 pt-14 sm:px-6 md:pt-5 lg:px-8"
      onMouseMoveCapture={(event) => syncFocusFromElement(event.target)}
      onFocusCapture={(event) => syncFocusFromElement(event.target)}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <PageHeader />

        <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)}>
          <TabsList className="scrollbar-hide max-w-full overflow-x-auto overflow-y-hidden sm:w-fit">
            {SETTINGS_TABS.map((settingsTab, slot) => (
              <TabsTrigger
                key={settingsTab.value}
                value={settingsTab.value}
                className={getFocusClassName(NAV.tabSegment, slot)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setTab(settingsTab.value);
                }}
              >
                {settingsTab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="general" className="mt-4">
            <FieldGroup>
              <Field>
                <Label>Window</Label>
                <ButtonGroup>
                  <Button
                    variant={isFullScreen === true ? "outline" : "default"}
                    onClick={() => toggleWindowMode(false)}
                    className={getFocusClassName(NAV.general.window, 0)}
                  >
                    Windowed
                  </Button>
                  <Button
                    variant={isFullScreen === false ? "outline" : "default"}
                    onClick={() => toggleWindowMode(true)}
                    className={getFocusClassName(NAV.general.window, 1)}
                  >
                    Fullscreen
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Microphone</Label>
                <Hint>Select which microphone to use for pitch scoring</Hint>
                <SettingsSelect
                  label="Microphone"
                  placeholder="Default microphone"
                  value={config?.preferred_mic ?? DEFAULT_MIC_ID}
                  options={micOptions}
                  triggerClassName={getFocusClassName(NAV.general.microphone)}
                  onValueChange={(value) =>
                    mutate({ preferred_mic: value === DEFAULT_MIC_ID ? null : value })
                  }
                />
              </Field>

              <Field>
                <Label>Mic monitor gain</Label>
                <Hint>
                  Volume of your microphone played back through the speakers while monitoring (
                  {micMonitorGainPct}%)
                </Hint>
                <Slider
                  min={0}
                  max={200}
                  step={1}
                  value={[micMonitorGainPct]}
                  onValueChange={([pct]) => updateMicMonitorGain(pct / 100)}
                  className={getFocusClassName(NAV.general.micMonitorGain)}
                />
              </Field>

              <MicLatencyField
                selectedMicId={config?.preferred_mic ?? null}
                latencySec={micLatencySec}
                sliderClassName={getFocusClassName(NAV.general.micLatency, 0)}
                buttonClassName={getFocusClassName(NAV.general.micLatency, 1)}
                onLatencyChange={updateMicLatency}
              />

              <Field>
                <Label htmlFor="lyrics-vertical-position-1">Lyrics vertical position</Label>
                <Hint>Top moves playback HUD and pitch graph to the bottom</Hint>
                <SettingsSelect
                  id="lyrics-vertical-position-1"
                  label="Lyrics vertical position"
                  placeholder="Select vertical position"
                  value={config?.lyrics_vertical_position ?? DEFAULTS.lyrics_vertical_position}
                  options={LYRICS_VERTICAL_POSITIONS}
                  triggerClassName={getFocusClassName(NAV.general.lyricsVerticalPosition)}
                  onValueChange={(lyrics_vertical_position) =>
                    mutate({
                      lyrics_vertical_position:
                        lyrics_vertical_position as AppConfig["lyrics_vertical_position"],
                    })
                  }
                />
              </Field>

              <Field>
                <Label htmlFor="lyrics-horizontal-position-1">Lyrics horizontal position</Label>
                <Hint>Align lyrics left, center, or right during playback</Hint>
                <SettingsSelect
                  id="lyrics-horizontal-position-1"
                  label="Lyrics horizontal position"
                  placeholder="Select horizontal position"
                  value={config?.lyrics_horizontal_position ?? DEFAULTS.lyrics_horizontal_position}
                  options={LYRICS_HORIZONTAL_POSITIONS}
                  triggerClassName={getFocusClassName(NAV.general.lyricsHorizontalPosition)}
                  onValueChange={(lyrics_horizontal_position) =>
                    mutate({
                      lyrics_horizontal_position:
                        lyrics_horizontal_position as AppConfig["lyrics_horizontal_position"],
                    })
                  }
                />
              </Field>

              <Field>
                <Label>Lyrics size</Label>
                <Hint>Size of the lyrics text during playback ({lyricsFontPct}%)</Hint>
                <Slider
                  min={LYRICS_FONT_SCALE_MIN * 100}
                  max={LYRICS_FONT_SCALE_MAX * 100}
                  step={LYRICS_FONT_SCALE_STEP * 100}
                  value={[lyricsFontPct]}
                  onValueChange={([pct]) => updateLyricsFontScale(pct / 100)}
                  className={getFocusClassName(NAV.general.lyricsFontScale)}
                />
              </Field>
            </FieldGroup>
          </TabsContent>

          <TabsContent value="playback" className="mt-4">
            <FieldGroup>
              <Field>
                <Label>Performance mode</Label>
                <Hint>
                  Reduces animation/render workload for low-power tablets and older devices
                </Hint>
                <ButtonGroup>
                  <Button
                    variant={playbackPerformanceMode ? "outline" : "default"}
                    onClick={() => mutate({ playback_performance_mode: false })}
                    className={getFocusClassName(NAV.playback.performanceMode, 0)}
                  >
                    Off
                  </Button>
                  <Button
                    variant={playbackPerformanceMode ? "default" : "outline"}
                    onClick={() => mutate({ playback_performance_mode: true })}
                    className={getFocusClassName(NAV.playback.performanceMode, 1)}
                  >
                    On
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Pitch graph overlay</Label>
                <Hint>Show/hide the pitch graph independently from performance mode</Hint>
                <ButtonGroup>
                  <Button
                    variant={playbackShowPitchGraph ? "default" : "outline"}
                    onClick={() => mutate({ playback_show_pitch_graph: true })}
                    className={getFocusClassName(NAV.playback.pitchGraph, 0)}
                  >
                    Show
                  </Button>
                  <Button
                    variant={playbackShowPitchGraph ? "outline" : "default"}
                    onClick={() => mutate({ playback_show_pitch_graph: false })}
                    className={getFocusClassName(NAV.playback.pitchGraph, 1)}
                  >
                    Hide
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Moving backgrounds</Label>
                <Hint>
                  Enable animated playback backgrounds (disable for maximum tablet performance)
                </Hint>
                <ButtonGroup>
                  <Button
                    variant={playbackMovingBackgrounds ? "default" : "outline"}
                    onClick={() => mutate({ playback_moving_backgrounds: true })}
                    className={getFocusClassName(NAV.playback.movingBackgrounds, 0)}
                  >
                    On
                  </Button>
                  <Button
                    variant={playbackMovingBackgrounds ? "outline" : "default"}
                    onClick={() => mutate({ playback_moving_backgrounds: false })}
                    className={getFocusClassName(NAV.playback.movingBackgrounds, 1)}
                  >
                    Off
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Audio decode</Label>
                <Hint>
                  Client MP3 uses browser decode; Server PCM serves preconverted WAV stems to reduce
                  decode load on weak tablets
                </Hint>
                <ButtonGroup>
                  <Button
                    variant={playbackAudioDecodeMode === "client_mp3" ? "default" : "outline"}
                    onClick={() => mutate({ playback_audio_decode_mode: "client_mp3" })}
                    className={getFocusClassName(NAV.playback.audioDecodeMode, 0)}
                  >
                    Client MP3
                  </Button>
                  <Button
                    variant={playbackAudioDecodeMode === "server_pcm" ? "default" : "outline"}
                    onClick={() => mutate({ playback_audio_decode_mode: "server_pcm" })}
                    className={getFocusClassName(NAV.playback.audioDecodeMode, 1)}
                  >
                    Server PCM
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Queue warmup cache</Label>
                <Hint>
                  Host pre-decodes upcoming songs in the queue; disable this if weak tablets become
                  unstable
                </Hint>
                <ButtonGroup>
                  <Button
                    variant={playbackWarmupCacheEnabled ? "default" : "outline"}
                    onClick={() => mutate({ playback_warmup_cache_enabled: true })}
                    className={getFocusClassName(NAV.playback.warmupCache, 0)}
                  >
                    On
                  </Button>
                  <Button
                    variant={playbackWarmupCacheEnabled ? "outline" : "default"}
                    onClick={() => mutate({ playback_warmup_cache_enabled: false })}
                    className={getFocusClassName(NAV.playback.warmupCache, 1)}
                  >
                    Off
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Sticky predecode buffer</Label>
                <Hint>
                  Keep current + next decoded audio in memory for smoother transitions (uses more
                  RAM)
                </Hint>
                <ButtonGroup>
                  <Button
                    variant={playbackStickyPredecode ? "outline" : "default"}
                    onClick={() => mutate({ playback_sticky_predecode: false })}
                    className={getFocusClassName(NAV.playback.stickyPredecode, 0)}
                  >
                    Off
                  </Button>
                  <Button
                    variant={playbackStickyPredecode ? "default" : "outline"}
                    onClick={() => mutate({ playback_sticky_predecode: true })}
                    className={getFocusClassName(NAV.playback.stickyPredecode, 1)}
                  >
                    On
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Fast start (instrumental first)</Label>
                <Hint>
                  Start playback as soon as instrumental is ready, then fade in guide vocals once
                  decoded
                </Hint>
                <ButtonGroup>
                  <Button
                    variant={playbackFastStartInstrumentalFirst ? "outline" : "default"}
                    onClick={() => mutate({ playback_fast_start_instrumental_first: false })}
                    className={getFocusClassName(NAV.playback.fastStart, 0)}
                  >
                    Off
                  </Button>
                  <Button
                    variant={playbackFastStartInstrumentalFirst ? "default" : "outline"}
                    onClick={() => mutate({ playback_fast_start_instrumental_first: true })}
                    className={getFocusClassName(NAV.playback.fastStart, 1)}
                  >
                    On
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Stem cache warmup</Label>
                <Hint>
                  Background precompute for analyzed songs so playback starts faster on slower
                  devices
                </Hint>
                <p className="text-xs text-muted-foreground">
                  {formatWarmupProgress(warmupStatus?.stems)}
                </p>
                <Button
                  variant="outline"
                  className={getFocusClassName(NAV.playback.warmStems)}
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
                <Label>Server PCM cache warmup</Label>
                <Hint>
                  Pre-convert cached stems to WAV for server PCM mode. Estimated extra disk:{" "}
                  {estimatedPcmSizeLabel} across ~{estimatedSongCount} songs (4-min/song estimate)
                  {playbackPerformanceMode ? " (performance profile)" : " (full-quality profile)"}.
                </Hint>
                <p className="text-xs text-muted-foreground">
                  {formatWarmupProgress(warmupStatus?.server_pcm)}
                </p>
                <Button
                  variant="outline"
                  className={getFocusClassName(NAV.playback.warmServerPcm)}
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
            </FieldGroup>
          </TabsContent>

          <TabsContent value="analysis" className="mt-4">
            <FieldGroup>
              <Field>
                <Label htmlFor="separator-1">Vocal separator</Label>
                <Hint>How vocals are split from the music.</Hint>
                <SettingsSelect
                  id="separator-1"
                  label="Separator"
                  placeholder="Select a separator"
                  value={config?.separator ?? DEFAULTS.separator}
                  options={SEPARATORS}
                  triggerClassName={getFocusClassName(analysisNav.separator)}
                  onValueChange={(separator) => mutate({ separator })}
                />
              </Field>

              <Field>
                <Label htmlFor="asr-engine-1">Transcription model</Label>
                <Hint>Turns the vocals into lyrics.</Hint>
                <SettingsSelect
                  id="asr-engine-1"
                  label="ASR Engine"
                  placeholder="Select an engine"
                  value={asrEngine}
                  options={ASR_ENGINES}
                  triggerClassName={getFocusClassName(analysisNav.asrEngine)}
                  onValueChange={(asr_engine) => mutate({ asr_engine })}
                />
              </Field>

              {!isParakeet && (
                <>
                  <Field>
                    <Label htmlFor="model-1">Model size</Label>
                    <Hint>Smaller models are faster but produce worse results</Hint>
                    <SettingsSelect
                      id="model-1"
                      label="Model size"
                      placeholder="Select a model size"
                      value={config?.whisper_model ?? DEFAULTS.whisper_model}
                      options={modelOptions}
                      triggerClassName={getFocusClassName(analysisNav.whisperModel)}
                      onValueChange={(whisper_model) => mutate({ whisper_model })}
                    />
                  </Field>

                  <Field>
                    <Label>Beam Size</Label>
                    <Hint>Higher values improve accuracy at the cost of speed</Hint>
                    <NumberButtonGroup
                      name="beam_size"
                      value={beamSize}
                      segment={analysisNav.beamSize}
                      getFocusClassName={getFocusClassName}
                      onChange={(beam_size) => mutate({ beam_size })}
                    />
                  </Field>
                </>
              )}

              <Field>
                <Label htmlFor="align-backend-1">Alignment model</Label>
                <Hint>How each word is timed to the audio.</Hint>
                <SettingsSelect
                  id="align-backend-1"
                  label="Forced alignment"
                  placeholder="Select an alignment backend"
                  value={config?.align_backend ?? DEFAULTS.align_backend}
                  options={ALIGN_BACKENDS}
                  triggerClassName={getFocusClassName(analysisNav.alignBackend)}
                  onValueChange={(align_backend) => mutate({ align_backend })}
                />
              </Field>

              <Field>
                <Label>Auto-analyze</Label>
                <Hint>Automatically queue every unanalyzed song after scans finish</Hint>
                <ButtonGroup>
                  <Button
                    variant={config?.auto_analyze === true ? "outline" : "default"}
                    onClick={() => mutate({ auto_analyze: false })}
                    className={getFocusClassName(analysisNav.autoAnalyze, 0)}
                  >
                    Off
                  </Button>
                  <Button
                    variant={config?.auto_analyze === true ? "default" : "outline"}
                    onClick={() => mutate({ auto_analyze: true })}
                    className={getFocusClassName(analysisNav.autoAnalyze, 1)}
                  >
                    On
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Vocal detection sensitivity</Label>
                <Hint>
                  How loud the vocals must be to count as the song's start and end. Lower it if
                  quiet intros, outros, or soft singing get cut off; raise it to trim more silence (
                  {vocalThresholdDisplayPct}% of the loudest moment)
                </Hint>
                <Slider
                  min={0}
                  max={Math.round(VOCAL_THRESHOLD_MAX * 100)}
                  step={1}
                  value={[vocalThresholdDisplayPct]}
                  onValueChange={([pct]) => updateVocalThreshold(pct / 100)}
                  className={getFocusClassName(analysisNav.vocalThreshold)}
                />
              </Field>

              <Field>
                <Label>Batch Size</Label>
                <Hint>Higher values use more memory but process faster</Hint>
                <NumberButtonGroup
                  name="batch_size"
                  value={batchSize}
                  segment={analysisNav.batchSize}
                  getFocusClassName={getFocusClassName}
                  onChange={(batch_size) => mutate({ batch_size })}
                />
              </Field>
            </FieldGroup>
          </TabsContent>

          <TabsContent value="library" className="mt-4">
            <FieldGroup>
              <Field>
                <Label>Auto rescan library</Label>
                <Hint>
                  Automatically rescan your library on an interval (
                  {autoRescanSeconds > 0 ? `every ${autoRescanSeconds} seconds` : "disabled"})
                </Hint>
                <Slider
                  min={AUTO_RESCAN_SECONDS_MIN}
                  max={AUTO_RESCAN_SECONDS_MAX}
                  step={AUTO_RESCAN_SECONDS_STEP}
                  value={[autoRescanSeconds]}
                  onValueChange={([seconds]) => updateAutoRescanSeconds(seconds)}
                  className={getFocusClassName(NAV.library.autoRescan)}
                />
              </Field>

              <Field>
                <Label>Auto analyze new content</Label>
                <Hint>Automatically analyze songs and videos newly discovered during scans</Hint>
                <ButtonGroup>
                  <Button
                    variant={autoAnalyzeNewContent ? "outline" : "default"}
                    onClick={() => mutate({ auto_analyze_new_content: false })}
                    className={getFocusClassName(NAV.library.autoAnalyzeNewContent, 0)}
                  >
                    Off
                  </Button>
                  <Button
                    variant={autoAnalyzeNewContent ? "default" : "outline"}
                    onClick={() => mutate({ auto_analyze_new_content: true })}
                    className={getFocusClassName(NAV.library.autoAnalyzeNewContent, 1)}
                  >
                    On
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Downtify base URL</Label>
                <Hint>
                  Nightingale uses this service for Request Song search/download ({downtifyBaseUrl})
                </Hint>
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
                  className={getFocusClassName(NAV.library.downtifyBaseUrl)}
                />
              </Field>
            </FieldGroup>
          </TabsContent>

          <TabsContent value="karaoke" className="mt-4">
            <FieldGroup>
              <Field>
                <Label>Karaoke session mode</Label>
                <Hint>Enable host/guest phone control mode</Hint>
                <ButtonGroup>
                  <Button
                    variant={karaokeEnabled ? "default" : "outline"}
                    onClick={() => mutate({ karaoke_enabled: true })}
                    className={getFocusClassName(NAV.karaoke.enabled, 0)}
                  >
                    On
                  </Button>
                  <Button
                    variant={karaokeEnabled ? "outline" : "default"}
                    onClick={() => mutate({ karaoke_enabled: false })}
                    className={getFocusClassName(NAV.karaoke.enabled, 1)}
                  >
                    Off
                  </Button>
                </ButtonGroup>
              </Field>

              <Field>
                <Label>Karaoke join code</Label>
                <Hint>Guests join with this PIN on their phones</Hint>
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
                  className={getFocusClassName(NAV.karaoke.pin)}
                />
              </Field>

              <Field>
                <Label>Host display name</Label>
                <Hint>Name shown when host controls the session</Hint>
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
                  className={getFocusClassName(NAV.karaoke.displayName)}
                />
              </Field>

              <Field>
                <Label>Guest control permissions</Label>
                <Hint>Allow guests to use playback/settings/admin actions (not just queue)</Hint>
                <ButtonGroup>
                  <Button
                    variant={karaokeAllowGuestControls ? "default" : "outline"}
                    onClick={() => mutate({ karaoke_allow_guest_controls: true })}
                    className={getFocusClassName(NAV.karaoke.allowGuestControls, 0)}
                  >
                    Allow
                  </Button>
                  <Button
                    variant={karaokeAllowGuestControls ? "outline" : "default"}
                    onClick={() => mutate({ karaoke_allow_guest_controls: false })}
                    className={getFocusClassName(NAV.karaoke.allowGuestControls, 1)}
                  >
                    Queue Only
                  </Button>
                </ButtonGroup>
              </Field>
            </FieldGroup>
          </TabsContent>
        </Tabs>

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={resetDefaults}
            className={getFocusClassName(footerSegment, 0)}
          >
            Restore Defaults
          </Button>
          <Button variant="outline" onClick={close} className={getFocusClassName(footerSegment, 1)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
