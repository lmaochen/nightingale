import {
  usePlaybackMicActions,
  usePlaybackMicState,
  usePlaybackThemeActions,
  usePlaybackThemeState,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from "@/contexts/playback";
import { useGuideControls } from "@/hooks/playback";
import type { JukeboxQueueItem } from "@/hooks/use-jukebox-session";
import type { AppConfig } from "@/types/AppConfig";
import { forwardRef, memo, useCallback, useEffect, useRef } from "react";
import { isPixabayTheme, themeName } from "./background";

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds) % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatGuideText(volume: number): string {
  const pct = Math.round(volume * 100);
  return pct === 0 ? "Guide: OFF" : `Guide: ${pct}%`;
}

const SkipButton = forwardRef<HTMLButtonElement, { label: string; onClick: () => void }>(
  ({ label, onClick }, ref) => (
    <button
      ref={ref}
      onClick={onClick}
      className="pointer-events-auto flex gap-1 rounded-sm border-2 border-white/70 bg-black/10 px-2.5 py-1 text-sm text-white/90 transition-colors hover:bg-black/20"
      style={{ display: "none" }}
    >
      <span>{label}</span> <span>⏎</span>
    </button>
  ),
);

/**
 * A tappable shortcut chip. Shows the keyboard key (so it doubles as a hint)
 * while giving touch users a real, finger-sized target for the same action.
 */
function KeyChip({
  label,
  ariaLabel,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="pointer-events-auto inline-flex min-h-[1.75rem] min-w-[1.75rem] touch-manipulation items-center justify-center rounded-sm border border-white/20 px-1.5 text-xs text-white/70 transition-colors hover:bg-white/15 active:bg-white/30"
    >
      {label}
    </button>
  );
}

/** A HUD row: greyed-out status text followed by its tappable shortcut chips. */
function HintRow({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-sm text-white/50">
      <span>{text}</span>
      {children}
    </div>
  );
}

const FOOTER_NOTE_CLASS = `pointer-events-none absolute bottom-2 z-20 text-[0.6rem] text-white/30`;

function Disclaimer({ source }: { source: string }) {
  if (source === "usdx") {
    return null;
  }

  const text =
    source === "lyrics"
      ? "Timing is AI-generated and may not be perfectly accurate"
      : "Lyrics and timing are AI-generated and may not be perfectly accurate";

  return (
    <p className={`${FOOTER_NOTE_CLASS} left-1/2 -translate-x-1/2 whitespace-nowrap text-center`}>
      {text}
    </p>
  );
}

interface PlaybackHudProps {
  title: string;
  artist: string;
  config: AppConfig | null;
  karaokeQueue?: JukeboxQueueItem[];
}

function PlaybackHudImpl({ title, artist, config, karaokeQueue = [] }: PlaybackHudProps) {
  const { duration, guideVolume, paused } = usePlaybackTransportState();
  const { subscribe, getCurrentTime, handlePause, handleContinue } =
    usePlaybackTransportActions();
  const { themeIndex, videoFlavor } = usePlaybackThemeState();
  const { cycleTheme, cycleFlavor } = usePlaybackThemeActions();
  const { firstSegmentStart, lastSegmentEnd, introSkipLeadSec, transcriptSource } =
    usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { handleToggleMic, handleCycleMic, handleToggleMicMonitor } = usePlaybackMicActions();
  const { pitchScore, micUserEnabled, micName, micMonitorUserEnabled } = usePlaybackMicState();
  const { toggleGuide, increaseGuide, decreaseGuide } = useGuideControls(config);

  // Mirrors the keyboard/gamepad "back" action: pause, or resume if paused.
  const handleBack = useCallback(() => {
    if (paused) {
      handleContinue();
    } else {
      handlePause();
    }
  }, [paused, handlePause, handleContinue]);

  const lastSecondRef = useRef(-1);
  const timerRef = useRef<HTMLParagraphElement>(null);
  const skipIntroRef = useRef<HTMLButtonElement>(null);
  const skipOutroRef = useRef<HTMLButtonElement>(null);

  const showPixabayCredit = isPixabayTheme(themeIndex);
  const upcomingQueue = karaokeQueue.slice(0, 4);

  // Updates the timer text and skip-button visibility via direct DOM mutation
  // (rAF subscriber), only triggering a text update when the displayed second changes.
  useEffect(() => {
    if (timerRef.current) {
      timerRef.current.textContent = `${formatTime(getCurrentTime())} / ${formatTime(duration)}`;
    }

    return subscribe((time) => {
      const sec = Math.floor(time);
      if (sec !== lastSecondRef.current) {
        lastSecondRef.current = sec;
        if (timerRef.current) {
          timerRef.current.textContent = `${formatTime(time)} / ${formatTime(duration)}`;
        }
      }

      if (skipIntroRef.current) {
        skipIntroRef.current.style.display =
          time < firstSegmentStart - introSkipLeadSec ? "" : "none";
      }
      if (skipOutroRef.current) {
        skipOutroRef.current.style.display = time > lastSegmentEnd + 1 ? "" : "none";
      }
    });
  }, [subscribe, getCurrentTime, duration, firstSegmentStart, introSkipLeadSec, lastSegmentEnd]);

  return (
    <>
      <div className="pointer-events-auto absolute inset-x-0 top-3 z-20 flex justify-between px-4">
        <div className="max-w-[40%] overflow-hidden">
          <h1 className="truncate text-[1.375rem] text-white">{title}</h1>
          <p className="truncate text-base text-white/70">{artist}</p>
          <p ref={timerRef} className="text-base text-white/70">
            0:00 / {formatTime(duration)}
          </p>
          <div className="mt-2 flex gap-2">
            <SkipButton ref={skipIntroRef} label="Skip Intro" onClick={handleSkipIntro} />
            <SkipButton ref={skipOutroRef} label="Skip Outro" onClick={handleSkipOutro} />
          </div>
          {upcomingQueue.length > 0 && (
            <div className="mt-3 max-w-md rounded-md border border-white/20 bg-black/35 p-2">
              <p className="text-xs font-medium text-white/70">Up next</p>
              <div className="mt-1 space-y-1">
                {upcomingQueue.map((item, index) => (
                  <p key={item.id} className="truncate text-xs text-white/75">
                    {index + 1}. {item.title} - {item.requested_by_display_name}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className={`text-lg text-white${pitchScore ? "" : "/50"}`}>
            Score: {pitchScore ?? "--"}
          </div>
          <HintRow text={formatGuideText(guideVolume)}>
            <KeyChip label="G" ariaLabel="Toggle guide vocals" onClick={toggleGuide} />
            <KeyChip label="+" ariaLabel="Increase guide volume" onClick={increaseGuide} />
            <KeyChip label="−" ariaLabel="Decrease guide volume" onClick={decreaseGuide} />
          </HintRow>
          <HintRow text={`Mic: ${micUserEnabled ? micName : "OFF"}`}>
            <KeyChip label="M" ariaLabel="Toggle microphone" onClick={handleToggleMic} />
            <KeyChip label="N" ariaLabel="Next microphone" onClick={handleCycleMic} />
          </HintRow>
          <HintRow text={`Monitor: ${micMonitorUserEnabled ? "ON" : "OFF"}`}>
            <KeyChip label="R" ariaLabel="Toggle mic monitor" onClick={handleToggleMicMonitor} />
          </HintRow>
          <HintRow text={`Theme: ${themeName(themeIndex, videoFlavor)}`}>
            <KeyChip label="T" ariaLabel="Cycle theme" onClick={cycleTheme} />
            {isPixabayTheme(themeIndex) && (
              <KeyChip label="F" ariaLabel="Cycle video flavor" onClick={cycleFlavor} />
            )}
          </HintRow>
          <HintRow text="Back">
            <KeyChip label="ESC" ariaLabel="Back" onClick={handleBack} />
          </HintRow>
        </div>
      </div>

      {showPixabayCredit && <p className={`${FOOTER_NOTE_CLASS} right-4`}>Videos by Pixabay</p>}

      <Disclaimer source={transcriptSource} />
    </>
  );
}

export const PlaybackHud = memo(PlaybackHudImpl);
