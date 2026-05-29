import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const KARAOKE_JOIN_INTENT_KEY = "nightingale.karaoke.join-intent";

interface JoinIntent {
  pin: string;
  displayName: string;
  asHost: boolean;
}

export interface JukeboxParticipant {
  client_id: number;
  display_name: string;
  role: "host" | "guest";
  joined_at_ms: number;
}

export interface JukeboxQueueItem {
  id: number;
  title: string;
  artist: string;
  requested_by_client_id: number;
  requested_by_display_name: string;
  added_at_ms: number;
  song: Record<string, unknown>;
}

export interface JukeboxSessionSnapshot {
  karaoke_enabled?: boolean;
  session_pin: string;
  participants: JukeboxParticipant[];
  queue: JukeboxQueueItem[];
  next_queue_item_id: number;
  allow_guest_controls: boolean;
  current_song: string | null;
  paused: boolean;
  position_ms: number;
  guide_volume: number;
  host_decode_song_hash?: string | null;
  host_decode_status?: string | null;
  host_decode_error?: string | null;
  mic_monitoring: boolean;
  skip_intro_signal: number;
  skip_intro_target?: string | null;
  skip_outro_signal: number;
  skip_outro_target?: string | null;
  pitch_hz: number | null;
  rms: number | null;
  mic_owner: number | null;
  controller: number | null;
  host: number | null;
  theme: number | null;
  score: number;
}

interface EventEnvelope {
  type: string;
  payload: unknown;
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

function loadJoinIntent(): JoinIntent | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KARAOKE_JOIN_INTENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<JoinIntent>;
    if (
      typeof parsed.pin === "string" &&
      typeof parsed.displayName === "string" &&
      typeof parsed.asHost === "boolean"
    ) {
      return {
        pin: parsed.pin,
        displayName: parsed.displayName,
        asHost: parsed.asHost,
      };
    }
  } catch {
    // Ignore malformed persisted join state.
  }
  return null;
}

function persistJoinIntent(intent: JoinIntent | null) {
  if (typeof window === "undefined") return;
  if (!intent) {
    window.localStorage.removeItem(KARAOKE_JOIN_INTENT_KEY);
    return;
  }
  window.localStorage.setItem(KARAOKE_JOIN_INTENT_KEY, JSON.stringify(intent));
}

interface UseJukeboxSessionOptions {
  autoJoinPersistedIntent?: boolean;
}

export function useJukeboxSession(options?: UseJukeboxSessionOptions) {
  const autoJoinPersistedIntent = options?.autoJoinPersistedIntent ?? true;
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<JukeboxSessionSnapshot | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const joinIntentRef = useRef<JoinIntent | null>(loadJoinIntent());
  const joinedToastClientRef = useRef<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    const openSocket = () => {
      if (!isMounted) return;
      const ws = new WebSocket(wsUrl());
      socketRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        const intent = joinIntentRef.current;
        if (intent && autoJoinPersistedIntent) {
          ws.send(
            JSON.stringify({
              type: "session.join",
              pin: intent.pin,
              display_name: intent.displayName,
              as_host: intent.asHost,
            }),
          );
        }
      };
      ws.onclose = () => {
        setConnected(false);
        socketRef.current = null;
        if (!isMounted) return;
        reconnectTimerRef.current = window.setTimeout(openSocket, 1500);
      };
      ws.onerror = () => {
        setConnected(false);
      };
      ws.onmessage = (event) => {
        let envelope: EventEnvelope | null = null;
        try {
          envelope = JSON.parse(event.data) as EventEnvelope;
        } catch {
          return;
        }
        if (!envelope) return;

        if (envelope.type === "jukebox.session" || envelope.type === "jukebox") {
          setSnapshot(envelope.payload as JukeboxSessionSnapshot);
        } else if (envelope.type === "jukebox.client") {
          const maybeId = (envelope.payload as { clientId?: unknown }).clientId;
          if (typeof maybeId === "number") {
            setClientId(maybeId);
          }
        } else if (envelope.type === "jukebox.deny") {
          const reason = (envelope.payload as { reason?: string }).reason ?? "Denied";
          toast.error(`Karaoke action denied: ${reason}`);
        }
      };
    };

    openSocket();

    return () => {
      isMounted = false;
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
    };
  }, [autoJoinPersistedIntent]);

  const sendFrame = useCallback((frame: Record<string, unknown>) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(frame));
  }, []);

  const actions = useMemo(
    () => ({
      join: (pin: string, displayName: string, asHost = false) =>
        (() => {
          joinIntentRef.current = { pin, displayName, asHost };
          persistJoinIntent(joinIntentRef.current);
          sendFrame({ type: "session.join", pin, display_name: displayName, as_host: asHost });
        })(),
      leave: () => {
        joinIntentRef.current = null;
        persistJoinIntent(null);
        sendFrame({ type: "session.leave" });
      },
      addToQueue: (song: Record<string, unknown>) => sendFrame({ type: "queue.add", song }),
      removeFromQueue: (id: number) => sendFrame({ type: "queue.remove", id }),
      reorderQueue: (id: number, toIndex: number) =>
        sendFrame({ type: "queue.reorder", id, to_index: toIndex }),
      patchPlayback: (patch: { currentSong?: string | null; paused?: boolean; positionMs?: number }) =>
        sendFrame({
          type: "playback.patch",
          ...(patch.currentSong !== undefined ? { current_song: patch.currentSong } : {}),
          ...(patch.paused !== undefined ? { paused: patch.paused } : {}),
          ...(patch.positionMs !== undefined ? { position_ms: patch.positionMs } : {}),
        }),
      patchSettings: (patch: {
        theme?: number | null;
        guideVolume?: number;
        micMonitoring?: boolean;
        allowGuestControls?: boolean;
      }) =>
        sendFrame({
          type: "settings.patch",
          ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
          ...(patch.guideVolume !== undefined ? { guide_volume: patch.guideVolume } : {}),
          ...(patch.micMonitoring !== undefined ? { mic_monitoring: patch.micMonitoring } : {}),
          ...(patch.allowGuestControls !== undefined
            ? { allow_guest_controls: patch.allowGuestControls }
            : {}),
        }),
      adminAction: (
        action:
          | "clear-queue"
          | "next-song"
          | "skip-intro"
          | "skip-outro"
          | "rescan-library",
      ) =>
        sendFrame({ type: "admin.action", action }),
      reportHostDecodeStatus: (
        payload: {
          fileHash?: string | null;
          status: "cold" | "warming" | "warm" | "failed";
          error?: string | null;
        },
      ) =>
        sendFrame({
          type: "host.decode_status",
          status: payload.status,
          ...(payload.fileHash !== undefined ? { file_hash: payload.fileHash } : {}),
          ...(payload.error !== undefined ? { error: payload.error } : {}),
        }),
    }),
    [sendFrame],
  );

  const me = useMemo(() => {
    if (clientId == null || !snapshot) return null;
    return snapshot.participants.find((p) => p.client_id === clientId) ?? null;
  }, [clientId, snapshot]);

  useEffect(() => {
    if (!me) return;
    if (joinedToastClientRef.current === me.client_id) return;
    joinedToastClientRef.current = me.client_id;
    toast.success(`Joined karaoke session as ${me.display_name}`);
  }, [me]);

  return {
    connected,
    snapshot,
    clientId,
    me,
    actions,
  };
}
