/**
 * Playback session: audio engine, visual background, lyrics HUD, and pause overlay.
 * Route shell (`Playback`) mounts this with a `key` of `file_hash` so state resets per track.
 *
 * `PlaybackInner` itself is the provider shell; `PlaybackLayout` is the
 * presentational tree that consumes the playback contexts via hooks.
 */

import { Background } from "@/components/playback/background";
import { ResultDialog } from "@/components/playback/dialogs/result";
import { LyricsDisplay } from "@/components/playback/lyrics-display";
import { PauseOverlay } from "@/components/playback/pause-overlay";
import { PitchGraph } from "@/components/playback/pitch-graph";
import { PlaybackHud } from "@/components/playback/playback-hud";
import {
  PlaybackProviders,
  usePlaybackThemeActions,
  usePlaybackThemeState,
  usePlaybackMicState,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from "@/contexts/playback";
import { usePlaybackInput, usePlaybackResult } from "@/hooks/playback";
import { useJukeboxSession } from "@/hooks/use-jukebox-session";
import type { AppConfig } from "@/types/AppConfig";
import type { Song } from "@/types/Song";
import { useCallback, useEffect, useMemo, useRef } from "react";

const KARAOKE_JOIN_INTENT_KEY = "nightingale.karaoke.join-intent";

function isHostBoothIntentActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(KARAOKE_JOIN_INTENT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { asHost?: unknown };
    return parsed.asHost === true;
  } catch {
    return false;
  }
}

export interface PlaybackInnerProps {
  song: Song;
  config: AppConfig | null;
}

interface PlaybackLayoutProps {
  song: Song;
  config: AppConfig | null;
}

function PlaybackLayout({ song, config }: PlaybackLayoutProps) {
  const { isReady, isBooting, isFinished, paused, guideVolume, stemsReady, bootStage } =
    usePlaybackTransportState();
  const { handleContinue, handleExit, handlePause, setGuideVolume } = usePlaybackTransportActions();
  const { themeIndex } = usePlaybackThemeState();
  const { setThemeIndex } = usePlaybackThemeActions();
  const { segments } = usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { series } = usePlaybackMicState();
  const { snapshot, me, actions } = useJukeboxSession({ autoJoinPersistedIntent: false });
  const skipIntroSignalRef = useRef(0);
  const skipOutroSignalRef = useRef(0);
  const canPatchSessionSettings = useMemo(() => {
    if (!snapshot || !me) return false;
    return snapshot.host === me.client_id || snapshot.allow_guest_controls;
  }, [snapshot, me]);
  const performanceMode = config?.playback_performance_mode ?? false;
  const showPitchGraph = config?.playback_show_pitch_graph ?? true;
  const clearedFinishedSongRef = useRef(false);

  usePlaybackInput(config);
  const result = usePlaybackResult(song);

  useEffect(() => {
    if (!isFinished) {
      clearedFinishedSongRef.current = false;
      return;
    }
    if (clearedFinishedSongRef.current) return;
    if (!isHostBoothIntentActive()) return;
    clearedFinishedSongRef.current = true;
    actions.patchPlayback({
      currentSong: null,
      paused: false,
      positionMs: 0,
    });
  }, [actions, isFinished]);

  useEffect(() => {
    if (!isReady || !snapshot) return;
    if (snapshot.paused && !paused) {
      handlePause();
      return;
    }
    if (!snapshot.paused && paused) {
      handleContinue();
    }
  }, [handleContinue, handlePause, isReady, paused, snapshot]);

  useEffect(() => {
    if (!isReady || !snapshot) return;
    const target = snapshot.guide_volume;
    if (typeof target !== "number") return;
    if (Math.abs(target - guideVolume) < 0.01) return;
    setGuideVolume(Math.max(0, Math.min(1, target)));
  }, [guideVolume, isReady, setGuideVolume, snapshot]);

  useEffect(() => {
    if (!isReady || !snapshot) return;
    if (typeof snapshot.theme !== "number") return;
    if (snapshot.theme === themeIndex) return;
    setThemeIndex(snapshot.theme);
  }, [isReady, setThemeIndex, snapshot, themeIndex]);

  const handleGuideVolumeChange = useCallback(
    (nextVolume: number) => {
      if (!canPatchSessionSettings) return;
      actions.patchSettings({ guideVolume: nextVolume });
    },
    [actions, canPatchSessionSettings],
  );

  const handleThemeChange = useCallback(
    (nextTheme: number) => {
      if (!canPatchSessionSettings) return;
      actions.patchSettings({ theme: nextTheme });
    },
    [actions, canPatchSessionSettings],
  );

  useEffect(() => {
    if (!isReady || !snapshot) return;
    const currentIdentity = `file_hash:${song.file_hash}`;
    if (snapshot.skip_intro_target !== currentIdentity) return;
    if (snapshot.skip_intro_signal > skipIntroSignalRef.current) {
      skipIntroSignalRef.current = snapshot.skip_intro_signal;
      handleSkipIntro();
    }
  }, [handleSkipIntro, isReady, snapshot, song.file_hash]);

  useEffect(() => {
    if (!isReady || !snapshot) return;
    const currentIdentity = `file_hash:${song.file_hash}`;
    if (snapshot.skip_outro_target !== currentIdentity) return;
    if (snapshot.skip_outro_signal > skipOutroSignalRef.current) {
      skipOutroSignalRef.current = snapshot.skip_outro_signal;
      handleSkipOutro();
    }
  }, [handleSkipOutro, isReady, snapshot, song.file_hash]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black" style={{ contain: "strict" }}>
      <Background performanceMode={performanceMode} />

      {(isBooting || !isReady) && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/80">
          <div className="rounded-md border border-white/20 bg-black/70 px-4 py-3 text-center">
            <p className="text-sm uppercase tracking-[0.18em] text-white/65">Preparing Playback</p>
            <p className="mt-1 text-xs text-white/75">Loading stems, audio, and visuals...</p>
            <p className="mt-2 text-[11px] text-white/60">
              Stems: {stemsReady ? "ready" : "loading"} | Audio: {isReady ? "ready" : "decoding"} |
              {" "}Stage: {bootStage}
            </p>
          </div>
        </div>
      )}

      {isReady && !isBooting && (
        <>
          <PlaybackHud
            title={song.title}
            artist={song.artist}
            config={config}
            karaokeQueue={snapshot?.queue ?? []}
            canPatchSessionSettings={canPatchSessionSettings}
            onGuideVolumeChange={handleGuideVolumeChange}
            onThemeChange={handleThemeChange}
          />
          {showPitchGraph && <PitchGraph series={series} />}
          <LyricsDisplay
            segments={segments}
            position={config?.lyrics_position ?? "bottom"}
            fontScale={config?.lyrics_font_scale ?? 1}
            performanceMode={performanceMode}
          />
        </>
      )}

      <PauseOverlay open={paused && !result.open} onContinue={handleContinue} onExit={handleExit} />

      <ResultDialog
        open={result.open}
        score={result.score}
        song={song}
        scores={result.scores}
        activeProfile={result.activeProfile}
        onFinish={result.onFinish}
      />
    </div>
  );
}

export function PlaybackInner({ song, config }: PlaybackInnerProps) {
  return (
    <PlaybackProviders song={song} config={config}>
      <PlaybackLayout song={song} config={config} />
    </PlaybackProviders>
  );
}
