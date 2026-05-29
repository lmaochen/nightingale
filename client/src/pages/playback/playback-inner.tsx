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
import { useEffect, useRef } from "react";

export interface PlaybackInnerProps {
  song: Song;
  config: AppConfig | null;
}

interface PlaybackLayoutProps {
  song: Song;
  config: AppConfig | null;
}

function PlaybackLayout({ song, config }: PlaybackLayoutProps) {
  const { isReady, paused, guideVolume } = usePlaybackTransportState();
  const { handleContinue, handleExit, handlePause, setGuideVolume } = usePlaybackTransportActions();
  const { themeIndex } = usePlaybackThemeState();
  const { setThemeIndex } = usePlaybackThemeActions();
  const { segments } = usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { series } = usePlaybackMicState();
  const { snapshot } = useJukeboxSession({ autoJoinPersistedIntent: false });
  const skipIntroSignalRef = useRef(0);
  const skipOutroSignalRef = useRef(0);

  usePlaybackInput(config);
  const result = usePlaybackResult(song);

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
      <Background />

      {isReady && (
        <>
          <PlaybackHud
            title={song.title}
            artist={song.artist}
            config={config}
            karaokeQueue={snapshot?.queue ?? []}
          />
          <PitchGraph series={series} />
          <LyricsDisplay
            segments={segments}
            position={config?.lyrics_position ?? "bottom"}
            fontScale={config?.lyrics_font_scale ?? 1}
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
