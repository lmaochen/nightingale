/**
 * Web Audio–based playback for instrumental + guide vocals, with a shared
 * rAF tick that notifies subscribers for visuals (background sync, lyrics, HUD).
 * The returned API object is referentially stable across renders when its fields are unchanged.
 *
 * Graph: instrumental buffer → destination; vocals buffer → gain (guide level) → destination.
 * Playback position is derived from AudioContext.currentTime and a (offset, contextTimeAtStart)
 * pair because BufferSourceNode is one-shot: pause/seek recreate sources rather than mutating time.
 */

import type { PlaybackAdapter } from "@/bridge/playback";
import { playbackAdapter } from "@/bridge/playback";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type TimeSubscriber = (time: number) => void;

interface DecodedAudioPair {
  instrumental: AudioBuffer;
  vocals: AudioBuffer;
  duration: number;
  decodeFormat: "wav" | "mp3";
}

const decodedAudioCache = new Map<string, DecodedAudioPair>();
const decodeInFlight = new Map<string, Promise<DecodedAudioPair>>();
const decodeErrorByHash = new Map<string, string>();
const DEFAULT_DECODE_CACHE_LIMIT = 3;
let decodeCacheLimit = DEFAULT_DECODE_CACHE_LIMIT;
let decodeSequentialChain: Promise<void> = Promise.resolve();

function runDecodeTask(
  decodeTask: () => Promise<DecodedAudioPair>,
  sequential: boolean,
): Promise<DecodedAudioPair> {
  if (!sequential) {
    return decodeTask();
  }

  const queued = decodeSequentialChain.catch(() => undefined).then(decodeTask);
  decodeSequentialChain = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

function cacheDecodedAudio(fileHash: string, decoded: DecodedAudioPair): void {
  if (decodedAudioCache.has(fileHash)) {
    decodedAudioCache.delete(fileHash);
  }
  decodedAudioCache.set(fileHash, decoded);
  decodeErrorByHash.delete(fileHash);

  while (decodedAudioCache.size > decodeCacheLimit) {
    const oldest = decodedAudioCache.keys().next().value as string | undefined;
    if (!oldest) break;
    decodedAudioCache.delete(oldest);
  }
}

export function setPlaybackAudioCacheLimit(limit: number): void {
  const normalized = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : DEFAULT_DECODE_CACHE_LIMIT;
  decodeCacheLimit = normalized;
  while (decodedAudioCache.size > decodeCacheLimit) {
    const oldest = decodedAudioCache.keys().next().value as string | undefined;
    if (!oldest) break;
    decodedAudioCache.delete(oldest);
  }
}

export function clearPlaybackAudioCache(options?: { preserveHashes?: string[] }): void {
  const preserve = new Set((options?.preserveHashes ?? []).filter(Boolean));
  for (const hash of decodedAudioCache.keys()) {
    if (!preserve.has(hash)) {
      decodedAudioCache.delete(hash);
    }
  }
  for (const hash of decodeErrorByHash.keys()) {
    if (!preserve.has(hash)) {
      decodeErrorByHash.delete(hash);
    }
  }
}

async function decodeAudioForFileHash(
  fileHash: string,
  adapter: PlaybackAdapter,
  ctx: AudioContext,
): Promise<DecodedAudioPair> {
  const paths = await adapter.getAudioPaths(fileHash);
  const decodeFormat =
    paths.instrumental.toLowerCase().includes(".wav") && paths.vocals.toLowerCase().includes(".wav")
      ? "wav"
      : "mp3";
  const [instData, vocData] = await Promise.all([
    fetch(paths.instrumental).then((r) => {
      if (!r.ok) {
        throw new Error(`Failed to fetch instrumental: ${r.status}`);
      }
      return r.arrayBuffer();
    }),
    fetch(paths.vocals).then((r) => {
      if (!r.ok) {
        throw new Error(`Failed to fetch vocals: ${r.status}`);
      }
      return r.arrayBuffer();
    }),
  ]);

  if (ctx.state === "suspended") {
    // Don't block decode on resume; some browsers may delay until user gesture.
    void ctx.resume().catch(() => {
      // decodeAudioData can still run while suspended in modern browsers.
    });
  }

  const [instrumental, vocals] = await Promise.all([
    ctx.decodeAudioData(instData),
    ctx.decodeAudioData(vocData),
  ]);

  return { instrumental, vocals, duration: instrumental.duration, decodeFormat };
}

function ensureDecodedAudio(
  fileHash: string,
  adapter: PlaybackAdapter,
  ctx: AudioContext,
  sequential = false,
): Promise<DecodedAudioPair> {
  const cached = decodedAudioCache.get(fileHash);
  if (cached) return Promise.resolve(cached);

  const inflight = decodeInFlight.get(fileHash);
  if (inflight) return inflight;

  const task = runDecodeTask(() => decodeAudioForFileHash(fileHash, adapter, ctx), sequential)
    .then((decoded) => {
      cacheDecodedAudio(fileHash, decoded);
      return decoded;
    })
    .finally(() => {
      decodeInFlight.delete(fileHash);
    });

  decodeInFlight.set(fileHash, task);
  return task;
}

/**
 * Host-side optimization: decode the next queued song ahead of time so
 * transition into playback avoids heavy decode stalls on low-power devices.
 */
export function prewarmPlaybackAudio(
  fileHash: string,
  adapter: PlaybackAdapter = playbackAdapter,
  options?: { sequential?: boolean },
): Promise<void> {
  if (!fileHash || decodedAudioCache.has(fileHash)) return Promise.resolve();
  const inflight = decodeInFlight.get(fileHash);
  if (inflight) return inflight.then(() => undefined);

  const task = runDecodeTask(async () => {
    const warmCtx = new AudioContext();
    try {
      const decoded = await decodeAudioForFileHash(fileHash, adapter, warmCtx);
      cacheDecodedAudio(fileHash, decoded);
      return decoded;
    } finally {
      void warmCtx.close().catch(() => {});
    }
  }, options?.sequential === true)
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      decodeErrorByHash.set(fileHash, message);
      throw error;
    })
    .finally(() => {
      decodeInFlight.delete(fileHash);
    });

  decodeInFlight.set(fileHash, task);
  return task.then(() => undefined);
}

export type PlaybackAudioCacheStatus = "warm" | "warming" | "cold";

export function getPlaybackAudioCacheStatus(fileHash: string): PlaybackAudioCacheStatus {
  if (!fileHash) return "cold";
  if (decodedAudioCache.has(fileHash)) return "warm";
  if (decodeInFlight.has(fileHash)) return "warming";
  return "cold";
}

export function getPlaybackAudioCacheError(fileHash: string): string | null {
  if (!fileHash) return null;
  return decodeErrorByHash.get(fileHash) ?? null;
}

export interface AudioPlayer {
  getCurrentTime: () => number;
  subscribe: (fn: TimeSubscriber) => () => void;
  duration: number;
  isReady: boolean;
  isPlaying: boolean;
  isFinished: boolean;
  error: string | null;
  decodeFormat: "wav" | "mp3" | null;
  guideVolume: number;
  play: () => void;
  pause: () => void;
  resume: () => void;
  seek: (time: number) => void;
  setGuideVolume: (v: number) => void;
  cleanup: () => void;
  getVocalsBuffer: () => AudioBuffer | null;
  getAudioContext: () => AudioContext | null;
}

export function useAudioPlayer(
  fileHash: string,
  initialGuideVolume: number,
  enabled: boolean,
  adapter: PlaybackAdapter = playbackAdapter,
  sequentialDecode = false,
  stickyPredecode = false,
): AudioPlayer {
  const ctxRef = useRef<AudioContext | null>(null);
  const instrumentalBufRef = useRef<AudioBuffer | null>(null);
  const vocalsBufRef = useRef<AudioBuffer | null>(null);
  const instrumentalSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const vocalsSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const vocalsGainRef = useRef<GainNode | null>(null);
  const rafRef = useRef<number>(0);
  const currentTimeRef = useRef(0);
  const subscribersRef = useRef<Set<TimeSubscriber>>(new Set());
  /** Logical playback position (seconds) when the current sources were started. */
  const startOffsetRef = useRef(0);
  /** ctx.currentTime at the moment the current sources started (anchors wall-clock math). */
  const startContextTimeRef = useRef(0);
  const playingRef = useRef(false);
  /** Set on cleanup so async decode/start and onended ignore stale work after unmount. */
  const cancelledRef = useRef(false);

  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decodeFormat, setDecodeFormat] = useState<"wav" | "mp3" | null>(null);
  const [guideVolume, setGuideVolumeState] = useState(initialGuideVolume);

  useEffect(() => {
    // Keep only one decoded pair in performance mode unless sticky predecode is enabled.
    const targetLimit = sequentialDecode ? (stickyPredecode ? 2 : 1) : DEFAULT_DECODE_CACHE_LIMIT;
    setPlaybackAudioCacheLimit(targetLimit);
  }, [sequentialDecode, stickyPredecode]);

  const getVocalsBuffer = useCallback(() => vocalsBufRef.current, []);

  const getAudioContext = useCallback(() => ctxRef.current, []);

  const getCurrentTime = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !playingRef.current) {
      return currentTimeRef.current;
    }

    return startOffsetRef.current + (ctx.currentTime - startContextTimeRef.current);
  }, []);

  const subscribe = useCallback((fn: TimeSubscriber) => {
    subscribersRef.current.add(fn);

    return () => {
      subscribersRef.current.delete(fn);
    };
  }, []);

  const notifySubscribers = useCallback((t: number) => {
    for (const fn of subscribersRef.current) {
      fn(t);
    }
  }, []);

  const stopSources = useCallback(() => {
    playingRef.current = false;

    try {
      instrumentalSrcRef.current?.stop();
    } catch {
      /* BufferSourceNode throws if stopped twice */
    }
    try {
      vocalsSrcRef.current?.stop();
    } catch {
      /* BufferSourceNode throws if stopped twice */
    }

    instrumentalSrcRef.current = null;
    vocalsSrcRef.current = null;
  }, []);

  const startSources = useCallback(
    (offset: number) => {
      const ctx = ctxRef.current;
      const instBuf = instrumentalBufRef.current;
      const vocBuf = vocalsBufRef.current;
      const gainNode = vocalsGainRef.current;

      if (!ctx || !instBuf || !vocBuf || !gainNode) {
        return;
      }

      stopSources();

      const clamped = Math.max(0, Math.min(offset, instBuf.duration));

      const instSrc = ctx.createBufferSource();
      instSrc.buffer = instBuf;
      instSrc.connect(ctx.destination);

      const vocSrc = ctx.createBufferSource();
      vocSrc.buffer = vocBuf;
      vocSrc.connect(gainNode);

      instSrc.onended = () => {
        if (!cancelledRef.current && playingRef.current && instrumentalSrcRef.current === instSrc) {
          playingRef.current = false;

          setIsFinished(true);
          setIsPlaying(false);
        }
      };

      startOffsetRef.current = clamped;
      startContextTimeRef.current = ctx.currentTime;

      instSrc.start(0, clamped);
      vocSrc.start(0, clamped);

      instrumentalSrcRef.current = instSrc;
      vocalsSrcRef.current = vocSrc;
      playingRef.current = true;
    },
    [stopSources],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    cancelledRef.current = false;
    playingRef.current = false;

    startOffsetRef.current = 0;
    startContextTimeRef.current = 0;
    currentTimeRef.current = 0;
    setDecodeFormat(null);

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(1, initialGuideVolume));
    gainNode.connect(ctx.destination);
    vocalsGainRef.current = gainNode;

    const isCancelled = () => cancelled || cancelledRef.current;

    ensureDecodedAudio(fileHash, adapter, ctx, sequentialDecode)
      .then(async ({ instrumental, vocals, duration, decodeFormat: loadedDecodeFormat }) => {
        if (isCancelled()) {
          return;
        }

        if (isCancelled()) {
          return;
        }

        instrumentalBufRef.current = instrumental;
        vocalsBufRef.current = vocals;

        setDuration(duration);
        setDecodeFormat(loadedDecodeFormat);

        setIsReady(true);
      })
      .catch((e) => {
        if (!isCancelled()) {
          setError(`Failed to load audio: ${e}`);
        }
      });

    let lastNotify = 0;
    const NOTIFY_INTERVAL = 33;

    const tick = () => {
      if (isCancelled()) {
        return;
      }

      if (playingRef.current && ctxRef.current) {
        const now = performance.now();
        const t =
          startOffsetRef.current + (ctxRef.current.currentTime - startContextTimeRef.current);
        currentTimeRef.current = t;

        if (now - lastNotify >= NOTIFY_INTERVAL) {
          lastNotify = now;
          for (const fn of subscribersRef.current) fn(t);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      stopSources();
      instrumentalBufRef.current = null;
      vocalsBufRef.current = null;
      vocalsGainRef.current = null;
      ctx.close();
      ctxRef.current = null;
    };
  }, [adapter, enabled, fileHash, initialGuideVolume, sequentialDecode, startSources, stopSources]);

  const play = useCallback(() => {
    startSources(startOffsetRef.current);
    setIsPlaying(true);
  }, [startSources]);

  const pause = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx && playingRef.current) {
      startOffsetRef.current += ctx.currentTime - startContextTimeRef.current;
    }

    stopSources();
    setIsPlaying(false);
  }, [stopSources]);

  const resume = useCallback(() => {
    startSources(startOffsetRef.current);
    setIsPlaying(true);
  }, [startSources]);

  const seek = useCallback(
    (time: number) => {
      const wasPlaying = playingRef.current;

      stopSources();

      startOffsetRef.current = time;
      currentTimeRef.current = time;

      if (wasPlaying) {
        startSources(time);
        setIsPlaying(true);
      }

      notifySubscribers(time);
      setIsFinished(false);
    },
    [stopSources, startSources, notifySubscribers],
  );

  const setGuideVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));

    setGuideVolumeState(clamped);

    if (vocalsGainRef.current) {
      vocalsGainRef.current.gain.value = clamped;
    }
  }, []);

  const cleanup = useCallback(() => {
    cancelledRef.current = true;

    cancelAnimationFrame(rafRef.current);

    stopSources();

    ctxRef.current?.close();
    ctxRef.current = null;
  }, [stopSources]);

  return useMemo(
    () => ({
      getCurrentTime,
      subscribe,
      duration,
      isReady,
      isPlaying,
      isFinished,
      error,
      decodeFormat,
      guideVolume,
      play,
      pause,
      resume,
      seek,
      setGuideVolume,
      cleanup,
      getVocalsBuffer,
      getAudioContext,
    }),
    [
      getCurrentTime,
      subscribe,
      duration,
      isReady,
      isPlaying,
      isFinished,
      error,
      decodeFormat,
      guideVolume,
      play,
      pause,
      resume,
      seek,
      setGuideVolume,
      cleanup,
      getVocalsBuffer,
      getAudioContext,
    ],
  );
}
