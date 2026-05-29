import { useJukeboxSession } from "@/hooks/use-jukebox-session";
import { useConfig } from "@/queries/use-config";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

const DEFAULT_HOST_NAME = "Host";

export function KaraokeHostPage() {
  const { data: config } = useConfig();
  const { connected, snapshot, actions, me } = useJukeboxSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [name, setName] = useState(DEFAULT_HOST_NAME);
  const [pin, setPin] = useState("1234");
  const autoNextHandledRef = useRef(false);
  const lastJoinAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    setName(config?.karaoke_display_name ?? DEFAULT_HOST_NAME);
    setPin(config?.karaoke_pin ?? "1234");
  }, [config?.karaoke_display_name, config?.karaoke_pin]);

  useEffect(() => {
    if (!connected) return;
    if (me?.role === "host") return;
    const joinName = name.trim() || DEFAULT_HOST_NAME;
    const attemptKey = `${pin}::${joinName}`;
    if (lastJoinAttemptRef.current === attemptKey) return;
    lastJoinAttemptRef.current = attemptKey;
    actions.join(pin, joinName, true);
  }, [actions, connected, me?.role, name, pin]);

  useEffect(() => {
    const shouldAutoNext = searchParams.get("autoNext") === "1";
    if (!shouldAutoNext || autoNextHandledRef.current || me?.role !== "host") return;

    autoNextHandledRef.current = true;
    actions.adminAction("next-song");
    const next = new URLSearchParams(searchParams);
    next.delete("autoNext");
    setSearchParams(next, { replace: true });
  }, [actions, me?.role, searchParams, setSearchParams]);

  const hostOccupied = snapshot?.host != null && me?.role !== "host";

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/50 to-black" />
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-white/60">Nightingale Booth</p>
        <h1 className="mt-3 text-4xl font-semibold md:text-6xl">
          {snapshot?.current_song ? "Now Playing" : "Waiting for songs"}
        </h1>
        <p className="mt-3 text-lg text-white/80">
          {snapshot?.current_song
            ? "Playback is running on this host display"
            : "Guests can queue songs from their phones"}
        </p>
        <p className="mt-2 text-sm text-white/60">Join code: {snapshot?.session_pin ?? pin}</p>
        {hostOccupied && (
          <p className="mt-3 text-sm text-amber-300">
            Host is already claimed by another device. Close that session, then reload this page.
          </p>
        )}
        <div className="mt-8 w-full max-w-2xl rounded-md border border-white/20 bg-black/40 p-4 text-left">
          <p className="text-xs uppercase tracking-[0.18em] text-white/60">Up Next</p>
          <div className="mt-2 space-y-1">
            {(snapshot?.queue ?? []).slice(0, 6).map((item, idx) => (
              <p key={item.id} className="truncate text-sm text-white/80">
                {idx + 1}. {item.title} - {item.requested_by_display_name}
              </p>
            ))}
            {(snapshot?.queue ?? []).length === 0 && (
              <p className="text-sm text-white/50">Queue is empty</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
