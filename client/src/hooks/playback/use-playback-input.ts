import {
  usePlaybackMicActions,
  usePlaybackThemeActions,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from "@/contexts/playback";
import { useNavInput } from "@/hooks/navigation/use-nav-input";
import { useGuideControls } from "@/hooks/playback/use-guide-controls";
import type { AppConfig } from "@/types/AppConfig";
import { useCallback, useEffect, useRef } from "react";

/**
 * Wires keyboard + gamepad input for the playback session. Reads everything it
 * needs from the playback contexts; only the app config is passed in so we can
 * persist guide-volume changes without coupling this hook to the config query.
 */
export function usePlaybackInput(config: AppConfig | null) {
  const { paused, isReady } = usePlaybackTransportState();
  const { getCurrentTime, handlePause, handleContinue } = usePlaybackTransportActions();
  const { cycleTheme, cycleFlavor } = usePlaybackThemeActions();
  const { firstSegmentStart, lastSegmentEnd, introSkipLeadSec, hasSegments } =
    usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { handleToggleMic, handleCycleMic, handleToggleMicMonitor } = usePlaybackMicActions();
  const { toggleGuide, increaseGuide, decreaseGuide } = useGuideControls(config);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Gamepad: nav.back = pause/resume, nav.confirm = skip intro/outro
  useNavInput(
    useCallback(
      (action) => {
        if (action.back) {
          if (pausedRef.current) {
            handleContinue();
          } else {
            handlePause();
          }
          return;
        }

        if (pausedRef.current) return;

        if (action.confirm) {
          if (!isReady || !hasSegments) return;
          const t = getCurrentTime();
          if (t < firstSegmentStart - introSkipLeadSec) {
            handleSkipIntro();
          } else if (t > lastSegmentEnd + 1) {
            handleSkipOutro();
          }
        }
      },
      [
        handlePause,
        handleContinue,
        isReady,
        getCurrentTime,
        hasSegments,
        firstSegmentStart,
        lastSegmentEnd,
        introSkipLeadSec,
        handleSkipIntro,
        handleSkipOutro,
      ],
    ),
  );

  // Keyboard-only shortcuts (G, T, F, M, N, R, +/-, Space)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        if (paused) {
          handleContinue();
        } else {
          handlePause();
        }
        return;
      }

      if (paused) return;

      switch (e.key) {
        case "t":
        case "T":
          cycleTheme();
          break;

        case "f":
        case "F":
          cycleFlavor();
          break;

        case "g":
        case "G":
          toggleGuide();
          break;

        case "=":
        case "+":
          increaseGuide();
          break;

        case "-":
          decreaseGuide();
          break;

        case "m":
        case "M":
          handleToggleMic();
          break;

        case "n":
        case "N":
          handleCycleMic();
          break;

        case "r":
        case "R":
          handleToggleMicMonitor();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    paused,
    toggleGuide,
    increaseGuide,
    decreaseGuide,
    cycleTheme,
    cycleFlavor,
    handlePause,
    handleContinue,
    handleToggleMic,
    handleCycleMic,
    handleToggleMicMonitor,
  ]);
}
