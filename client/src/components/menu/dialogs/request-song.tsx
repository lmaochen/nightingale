import { downtifyQueueDownload, downtifySearchSongs, type DowntifySong } from "@/bridge/downtify";
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
import { useConfig } from "@/queries/use-config";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

const DEFAULT_DOWNTIFY_URL = "http://karaoke.local:8000";

function formatArtists(song: DowntifySong): string {
  const artists = Array.isArray(song.artists) ? song.artists.filter(Boolean) : [];
  return artists.length > 0 ? artists.join(", ") : "Unknown artist";
}

export const RequestSongDialog = () => {
  const { mode, close } = useDialog();
  const { data: config } = useConfig();
  const open = mode === "request-song";

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DowntifySong[]>([]);
  const [downloadingSongId, setDownloadingSongId] = useState<string | null>(null);

  const downtifyBaseUrl = config?.downtify_base_url?.trim() || DEFAULT_DOWNTIFY_URL;

  const hasResults = results.length > 0;
  const queryTrimmed = query.trim();

  const subtitle = useMemo(() => {
    if (!hasResults) {
      return "Search by song, album, or artist, then queue a download directly from Nightingale.";
    }
    return `Found ${results.length} result${results.length === 1 ? "" : "s"}.`;
  }, [hasResults, results.length]);

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
                  disabled={downloadingSongId === songId}
                >
                  {downloadingSongId === songId ? (
                    <>
                      <Loader2Icon className="animate-spin" />
                      Queueing
                    </>
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
