import { loadSongs } from "@/bridge/songs";
import { useJukeboxSession } from "@/hooks/use-jukebox-session";
import type { Song } from "@/types/Song";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

const MAX_HOST_AUTOPLAY_SONGS = 5000;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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
  const { snapshot, me, actions } = useJukeboxSession();
  const navigate = useNavigate();
  const location = useLocation();
  const launchingRef = useRef(false);

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

  useEffect(() => {
    if (!snapshot || !me || me.role !== "host") return;
    if (location.pathname === "/playback") return;
    if (snapshot.queue.length === 0) return;
    if (launchingRef.current) return;

    const nextQueued = snapshot.queue[0];
    const matchedSong = resolveQueuedSong(nextQueued, songs);
    if (!matchedSong) return;

    launchingRef.current = true;
    actions.patchPlayback({
      currentSong: matchedSong.title,
      paused: false,
      positionMs: 0,
    });
    actions.removeFromQueue(nextQueued.id);
    navigate("/playback", { state: { song: matchedSong } });
    window.setTimeout(() => {
      launchingRef.current = false;
    }, 800);
  }, [actions, location.pathname, me, navigate, snapshot, songs]);
}
