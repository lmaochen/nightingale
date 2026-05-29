import { downtifySearchSongs, type DowntifySong } from "@/bridge/downtify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useJukeboxSession } from "@/hooks/use-jukebox-session";
import { useConfig } from "@/queries/use-config";
import { ArrowLeftIcon, Loader2Icon } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link } from "react-router";

const DEFAULT_HOST_NAME = "Host";

export function KaraokeHostPage() {
  const { data: config } = useConfig();
  const { connected, snapshot, actions, me } = useJukeboxSession();
  const [name, setName] = useState(config?.karaoke_display_name ?? DEFAULT_HOST_NAME);
  const [pin, setPin] = useState(config?.karaoke_pin ?? "1234");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DowntifySong[]>([]);

  const handleJoinHost = () => {
    actions.join(pin, name.trim() || DEFAULT_HOST_NAME, true);
  };

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      setResults(await downtifySearchSongs(q));
    } finally {
      setSearching(false);
    }
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-background p-4 text-foreground md:p-8">
      <div className="mx-auto max-w-6xl space-y-4 pb-24 md:pb-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowLeftIcon className="size-4" /> Back to menu
          </Link>
          <span className="text-sm text-muted-foreground">
            WS: {connected ? "connected" : "disconnected"}
          </span>
        </div>

        <div id="host-overview" className="grid gap-4 md:grid-cols-3 scroll-mt-20">
          <div className="rounded-lg border border-border/60 p-4 md:col-span-2">
            <h1 className="text-2xl font-semibold">Karaoke Host</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Current song: {snapshot?.current_song ?? "--"}
            </p>
            <p className="text-sm text-muted-foreground">Join code: {snapshot?.session_pin ?? pin}</p>
            <p className="text-sm text-muted-foreground">Host role: {me?.role ?? "not joined"}</p>
          </div>

          <div id="host-queue" className="rounded-lg border border-border/60 p-4 scroll-mt-20">
            <p className="text-sm font-medium">Host session</p>
            <div className="mt-2 space-y-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Host name" />
              <Input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" />
              <Button className="w-full" onClick={handleJoinHost}>
                Claim Host
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div id="host-controls" className="rounded-lg border border-border/60 p-4 scroll-mt-20">
            <h2 className="text-lg font-semibold">Queue</h2>
            <div className="mt-3 space-y-2">
              {(snapshot?.queue ?? []).map((item, idx) => (
                <div key={item.id} className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.artist} - by {item.requested_by_display_name}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-1 sm:flex">
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => actions.reorderQueue(item.id, Math.max(0, idx - 1))}
                    >
                      Up
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={() => actions.reorderQueue(item.id, idx + 1)}
                    >
                      Down
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
                </div>
              ))}
              {snapshot?.queue?.length === 0 && (
                <p className="text-sm text-muted-foreground">No queued songs yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border/60 p-4">
            <h2 className="text-lg font-semibold">Host Controls</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 md:flex md:flex-wrap">
              <Button
                variant="outline"
                className="w-full md:w-auto"
                onClick={() => actions.patchPlayback({ paused: !(snapshot?.paused ?? false) })}
              >
                {snapshot?.paused ? "Resume" : "Pause"}
              </Button>
              <Button variant="outline" className="w-full md:w-auto" onClick={() => actions.adminAction("next-song")}>
                Next Song
              </Button>
              <Button variant="outline" className="w-full md:w-auto" onClick={() => actions.adminAction("clear-queue")}>
                Clear Queue
              </Button>
              <Button
                variant="outline"
                className="w-full md:w-auto"
                onClick={() => actions.adminAction("rescan-library")}
              >
                Rescan Library
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:flex-wrap">
              <Button
                variant="outline"
                className="w-full md:w-auto"
                onClick={() => actions.patchSettings({ micMonitoring: !(snapshot?.mic_monitoring ?? false) })}
              >
                Mic Monitor: {snapshot?.mic_monitoring ? "ON" : "OFF"}
              </Button>
              <Button
                variant="outline"
                className="w-full md:w-auto"
                onClick={() => actions.patchSettings({ allowGuestControls: !(snapshot?.allow_guest_controls ?? true) })}
              >
                Guest Controls: {snapshot?.allow_guest_controls ? "ON" : "OFF"}
              </Button>
            </div>
          </div>
        </div>

        <div id="host-search" className="rounded-lg border border-border/60 p-4 scroll-mt-20">
          <h2 className="text-lg font-semibold">Add Song (Downtify Search)</h2>
          <form onSubmit={handleSearch} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs..." />
            <Button type="submit" className="w-full sm:w-auto" disabled={searching || !query.trim()}>
              {searching ? <Loader2Icon className="size-4 animate-spin" /> : "Search"}
            </Button>
          </form>
          <div className="mt-3 grid gap-2 max-h-[48vh] overflow-y-auto pr-1">
            {results.map((song) => {
              const title = typeof song.name === "string" ? song.name : "Unknown title";
              const artists = Array.isArray(song.artists) ? song.artists.join(", ") : "Unknown artist";
              return (
                <div key={`${song.song_id ?? song.url ?? title}-${artists}`} className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{title}</p>
                    <p className="truncate text-xs text-muted-foreground">{artists}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={() => actions.addToQueue(song as Record<string, unknown>)}
                  >
                    Add
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 p-2 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-6xl grid-cols-4 gap-2">
          <Button size="sm" variant="outline" className="w-full" onClick={() => scrollToSection("host-overview")}>
            Home
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => scrollToSection("host-queue")}>
            Queue
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => scrollToSection("host-controls")}>
            Controls
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => scrollToSection("host-search")}>
            Search
          </Button>
        </div>
      </div>
    </div>
  );
}
