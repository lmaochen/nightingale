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
  const { snapshot, me, actions } = useJukeboxSession();
  const navigate = useNavigate();
  const location = useLocation();
  const launchingRef = useRef(false);
  const currentPlaybackHash =
    location.pathname === "/playback" &&
    location.state &&
    typeof (location.state as { song?: Song }).song?.file_hash === "string"
      ? (location.state as { song: Song }).song.file_hash
      : null;

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
    if (launchingRef.current) return;

    let targetSong: Song | null = null;
    if (snapshot.current_song) {
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
  }, [actions, currentPlaybackHash, me, navigate, snapshot, songs]);
}
