import {
  downtifyLoadQueue,
  downtifyQueueDownload,
  downtifySearchSongs,
  type DowntifySong,
} from "@/bridge/downtify";
import { loadAnalysisQueue } from "@/bridge/songs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDialog } from "@/hooks/use-dialog";
import { ANALYSIS_QUEUE, DOWNTIFY_QUEUE } from "@/queries/keys";
import { useConfig } from "@/queries/use-config";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

const DEFAULT_DOWNTIFY_URL = "http://karaoke.local:8000";

function formatArtists(song: DowntifySong): string {
  const artists = Array.isArray(song.artists) ? song.artists.filter(Boolean) : [];
  return artists.length > 0 ? artists.join(", ") : "Unknown artist";
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

export const RequestSongDialog = () => {
  const { mode, close } = useDialog();
  const { data: config } = useConfig();
  const open = mode === "request-song";

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DowntifySong[]>([]);
  const [downloadingSongId, setDownloadingSongId] = useState<string | null>(null);
  const queueQuery = useQuery({
    queryKey: DOWNTIFY_QUEUE,
    queryFn: downtifyLoadQueue,
    enabled: open,
  });
  const queue = queueQuery.data ?? [];
  const analysisQuery = useQuery({
    queryKey: ANALYSIS_QUEUE,
    queryFn: loadAnalysisQueue,
    enabled: open,
    refetchInterval: 2000,
  });
  const analysisEntries = useMemo(
    () => Object.entries(analysisQuery.data?.entries ?? {}).slice(0, 6),
    [analysisQuery.data],
  );

  const downtifyBaseUrl = config?.downtify_base_url?.trim() || DEFAULT_DOWNTIFY_URL;

  const hasResults = results.length > 0;
  const queryTrimmed = query.trim();

  const subtitle = useMemo(() => {
    if (!hasResults) {
      return "Search by song, album, or artist, then queue a download directly from Nightingale.";
    }
    return `Found ${results.length} result${results.length === 1 ? "" : "s"}.`;
  }, [hasResults, results.length]);

  const queueIdentitySet = useMemo(() => {
    const identities = new Set<string>();
    for (const entry of queue) {
      const song = entry.song;
      if (!song) continue;
      if (typeof song.song_id === "string" && song.song_id.length > 0) {
        identities.add(`song_id:${song.song_id}`);
      } else if (typeof song.url === "string" && song.url.length > 0) {
        identities.add(`url:${song.url}`);
      }
    }
    return identities;
  }, [queue]);

  const activeQueue = useMemo(
    () => queue.filter((entry) => entry.status === "queued" || entry.status === "downloading"),
    [queue],
  );

  const handleSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!queryTrimmed) return;

    setSearching(true);
    try {
      const songs = await downtifySearchSongs(queryTrimmed);
      setResults(songs);
      if (songs.length === 0) {
        toast.info("No songs found");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Search failed: ${message}`);
    } finally {
      setSearching(false);
    }
  };

  const handleQueue = async (song: DowntifySong) => {
    const songId =
      typeof song.song_id === "string" && song.song_id.length > 0
        ? song.song_id
        : typeof song.url === "string" && song.url.length > 0
          ? song.url
          : JSON.stringify(song);

    setDownloadingSongId(songId);
    try {
      await downtifyQueueDownload(song);
      toast.success("Queued in Downtify. Nightingale will pick it up after scan.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Queue failed: ${message}`);
    } finally {
      setDownloadingSongId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Request Song</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Daft Punk One More Time"
            autoFocus
          />
          <Button type="submit" disabled={searching || !queryTrimmed}>
            {searching ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
            Search
          </Button>
        </form>

        <p className="text-xs text-muted-foreground">Using Downtify at {downtifyBaseUrl}</p>

        {activeQueue.length > 0 && (
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
            <p className="text-xs font-medium text-muted-foreground">Downtify queue progress</p>
            {activeQueue.map((entry, idx) => {
              const song = entry.song ?? {};
              const title = typeof song.name === "string" && song.name ? song.name : "Unknown title";
              const progress = typeof entry.progress === "number" ? Math.round(entry.progress) : 0;
              const status = typeof entry.status === "string" ? entry.status : "queued";
              const message =
                typeof entry.message === "string" && entry.message.trim().length > 0
                  ? entry.message
                  : status;
              return (
                <div key={`${title}-${idx}`} className="text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate">{title}</span>
                    <span className="shrink-0 text-muted-foreground">{progress}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{message}</p>
                </div>
              );
            })}
          </div>
        )}

        {analysisEntries.length > 0 && (
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
            <p className="text-xs font-medium text-muted-foreground">Analysis queue progress</p>
            {analysisEntries.map(([fileHash, status]) => (
              <div key={fileHash} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">{fileHash}</span>
                <span className="shrink-0">{formatAnalysisStatus(status)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {results.map((song) => {
            const songId =
              typeof song.song_id === "string" && song.song_id.length > 0
                ? song.song_id
                : typeof song.url === "string" && song.url.length > 0
                  ? song.url
                  : JSON.stringify(song);
            const title = typeof song.name === "string" && song.name ? song.name : "Unknown title";
            const album =
              typeof song.album_name === "string" && song.album_name ? song.album_name : null;
            const inQueue =
              (typeof song.song_id === "string" && queueIdentitySet.has(`song_id:${song.song_id}`)) ||
              (typeof song.url === "string" && queueIdentitySet.has(`url:${song.url}`));

            return (
              <div
                key={songId}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatArtists(song)}
                    {album ? ` - ${album}` : ""}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleQueue(song)}
                  disabled={downloadingSongId === songId || inQueue}
                >
                  {downloadingSongId === songId ? (
                    <>
                      <Loader2Icon className="animate-spin" />
                      Queueing
                    </>
                  ) : inQueue ? (
                    "Queued"
                  ) : (
                    "Queue"
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
