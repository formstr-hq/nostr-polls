import { useCallback, useRef, useState } from "react";

/**
 * Mic capture for DM voice notes. Records via MediaRecorder (m4a/AAC on
 * Android/iOS, webm/opus fallback on desktop), hard-caps at 60 s, then decodes
 * the take to sample an approximate waveform (NIP-A0 field vocabulary: <100
 * space-separated ints 0-100 — amplitude over time).
 *
 * In DMs the take is sent as an encrypted file (kind 15) — the NIP-A0 kinds
 * (1222/1244) are public posts, not inbox events.
 */
export interface VoiceRecording {
  blob: Blob;
  duration: number; // seconds
  waveform: number[]; // 0-100 ints
  mimeType: string;
}

const MAX_SECONDS = 60;
const WAVE_BUCKETS = 90;

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      // ignore
    }
  }
  return "";
}

/** RMS per bucket → 0..100 with a sqrt curve so quiet parts stay visible. */
function normalizeBuckets(samples: Float32Array, buckets: number): number[] {
  const rms = new Array<number>(buckets).fill(0);
  const per = Math.max(1, Math.floor(samples.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let sum = 0;
    const start = b * per;
    const end = Math.min(start + per, samples.length);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    rms[b] = Math.sqrt(sum / Math.max(1, end - start));
  }
  let peak = 0;
  for (const v of rms) if (v > peak) peak = v;
  if (peak <= 0) return rms.map(() => 0);
  return rms.map((v) => Math.round(Math.min(100, Math.sqrt(v / peak) * 100)));
}

async function sampleWaveform(
  blob: Blob
): Promise<{ waveform: number[]; duration: number }> {
  const AC: typeof AudioContext =
    window.AudioContext ||
    ((window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext as never);
  if (!AC) return { waveform: [], duration: 0 };
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const waveform = normalizeBuckets(buf.getChannelData(0), WAVE_BUCKETS);
    const duration = isFinite(buf.duration) ? buf.duration : 0;
    return { waveform, duration };
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

export type VoiceRecorderError = string | null;

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<VoiceRecorderError>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (capRef.current) {
      clearTimeout(capRef.current);
      capRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recRef.current = null;
    setRecording(false);
  }, []);

  /** Begin capture. Resolves false (with `error` set) on failure/denial. */
  const start = useCallback(async (): Promise<boolean> => {
    if (recRef.current) return true;
    setError(null);
    const mimeType = pickMimeType();
    if (!mimeType) {
      setError("Voice recording is not supported on this device");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream, { mimeType });
      recRef.current = rec;
      chunksRef.current = [];
      cancelledRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start(250);
      setRecording(true);
      const t0 = Date.now();
      setElapsed(0);
      tickRef.current = setInterval(
        () => setElapsed(Math.floor((Date.now() - t0) / 1000)),
        200
      );
      // Hard cap: stop (and send) at 60 s automatically.
      capRef.current = setTimeout(() => {
        if (recRef.current && recRef.current.state !== "inactive") {
          recRef.current.requestData?.();
          recRef.current.stop();
        }
      }, MAX_SECONDS * 1000 + 250);
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.name === "NotAllowedError"
            ? "Microphone permission denied"
            : e.message
          : "Could not start recording"
      );
      cleanup();
      return false;
    }
  }, [cleanup]);

  /**
   * Stop capture and return the take (null when cancelled or nothing recorded).
   * The blob is already local — the caller sends it as an encrypted file.
   */
  const stop = useCallback(async (): Promise<VoiceRecording | null> => {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") {
      cleanup();
      return null;
    }
    const wasCancelled = cancelledRef.current;
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      // Belt and braces: onstop always fires, but don't hang forever.
      setTimeout(resolve, 2000);
    });
    try {
      rec.stop();
    } catch {
      // already stopped — the promise's 2 s backstop resolves this either way
    }
    await stopped;
    const chunks = chunksRef.current;
    const mimeType = rec.mimeType || pickMimeType() || "audio/webm";
    cleanup();
    if (wasCancelled || chunks.length === 0) return null;
    const blob = new Blob(chunks, { type: mimeType });
    try {
      const { waveform, duration } = await sampleWaveform(blob);
      return {
        blob,
        duration: duration > 0 ? Math.min(duration, MAX_SECONDS + 1) : elapsed,
        waveform,
        mimeType,
      };
    } catch {
      // Decode failed — still sendable, just without waveform/duration.
      return { blob, duration: elapsed, waveform: [], mimeType };
    }
  }, [cleanup, elapsed]);

  /** Discard the take. */
  const cancel = useCallback(async () => {
    cancelledRef.current = true;
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        setTimeout(resolve, 2000);
      }).catch(() => undefined);
      try {
        rec.stop();
      } catch {
        // already stopped
      }
    }
    cleanup();
  }, [cleanup]);

  return { recording, elapsed, error, start, stop, cancel };
}