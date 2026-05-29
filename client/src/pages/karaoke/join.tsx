import { loadSongs } from "@/bridge/songs";
import {
  downtifyLoadQueue,
  downtifyQueueDownload,
  downtifySearchSongs,
  type DowntifyQueueEntry,
  type DowntifySong,
} from "@/bridge/downtify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useJukeboxSession } from "@/hooks/use-jukebox-session";
import type { Song } from "@/types/Song";
import { loadAnalysisQueue } from "@/bridge/songs";
import { ANALYSIS_QUEUE, DOWNTIFY_QUEUE } from "@/queries/keys";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const DEFAULT_JOIN_NAME = "Guest";

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

export function KaraokeJoinPage() {
  const { connected, snapshot, me, actions } = useJukeboxSession();
  const [name, setName] = useState(DEFAULT_JOIN_NAME);
  const [pin, setPin] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Song[]>([]);
  const [importQuery, setImportQuery] = useState("");
  const [importSearching, setImportSearching] = useState(false);
  const [importResults, setImportResults] = useState<DowntifySong[]>([]);
  const [downloadingSongId, setDownloadingSongId] = useState<string | null>(null);
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

  const canControl = useMemo(() => {
    if (!snapshot || !me) return false;
    return snapshot.host === me.client_id || snapshot.allow_guest_controls;
  }, [snapshot, me]);

  const joinSession = () => {
    actions.join(pin, name.trim() || DEFAULT_JOIN_NAME, false);
  };

  const loadLatestSongs = useCallback(async () => {
    setSearching(true);
    try {
      const result = await loadSongs({
        search: null,
        filters: { artist: null, album: null, query: null },
        skip: 0,
        take: 60,
      });
      setResults(result.processed);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const result = await loadSongs({
        search: q,
        filters: { artist: null, album: null, query: null },
        skip: 0,
        take: 60,
      });
      setResults(result.processed);
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
    const songId =
      typeof song.song_id === "string" && song.song_id.length > 0
        ? song.song_id
        : typeof song.url === "string" && song.url.length > 0
          ? song.url
          : JSON.stringify(song);
    setDownloadingSongId(songId);
    try {
      await downtifyQueueDownload(song);
      toast.success("Queued in Downtify. It will appear after download + scan.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Queue failed: ${message}`);
    } finally {
      setDownloadingSongId(null);
    }
  };

  useEffect(() => {
    if (results.length > 0) return;
    void loadLatestSongs();
  }, [loadLatestSongs, results.length]);

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
          <form onSubmit={handleSearch} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tracks..."
              disabled={!me}
            />
            <Button type="submit" className="w-full sm:w-auto" disabled={!me || searching || !query.trim()}>
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
          </form>
          <div className="mt-3 grid gap-2 max-h-[46vh] overflow-y-auto pr-1">
            {results.map((song) => {
              const title = song.title || "Unknown title";
              const artists = song.artist || "Unknown artist";
              return (
                <div key={song.file_hash} className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{title}</p>
                    <p className="truncate text-xs text-muted-foreground">{artists}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={!me}
                    onClick={() => actions.addToQueue(song as unknown as Record<string, unknown>)}
                  >
                    Add
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
