import { loadSongs } from "@/bridge/songs";
import {
  downtifyLoadQueue,
  downtifyQueueDownload,
  downtifySearchSongs,
  type DowntifyQueueEntry,
  type DowntifySong,
} from "@/bridge/downtify";
import { convertFileSrc } from "@/bridge/media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useJukeboxSession } from "@/hooks/use-jukebox-session";
import type { Song } from "@/types/Song";
import { loadAnalysisQueue } from "@/bridge/songs";
import { ANALYSIS_QUEUE, DOWNTIFY_QUEUE } from "@/queries/keys";
import { useLibraryMenuItems } from "@/queries/use-library-menu-items";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const DEFAULT_JOIN_NAME = "Guest";
const LIBRARY_TAKE = 120;
const DEFAULT_LIBRARY_FILTER = "all";

type LibraryFilterMode = "all" | "analysed" | "unanalysed" | "videos";

type ImportStage =
  | { kind: "downloading" }
  | { kind: "waiting-library" }
  | { kind: "analyzing"; pct: number }
  | { kind: "queued" }
  | { kind: "failed"; message: string };

interface PendingImport {
  key: string;
  title: string;
  artist: string;
  song: DowntifySong;
  stage: ImportStage;
}

function formatAnalysisStatus(status: unknown): string {
  if (status === "Queued") return "Queued";
  if (status && typeof status === "object") {
    if ("Analyzing" in status && typeof (status as { Analyzing?: unknown }).Analyzing === "number") {
      return `Analyzing ${Math.round((status as { Analyzing: number }).Analyzing)}%`;
    }
    if ("Failed" in status && typeof (status as { Failed?: unknown }).Failed === "string") {
      return `Failed: ${(status as { Failed: string }).Failed}`;
    }
  }
  return "Queued";
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function artistInitial(value: string): string | null {
  const initial = value.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(initial) ? initial : null;
}

function artistAnchorId(initial: string): string {
  return `join-artist-anchor-${initial}`;
}

function pendingKey(song: DowntifySong): string {
  if (typeof song.song_id === "string" && song.song_id.length > 0) return `song_id:${song.song_id}`;
  if (typeof song.url === "string" && song.url.length > 0) return `url:${song.url}`;
  return `raw:${JSON.stringify(song)}`;
}

function pendingTitle(song: DowntifySong): string {
  return typeof song.name === "string" && song.name.trim().length > 0 ? song.name : "Unknown title";
}

function pendingArtist(song: DowntifySong): string {
  if (Array.isArray(song.artists) && song.artists.length > 0) {
    return song.artists.filter((v) => typeof v === "string").join(", ") || "Unknown artist";
  }
  return "Unknown artist";
}

export function KaraokeJoinPage() {
  const { connected, snapshot, me, actions } = useJukeboxSession();
  const [name, setName] = useState(DEFAULT_JOIN_NAME);
  const [pin, setPin] = useState("");
  const [query, setQuery] = useState("");
  const [artistQuery, setArtistQuery] = useState("");
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [showArtistSection, setShowArtistSection] = useState(true);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Song[]>([]);
  const [importQuery, setImportQuery] = useState("");
  const [importSearching, setImportSearching] = useState(false);
  const [importResults, setImportResults] = useState<DowntifySong[]>([]);
  const [downloadingSongId, setDownloadingSongId] = useState<string | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilterMode>(DEFAULT_LIBRARY_FILTER);
  const [pendingImports, setPendingImports] = useState<PendingImport[]>([]);
  const downtifyQueueQuery = useQuery({
    queryKey: DOWNTIFY_QUEUE,
    queryFn: downtifyLoadQueue,
    enabled: true,
    refetchInterval: 2000,
  });
  const downtifyActiveQueue = useMemo(
    () =>
      (downtifyQueueQuery.data ?? []).filter(
        (entry: DowntifyQueueEntry) => entry.status === "queued" || entry.status === "downloading",
      ),
    [downtifyQueueQuery.data],
  );
  const analysisQuery = useQuery({
    queryKey: ANALYSIS_QUEUE,
    queryFn: loadAnalysisQueue,
    enabled: true,
    refetchInterval: 2000,
  });
  const analysisEntries = useMemo(
    () => Object.entries(analysisQuery.data?.entries ?? {}).slice(0, 6),
    [analysisQuery.data],
  );
  const fullAnalysisEntries = analysisQuery.data?.entries ?? {};
  const { data: libraryMenu } = useLibraryMenuItems();
  const catalogQuery = useQuery({
    queryKey: ["join-library-catalog"],
    queryFn: async () =>
      loadSongs({
        search: null,
        filters: { artist: null, album: null, query: null },
        skip: 0,
        take: LIBRARY_TAKE,
      }),
    enabled: pendingImports.length > 0,
    refetchInterval: pendingImports.length > 0 ? 2500 : false,
  });
  const catalogSongs = catalogQuery.data?.processed ?? [];

  const libraryQuery = useMemo(() => {
    const q = query.trim();
    return q.length > 0 ? q : null;
  }, [query]);
  const artistNeedle = useMemo(() => normalize(artistQuery), [artistQuery]);
  const allArtists = useMemo(
    () => (libraryMenu?.artists ?? []).map((item) => item.label).filter((label) => label.trim().length > 0),
    [libraryMenu?.artists],
  );
  const visibleArtists = useMemo(
    () =>
      allArtists
        .filter((artist) => (artistNeedle.length > 0 ? normalize(artist).includes(artistNeedle) : true))
        .slice(0, 120),
    [allArtists, artistNeedle],
  );
  const artistInitials = useMemo(() => {
    const initials = new Set<string>();
    for (const artist of allArtists) {
      const initial = artistInitial(artist);
      if (initial) initials.add(initial);
    }
    return [...initials].sort();
  }, [allArtists]);
  const firstVisibleArtistByInitial = useMemo(() => {
    const first = new Map<string, string>();
    for (const artist of visibleArtists) {
      const initial = artistInitial(artist);
      if (!initial || first.has(initial)) continue;
      first.set(initial, artist);
    }
    return first;
  }, [visibleArtists]);

  const canControl = useMemo(() => {
    if (!snapshot || !me) return false;
    return snapshot.host === me.client_id || snapshot.allow_guest_controls;
  }, [snapshot, me]);
  const queuedHashes = useMemo(() => {
    const hashes = new Set<string>();
    for (const item of snapshot?.queue ?? []) {
      const hash = item.song?.file_hash;
      if (typeof hash === "string" && hash.length > 0) hashes.add(hash);
    }
    return hashes;
  }, [snapshot?.queue]);

  const joinSession = () => {
    actions.join(pin, name.trim() || DEFAULT_JOIN_NAME, false);
  };

  const loadLatestSongs = useCallback(async () => {
    setSearching(true);
    try {
      const result = await loadSongs({
        search: libraryQuery,
        filters: { artist: selectedArtist, album: null, query: null },
        skip: 0,
        take: LIBRARY_TAKE,
      });
      setResults(result.processed);
    } finally {
      setSearching(false);
    }
  }, [libraryQuery, selectedArtist]);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      await loadLatestSongs();
    } finally {
      setSearching(false);
    }
  };

  const handleImportSearch = async (e: FormEvent) => {
    e.preventDefault();
    const q = importQuery.trim();
    if (!q) return;
    setImportSearching(true);
    try {
      setImportResults(await downtifySearchSongs(q));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Downtify search failed: ${message}`);
    } finally {
      setImportSearching(false);
    }
  };

  const queueDowntifyDownload = async (song: DowntifySong) => {
    const songId = pendingKey(song);
    setDownloadingSongId(songId);
    setPendingImports((prev) => {
      if (prev.some((entry) => entry.key === songId)) return prev;
      return [
        ...prev,
        {
          key: songId,
          title: pendingTitle(song),
          artist: pendingArtist(song),
          song,
          stage: { kind: "downloading" },
        },
      ];
    });
    try {
      await downtifyQueueDownload(song);
      toast.success("Queued in Downtify. Will auto-add to karaoke queue once analyzed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Queue failed: ${message}`);
      setPendingImports((prev) =>
        prev.map((entry) =>
          entry.key === songId ? { ...entry, stage: { kind: "failed", message } } : entry,
        ),
      );
    } finally {
      setDownloadingSongId(null);
    }
  };

  useEffect(() => {
    if (results.length > 0 && query.trim().length === 0) return;
    void loadLatestSongs();
  }, [loadLatestSongs, query, results.length]);

  const filteredResults = useMemo(() => {
    return results.filter((song) => {
      if (libraryFilter === "analysed") return song.is_analyzed;
      if (libraryFilter === "unanalysed") return !song.is_analyzed;
      if (libraryFilter === "videos") return song.is_video;
      return true;
    });
  }, [libraryFilter, results]);

  useEffect(() => {
    if (catalogSongs.length === 0) return;
    setPendingImports((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next: PendingImport[] = prev.map((entry): PendingImport => {
        const normalizedTitle = normalize(entry.title);
        const normalizedArtist = normalize(entry.artist);
        const matched = catalogSongs.find((song) => {
          const t = normalize(song.title);
          const a = normalize(song.artist);
          if (t !== normalizedTitle) return false;
          if (!normalizedArtist) return true;
          return a.includes(normalizedArtist) || normalizedArtist.includes(a);
        });
        if (!matched) {
          if (entry.stage.kind === "downloading") {
            changed = true;
            return { ...entry, stage: { kind: "waiting-library" as const } };
          }
          return entry;
        }

        const analysisStatus = fullAnalysisEntries[matched.file_hash];
        if (analysisStatus && typeof analysisStatus === "object" && "Analyzing" in analysisStatus) {
          const pct = Math.round((analysisStatus as { Analyzing: number }).Analyzing);
          if (entry.stage.kind !== "analyzing" || entry.stage.pct !== pct) {
            changed = true;
            return { ...entry, stage: { kind: "analyzing" as const, pct } };
          }
          return entry;
        }
        if (analysisStatus && typeof analysisStatus === "object" && "Failed" in analysisStatus) {
          const message = (analysisStatus as { Failed: string }).Failed;
          if (entry.stage.kind !== "failed" || entry.stage.message !== message) {
            changed = true;
            return { ...entry, stage: { kind: "failed" as const, message } };
          }
          return entry;
        }
        if (!matched.is_analyzed) {
          if (entry.stage.kind !== "waiting-library") {
            changed = true;
            return { ...entry, stage: { kind: "waiting-library" as const } };
          }
          return entry;
        }
        if (!queuedHashes.has(matched.file_hash) && entry.stage.kind !== "queued") {
          actions.addToQueue(matched as unknown as Record<string, unknown>);
        }
        if (entry.stage.kind !== "queued") {
          changed = true;
          return { ...entry, stage: { kind: "queued" as const } };
        }
        return entry;
      });
      return changed ? next : prev;
    });
  }, [actions, catalogSongs, fullAnalysisEntries, queuedHashes]);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="h-[100dvh] overflow-y-auto overscroll-y-contain bg-background p-4 text-foreground touch-pan-y md:p-8">
      <div className="mx-auto max-w-3xl space-y-4 pb-28 md:pb-0">
        <div id="join-overview" className="rounded-lg border border-border/60 p-4 scroll-mt-20">
          <h1 className="text-2xl font-semibold">Join Karaoke</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Status: {connected ? "Connected" : "Disconnected"} -{" "}
            {me ? `Joined as ${me.display_name}` : "Not joined"}
          </p>
          <div className="mt-3 flex flex-col gap-2 md:flex-row">
            <Input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Join code" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            <Button onClick={joinSession}>Join</Button>
          </div>
          {snapshot && (
            <p className="mt-2 text-sm text-muted-foreground">
              Current Song: {snapshot.current_song ?? "--"} | Queue: {snapshot.queue.length}
            </p>
          )}
        </div>

        <div id="join-search" className="rounded-lg border border-border/60 p-4 scroll-mt-20">
          <h2 className="text-lg font-semibold">Search Nightingale Library</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Browse songs, see readiness at a glance, and add straight to karaoke queue.
          </p>
          <form onSubmit={handleSearch} className="mt-3 flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search song title..."
                disabled={!me}
              />
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={!me || searching || !query.trim()}
              >
                {searching ? <Loader2Icon className="size-4 animate-spin" /> : "Search"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={searching}
                onClick={() => {
                  setQuery("");
                  void loadLatestSongs();
                }}
              >
                Browse Latest
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={!me || searching || (!query.trim() && !artistQuery.trim() && !selectedArtist)}
                onClick={() => {
                  setQuery("");
                  setArtistQuery("");
                  setSelectedArtist(null);
                  setResults([]);
                  void loadLatestSongs();
                }}
              >
                Clear Search
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setShowArtistSection((prev) => !prev)}
            >
              {showArtistSection ? "Hide Artist Search" : "Show Artist Search"}
            </Button>
            {showArtistSection && (
              <Input
                value={artistQuery}
                onChange={(e) => setArtistQuery(e.target.value)}
                placeholder="Search artists..."
                disabled={!me}
                className="sm:max-w-sm"
              />
            )}
            {selectedArtist && (
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => {
                  setSelectedArtist(null);
                  setResults([]);
                }}
              >
                Clear Artist: {selectedArtist}
              </Button>
            )}
          </form>
          {showArtistSection && visibleArtists.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Browse artists</p>
              {artistInitials.length > 0 && (
                <div className="mb-2 flex items-center gap-1 overflow-x-auto pb-1">
                  {artistInitials.map((initial) => {
                    const firstVisibleArtist = firstVisibleArtistByInitial.get(initial);
                    const enabled = Boolean(firstVisibleArtist);
                    return (
                      <Button
                        key={initial}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 min-w-6 px-1 text-[10px] tracking-wide"
                        disabled={!enabled}
                        onClick={() => {
                          if (!firstVisibleArtist) return;
                          document
                            .getElementById(artistAnchorId(initial))
                            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                        }}
                      >
                        {initial}
                      </Button>
                    );
                  })}
                </div>
              )}
              <div className="max-h-36 overflow-y-auto pr-1">
                <div className="flex flex-wrap gap-2">
                  {visibleArtists.map((artist) => {
                    const initial = artistInitial(artist);
                    const shouldAnchor =
                      initial != null && firstVisibleArtistByInitial.get(initial) === artist;
                    return (
                      <Button
                        key={artist}
                        id={shouldAnchor && initial ? artistAnchorId(initial) : undefined}
                        type="button"
                        size="sm"
                        variant={selectedArtist === artist ? "default" : "outline"}
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          setSelectedArtist(artist);
                          setResults([]);
                        }}
                      >
                        {artist}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {showArtistSection && visibleArtists.length === 0 && artistNeedle.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">No artists matched that search.</p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Button
              variant={libraryFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setLibraryFilter("all")}
            >
              All
            </Button>
            <Button
              variant={libraryFilter === "analysed" ? "default" : "outline"}
              size="sm"
              onClick={() => setLibraryFilter("analysed")}
            >
              Analysed
            </Button>
            <Button
              variant={libraryFilter === "unanalysed" ? "default" : "outline"}
              size="sm"
              onClick={() => setLibraryFilter("unanalysed")}
            >
              Unanalysed
            </Button>
            <Button
              variant={libraryFilter === "videos" ? "default" : "outline"}
              size="sm"
              onClick={() => setLibraryFilter("videos")}
            >
              Videos
            </Button>
          </div>
          <div className="mt-3 grid gap-2 max-h-[46vh] overflow-y-auto pr-1">
            {filteredResults.map((song) => {
              const title = song.title || "Unknown title";
              const artists = song.artist || "Unknown artist";
              const inQueue = queuedHashes.has(song.file_hash);
              return (
                <div key={song.file_hash} className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="size-12 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted/20">
                      {song.album_art_path ? (
                        <img
                          src={convertFileSrc(song.album_art_path)}
                          alt={song.title}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {artists} - {song.album}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {song.is_analyzed ? "Analysed" : "Unanalysed"}
                        </span>
                        {song.is_video && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            Video
                          </span>
                        )}
                        {song.language && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {song.language.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 self-start sm:self-auto"
                    disabled={!me || inQueue}
                    onClick={() => actions.addToQueue(song as unknown as Record<string, unknown>)}
                  >
                    {inQueue ? "Queued" : "Add"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <div id="join-import" className="rounded-lg border border-border/60 p-4 scroll-mt-20">
          <h2 className="text-lg font-semibold">Add to Library (Downtify)</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Search or paste a track/URL and queue a download into your Nightingale library.
          </p>
          <form onSubmit={handleImportSearch} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={importQuery}
              onChange={(e) => setImportQuery(e.target.value)}
              placeholder="Song name or URL"
              disabled={!me}
            />
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={!me || importSearching || !importQuery.trim()}
            >
              {importSearching ? <Loader2Icon className="size-4 animate-spin" /> : "Search"}
            </Button>
          </form>
          <div className="mt-3 grid gap-2 max-h-48 overflow-y-auto pr-1">
            {importResults.map((song) => {
              const songId =
                typeof song.song_id === "string" && song.song_id.length > 0
                  ? song.song_id
                  : typeof song.url === "string" && song.url.length > 0
                    ? song.url
                    : JSON.stringify(song);
              const title = typeof song.name === "string" && song.name ? song.name : "Unknown title";
              const artists = Array.isArray(song.artists) ? song.artists.join(", ") : "Unknown artist";
              return (
                <div
                  key={songId}
                  className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{title}</p>
                    <p className="truncate text-xs text-muted-foreground">{artists}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={!me || downloadingSongId === songId}
                    onClick={() => void queueDowntifyDownload(song)}
                  >
                    {downloadingSongId === songId ? "Queueing..." : "Download"}
                  </Button>
                </div>
              );
            })}
          </div>
          {downtifyActiveQueue.length > 0 && (
            <div className="mt-3 max-h-28 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
              <p className="text-xs font-medium text-muted-foreground">Download progress</p>
              {downtifyActiveQueue.map((entry, idx) => {
                const song = entry.song ?? {};
                const title =
                  typeof song.name === "string" && song.name.trim().length > 0
                    ? song.name
                    : "Unknown title";
                const progress = typeof entry.progress === "number" ? Math.round(entry.progress) : 0;
                return (
                  <div key={`${title}-${idx}`} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{title}</span>
                      <span className="shrink-0">{progress}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {analysisEntries.length > 0 && (
            <div className="mt-3 max-h-28 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
              <p className="text-xs font-medium text-muted-foreground">Analysis progress</p>
              {analysisEntries.map(([fileHash, status]) => (
                <div key={fileHash} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-muted-foreground">{fileHash}</span>
                  <span className="shrink-0">{formatAnalysisStatus(status)}</span>
                </div>
              ))}
            </div>
          )}
          {pendingImports.length > 0 && (
            <div className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
              <p className="text-xs font-medium text-muted-foreground">Import status</p>
              {pendingImports.map((entry) => (
                <div key={entry.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    {entry.title} - {entry.artist}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {entry.stage.kind === "downloading" && "Downloading"}
                    {entry.stage.kind === "waiting-library" && "Waiting analysis"}
                    {entry.stage.kind === "analyzing" && `Analyzing ${entry.stage.pct}%`}
                    {entry.stage.kind === "queued" && "Added to queue"}
                    {entry.stage.kind === "failed" && "Failed"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="join-controls" className="rounded-lg border border-border/60 p-4 scroll-mt-20">
          <h2 className="text-lg font-semibold">Shared Controls</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Controls are currently {canControl ? "enabled" : "disabled"} for your role.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:flex-wrap">
            <Button
              variant="outline"
              className="w-full md:w-auto"
              disabled={!canControl}
              onClick={() => actions.patchPlayback({ paused: !(snapshot?.paused ?? false) })}
            >
              {snapshot?.paused ? "Resume" : "Pause"}
            </Button>
            <Button
              variant="outline"
              className="w-full md:w-auto"
              disabled={!canControl}
              onClick={() => actions.adminAction("next-song")}
            >
              Skip Song
            </Button>
            <Button
              variant="outline"
              className="w-full md:w-auto"
              disabled={!canControl}
              onClick={() => actions.adminAction("skip-intro")}
            >
              Skip Intro
            </Button>
            <Button
              variant="outline"
              className="w-full md:w-auto"
              disabled={!canControl}
              onClick={() => actions.adminAction("skip-outro")}
            >
              Skip Outro
            </Button>
            <Button
              variant="outline"
              className="w-full md:w-auto"
              disabled={!canControl}
              onClick={() => actions.patchSettings({ micMonitoring: !(snapshot?.mic_monitoring ?? false) })}
            >
              Mic Monitor
            </Button>
            <Button
              variant="outline"
              className="w-full md:w-auto"
              disabled={!canControl}
              onClick={() => actions.patchSettings({ guideVolume: Math.max(0, (snapshot?.guide_volume ?? 0.3) - 0.1) })}
            >
              Guide -
            </Button>
            <Button
              variant="outline"
              className="w-full md:w-auto"
              disabled={!canControl}
              onClick={() => actions.patchSettings({ guideVolume: Math.min(1, (snapshot?.guide_volume ?? 0.3) + 0.1) })}
            >
              Guide +
            </Button>
            <Button
              variant="outline"
              className="w-full md:w-auto"
              disabled={!canControl}
              onClick={() =>
                actions.patchSettings({
                  theme: Math.max(0, (snapshot?.theme ?? 0) - 1),
                })
              }
            >
              Theme -
            </Button>
            <Button
              variant="outline"
              className="w-full md:w-auto"
              disabled={!canControl}
              onClick={() =>
                actions.patchSettings({
                  theme: (snapshot?.theme ?? 0) + 1,
                })
              }
            >
              Theme +
            </Button>
          </div>
        </div>

        <div id="join-queue" className="rounded-lg border border-border/60 p-4 scroll-mt-20">
          <h2 className="text-lg font-semibold">Queue</h2>
          <div className="mt-3 space-y-2">
            {(snapshot?.queue ?? []).map((item) => (
              <div key={item.id} className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.artist} - by {item.requested_by_display_name}
                  </p>
                </div>
                {canControl && (
                  <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => actions.reorderQueue(item.id, 0)}
                    >
                      Top
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => actions.removeFromQueue(item.id)}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-3xl grid-cols-5 gap-2">
          <Button size="sm" variant="outline" className="w-full" onClick={() => scrollToSection("join-overview")}>
            Join
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => scrollToSection("join-search")}>
            Search
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => scrollToSection("join-import")}>
            Import
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => scrollToSection("join-controls")}>
            Controls
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => scrollToSection("join-queue")}>
            Queue
          </Button>
        </div>
      </div>
    </div>
  );
}
