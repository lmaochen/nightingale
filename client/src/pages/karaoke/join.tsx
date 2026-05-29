import { downtifySearchSongs, type DowntifySong } from "@/bridge/downtify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useJukeboxSession } from "@/hooks/use-jukebox-session";
import { Loader2Icon } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

const DEFAULT_JOIN_NAME = "Guest";

export function KaraokeJoinPage() {
  const { connected, snapshot, me, actions } = useJukeboxSession();
  const [name, setName] = useState(DEFAULT_JOIN_NAME);
  const [pin, setPin] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DowntifySong[]>([]);

  const canControl = useMemo(() => {
    if (!snapshot || !me) return false;
    return snapshot.host === me.client_id || snapshot.allow_guest_controls;
  }, [snapshot, me]);

  const joinSession = () => {
    actions.join(pin, name.trim() || DEFAULT_JOIN_NAME, false);
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

  return (
    <div className="min-h-screen bg-background p-4 text-foreground md:p-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-lg border border-border/60 p-4">
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

        <div className="rounded-lg border border-border/60 p-4">
          <h2 className="text-lg font-semibold">Search and Add Songs</h2>
          <form onSubmit={handleSearch} className="mt-3 flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tracks..."
              disabled={!me}
            />
            <Button type="submit" disabled={!me || searching || !query.trim()}>
              {searching ? <Loader2Icon className="size-4 animate-spin" /> : "Search"}
            </Button>
          </form>
          <div className="mt-3 grid gap-2">
            {results.map((song) => {
              const title = typeof song.name === "string" ? song.name : "Unknown title";
              const artists = Array.isArray(song.artists) ? song.artists.join(", ") : "Unknown artist";
              return (
                <div key={`${song.song_id ?? song.url ?? title}-${artists}`} className="flex items-center justify-between rounded-md border p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{title}</p>
                    <p className="truncate text-xs text-muted-foreground">{artists}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!me}
                    onClick={() => actions.addToQueue(song as Record<string, unknown>)}
                  >
                    Add
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 p-4">
          <h2 className="text-lg font-semibold">Shared Controls</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Controls are currently {canControl ? "enabled" : "disabled"} for your role.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!canControl}
              onClick={() => actions.patchPlayback({ paused: !(snapshot?.paused ?? false) })}
            >
              {snapshot?.paused ? "Resume" : "Pause"}
            </Button>
            <Button
              variant="outline"
              disabled={!canControl}
              onClick={() => actions.patchSettings({ micMonitoring: !(snapshot?.mic_monitoring ?? false) })}
            >
              Mic Monitor
            </Button>
            <Button
              variant="outline"
              disabled={!canControl}
              onClick={() => actions.patchSettings({ guideVolume: Math.max(0, (snapshot?.guide_volume ?? 0.3) - 0.1) })}
            >
              Guide -
            </Button>
            <Button
              variant="outline"
              disabled={!canControl}
              onClick={() => actions.patchSettings({ guideVolume: Math.min(1, (snapshot?.guide_volume ?? 0.3) + 0.1) })}
            >
              Guide +
            </Button>
            <Button
              variant="outline"
              disabled={!canControl}
              onClick={() =>
                actions.patchSettings({
                  theme: ((snapshot?.theme ?? -1) + 1) % 12,
                })
              }
            >
              Next Theme
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 p-4">
          <h2 className="text-lg font-semibold">Queue</h2>
          <div className="mt-3 space-y-2">
            {(snapshot?.queue ?? []).map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-md border p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.artist} - by {item.requested_by_display_name}
                  </p>
                </div>
                {canControl && (
                  <Button size="sm" variant="outline" onClick={() => actions.removeFromQueue(item.id)}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
