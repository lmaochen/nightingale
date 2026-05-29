import { loadSongs } from "@/bridge/songs";
import { ensureMp3Stems } from "@/bridge/playback";
import { prewarmPlaybackAudio } from "@/hooks/use-audio-player";
import { useJukeboxSession } from "@/hooks/use-jukebox-session";
import { useConfig } from "@/queries/use-config";
import type { Song } from "@/types/Song";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

const MAX_HOST_AUTOPLAY_SONGS = 5000;
const KARAOKE_JOIN_INTENT_KEY = "nightingale.karaoke.join-intent";

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveSongRef(songRef: string, songs: Song[]) {
  if (!songRef.trim()) return null;
  if (songRef.startsWith("file_hash:")) {
    const hash = songRef.slice("file_hash:".length).trim();
    return songs.find((song) => song.file_hash === hash) ?? null;
  }
  if (songRef.startsWith("song_id:") || songRef.startsWith("url:")) {
    return null;
  }
  const normalizedRef = normalize(songRef);
  return songs.find((song) => normalize(song.title) === normalizedRef) ?? null;
}

function resolveQueuedSong(queueItem: { title: string; artist: string; song: Record<string, unknown> }, songs: Song[]) {
  const explicitHash = queueItem.song.file_hash;
  if (typeof explicitHash === "string") {
    const byHash = songs.find((song) => song.file_hash === explicitHash);
    if (byHash) return byHash;
  }

  const title =
    (typeof queueItem.song.name === "string" && queueItem.song.name.trim()) || queueItem.title || "";
  const artistsArray = Array.isArray(queueItem.song.artists)
    ? queueItem.song.artists.filter((a): a is string => typeof a === "string")
    : [];
  const primaryArtist = artistsArray[0] ?? queueItem.artist ?? "";

  const normalizedTitle = normalize(title);
  const normalizedArtist = normalize(primaryArtist);

  if (!normalizedTitle) return null;

  return (
    songs.find((song) => {
      const songTitle = normalize(song.title);
      const songArtist = normalize(song.artist);
      if (songTitle !== normalizedTitle) return false;
      if (!normalizedArtist) return true;
      return songArtist.includes(normalizedArtist) || normalizedArtist.includes(songArtist);
    }) ?? null
  );
}

/**
 * Host-side controller for "traditional karaoke" behavior:
 * when idle and queue has entries, auto-start the first playable song.
 */
export function useKaraokeHostAutoplay() {
  const { snapshot, actions } = useJukeboxSession({ autoJoinPersistedIntent: false });
  const { data: config } = useConfig();
  const navigate = useNavigate();
  const location = useLocation();
  const autoNextRequested =
    location.pathname === "/host" &&
    new URLSearchParams(location.search).get("autoNext") === "1";
  const launchingRef = useRef(false);
  const prewarmedHashesRef = useRef(new Set<string>());
  const prewarmingHashesRef = useRef(new Set<string>());
  const lastReportedDecodeRef = useRef<string>("");
  const isHostDevice =
    typeof window !== "undefined" &&
    (() => {
      try {
        const raw = window.localStorage.getItem(KARAOKE_JOIN_INTENT_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw) as { asHost?: unknown };
        return parsed.asHost === true;
      } catch {
        return false;
      }
    })();
  const currentPlaybackHash =
    location.pathname === "/playback" &&
    location.state &&
    typeof (location.state as { song?: Song }).song?.file_hash === "string"
      ? (location.state as { song: Song }).song.file_hash
      : null;
  const isHostRuntime = isHostDevice || location.pathname === "/host" || location.pathname === "/playback";

  const { data: songsData } = useQuery({
    queryKey: ["karaoke-host-autoplay-songs"],
    queryFn: async () =>
      loadSongs({
        search: null,
        filters: { artist: null, album: null, query: null },
        skip: 0,
        take: MAX_HOST_AUTOPLAY_SONGS,
      }),
    refetchInterval: 2500,
  });

  const songs = useMemo(() => songsData?.processed ?? [], [songsData?.processed]);
  const performanceMode = config?.playback_performance_mode ?? false;
  const warmupCacheEnabled = config?.playback_warmup_cache_enabled ?? true;

  const reportDecodeStatus = useCallback(
    (fileHash: string | null, status: "cold" | "warming" | "warm" | "failed", error?: string) => {
      const key = `${fileHash ?? ""}|${status}|${error ?? ""}`;
      if (lastReportedDecodeRef.current === key) return;
      lastReportedDecodeRef.current = key;
      actions.reportHostDecodeStatus({
        fileHash,
        status,
        error: error ?? null,
      });
    },
    [actions],
  );

  useEffect(() => {
    if (!snapshot || !isHostRuntime) return;
    if (!warmupCacheEnabled) {
      reportDecodeStatus(null, "cold");
      return;
    }
    const isActivelyPlaying = Boolean(snapshot.current_song) && snapshot.paused === false;
    if (!isActivelyPlaying) {
      reportDecodeStatus(null, "cold");
      return;
    }
    if (snapshot.queue.length === 0) {
      reportDecodeStatus(null, "cold");
      return;
    }
    const nextQueued = snapshot.queue[0];
    const queuedHash = nextQueued.song?.["file_hash"];
    const hash = typeof queuedHash === "string" && queuedHash.trim().length > 0 ? queuedHash : null;
    if (!hash) {
      reportDecodeStatus(null, "cold");
      return;
    }
    if (prewarmedHashesRef.current.has(hash) || prewarmingHashesRef.current.has(hash)) {
      if (hash && prewarmedHashesRef.current.has(hash)) {
        reportDecodeStatus(hash, "warm");
      } else if (hash && prewarmingHashesRef.current.has(hash)) {
        reportDecodeStatus(hash, "warming");
      }
      return;
    }

    prewarmingHashesRef.current.add(hash);
    if (prewarmedHashesRef.current.size > 64) {
      // Keep memory bounded for long-running host sessions.
      prewarmedHashesRef.current.clear();
      prewarmingHashesRef.current.clear();
      prewarmingHashesRef.current.add(hash);
    }

    try {
      ensureMp3Stems(hash);
      reportDecodeStatus(hash, "warming");
      const attemptPrewarm = (attempt: number) => {
        void prewarmPlaybackAudio(hash, undefined, { sequential: performanceMode })
          .then(() => {
            prewarmingHashesRef.current.delete(hash);
            prewarmedHashesRef.current.add(hash);
            reportDecodeStatus(hash, "warm");
          })
          .catch((error) => {
            if (attempt >= 8) {
              // Give up for now and allow a future retry.
              prewarmingHashesRef.current.delete(hash);
              const message = error instanceof Error ? error.message : String(error);
              reportDecodeStatus(hash, "failed", message);
              return;
            }
            window.setTimeout(() => attemptPrewarm(attempt + 1), 1500);
          });
      };

      window.setTimeout(() => {
        attemptPrewarm(0);
      }, 250);
    } catch {
      // Allow retry on transient failures.
      prewarmingHashesRef.current.delete(hash);
      prewarmedHashesRef.current.delete(hash);
      reportDecodeStatus(hash, "failed", "stems-prep-failed");
    }
  }, [isHostRuntime, performanceMode, reportDecodeStatus, snapshot, warmupCacheEnabled]);

  useEffect(() => {
    if (!snapshot || !isHostRuntime) return;
    if (launchingRef.current) return;

    let targetSong: Song | null = null;
    if (snapshot.current_song && !autoNextRequested) {
      targetSong = resolveSongRef(snapshot.current_song, songs);
    }

    if (!targetSong && !snapshot.current_song && snapshot.queue.length > 0) {
      const nextQueued = snapshot.queue[0];
      targetSong = resolveQueuedSong(nextQueued, songs);
      if (targetSong) {
        actions.patchPlayback({
          currentSong: `file_hash:${targetSong.file_hash}`,
          paused: false,
          positionMs: 0,
        });
        actions.removeFromQueue(nextQueued.id);
      }
    }

    if (!targetSong) return;
    if (currentPlaybackHash === targetSong.file_hash) return;

    launchingRef.current = true;
    navigate("/playback", { state: { song: targetSong } });
    window.setTimeout(() => {
      launchingRef.current = false;
    }, 800);
  }, [actions, autoNextRequested, currentPlaybackHash, isHostRuntime, navigate, snapshot, songs]);
}
