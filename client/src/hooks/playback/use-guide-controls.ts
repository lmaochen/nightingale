/**
 * Guide-vocals volume controls shared by the keyboard shortcuts and the
 * tappable HUD chips. Keeping the toggle / +/- logic (and its config
 * persistence) in one place stops keyboard and touch from drifting apart.
 */

import { usePlaybackTransportActions, usePlaybackTransportState } from "@/contexts/playback";
import { usePlaybackConfigPersist } from "@/hooks/playback/use-playback-config-persist";
import type { AppConfig } from "@/types/AppConfig";
import { useCallback } from "react";

const GUIDE_DEFAULT_VOLUME = 0.3;
const GUIDE_STEP = 0.1;

export interface GuideControls {
  /** False for LRC-provided songs without stems: there is no guide track. */
  guideAvailable: boolean;
  toggleGuide: () => void;
  increaseGuide: () => void;
  decreaseGuide: () => void;
}

export function useGuideControls(config: AppConfig | null): GuideControls {
  const { guideVolume, guideAvailable } = usePlaybackTransportState();
  const { setGuideVolume } = usePlaybackTransportActions();
  const persistConfig = usePlaybackConfigPersist(config);

  const applyGuideVolume = useCallback(
    (next: number) => {
      if (!guideAvailable) return;
      setGuideVolume(next);
      persistConfig({ guide_volume: next });
    },
    [guideAvailable, setGuideVolume, persistConfig],
  );

  const toggleGuide = useCallback(() => {
    applyGuideVolume(guideVolume > 0 ? 0 : GUIDE_DEFAULT_VOLUME);
  }, [applyGuideVolume, guideVolume]);

  const increaseGuide = useCallback(() => {
    applyGuideVolume(Math.min(1, guideVolume + GUIDE_STEP));
  }, [applyGuideVolume, guideVolume]);

  const decreaseGuide = useCallback(() => {
    applyGuideVolume(Math.max(0, guideVolume - GUIDE_STEP));
  }, [applyGuideVolume, guideVolume]);

  return { guideAvailable, toggleGuide, increaseGuide, decreaseGuide };
}
