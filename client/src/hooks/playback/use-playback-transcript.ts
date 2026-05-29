/**
 * Loads the transcript for the current track and normalizes segments for display.
 */

import { loadTranscript } from "@/bridge/playback";
import type { Segment, Transcript } from "@/types/Transcript";
import { useEffect, useState } from "react";
import { splitLongSegments } from "@/utils/playback/transcript-segments";

export function usePlaybackTranscript(fileHash: string) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [transcriptSource, setTranscriptSource] = useState("generated");

  useEffect(() => {
    let cancelled = false;
    setSegments([]);

    const loadWithRetry = async () => {
      const MAX_ATTEMPTS = 8;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        try {
          const transcript = await loadTranscript(fileHash);
          if (cancelled) return;
          setSegments(splitLongSegments((transcript as Transcript).segments));
          setTranscriptSource((transcript as Transcript).source ?? "generated");
          return;
        } catch {
          if (cancelled) return;
          if (attempt >= MAX_ATTEMPTS - 1) {
            setSegments([]);
            setTranscriptSource("generated");
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 750));
        }
      }
    };

    void loadWithRetry();
    return () => {
      cancelled = true;
    };
  }, [fileHash]);

  return { segments, transcriptSource };
}
