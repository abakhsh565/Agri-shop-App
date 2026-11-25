import { supabase } from "@/lib/supabase";
import { prepareImage } from "@/lib/imageCompression";

/**
 * Voice notes and photos in a farmer conversation.
 *
 * WHY A FUNCTION AND NOT DIRECT STORAGE. The bucket is private on purpose. A farmer has no JWT —
 * his credential is the token the shop code minted — so storage RLS cannot scope him, and a policy
 * for signed-in users would open every shop's audio to every other shop. The `farmer-media`
 * function is the only door: it authorises the caller (dealer JWT or farmer token), derives the
 * folder itself, and hands back a 60-second signed URL.
 *
 * WHAT THIS MODULE OWNS. The wire contract only: how to upload bytes, how to ask for a playable
 * link, and how to record. It never decides who may read what — the server refuses, and every
 * function here surfaces that refusal as an Error the screen can show.
 */

export type ChatMediaKind = "voice" | "image";

export interface ChatMediaMeta {
  message_id: string;
  attachment_id: string;
  kind: ChatMediaKind;
  mime_type: string;
  size_bytes: number;
  duration_ms: number | null;
  sender: "owner" | "farmer";
  created_at: string;
}

export interface ChatMediaLink extends Omit<ChatMediaMeta, "attachment_id"> {
  url: string;
  expires_in: number;
}

const BUCKET_LIMIT = 10 * 1024 * 1024;

/**
 * The photo ceiling for a chat attachment.
 *
 * 400 KB is the requirement, and it is deliberately below the app-wide 500 KB used by the finance
 * screens: a chat picture is seen on a phone in a field, not printed, so resolution can be traded
 * for a send that finishes. The encoder targets 92% of it and the check below refuses anything
 * that still came out over, rather than uploading a file that only looks close.
 */
export const CHAT_IMAGE_MAX_BYTES = 400 * 1024;

/**
 * The voice-note bitrate: 24 kbps mono Opus.
 *
 * Speech is fully intelligible there and it is ~5× smaller than the browser default (~128 kbps):
 * a 10-second note lands near 30 KB. The recording itself is the only place this can be decided;
 * once uploaded, compression is lossy on top of lossy.
 */
export const VOICE_BITS_PER_SECOND = 24_000;

/**
 * Reduce one picked photo to the chat ceiling before it is uploaded.
 *
 * The receiver is another app (the farmer app) reading the same bucket through a signed link, so
 * what matters is that the bytes are a normal JPEG/WebP it can decode — never an exotic container
 * or a ten-megabyte camera original.
 */
export async function prepareChatImage(file: File): Promise<{
  file: File;
  bytes: number;
  originalBytes: number;
  changed: boolean;
}> {
  const prepared = await prepareImage(file, { maxBytes: CHAT_IMAGE_MAX_BYTES });
  if (prepared.file.size > CHAT_IMAGE_MAX_BYTES) {
    throw new Error("VALIDATION: that photo could not be reduced below 400 KB — try another one");
  }
  return {
    file: prepared.file,
    bytes: prepared.file.size,
    originalBytes: prepared.originalBytes,
    changed: prepared.changed,
  };
}

/** The project's functions origin. `VITE_SUPABASE_URL` is the same value the rest of the app uses. */
function functionsBase(): string {
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!url) throw new Error("MEDIA_UNAVAILABLE");
  return `${url}/functions/v1/farmer-media`;
}

async function dealerToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("NOT_AUTHORIZED");
  return token;
}

/** Statuses that mean "the server could not answer", never "your credential is wrong". */
const RETRYABLE = new Set([502, 503, 504]);

/**
 * One retry for a transient answer. The function now answers `503 AUTH_UNAVAILABLE` when the auth
 * service itself did not respond, and a dropped connection is the same class of event; neither says
 * anything about the dealer's session, so the screen should not show a failure for it.
 */
async function fetchWithRetry(send: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await send();
      if (attempt === 0 && RETRYABLE.has(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }
      return response;
    } catch (error) {
      if (attempt > 0) throw error instanceof Error ? error : new Error("MEDIA_UNAVAILABLE");
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.message ?? body.error ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/**
 * Upload one file and return the storage path the send RPC records.
 *
 * The path is decided by the function (`<shop>/<farmer>/<uuid>.<ext>`), so nothing here can point
 * an upload at another conversation.
 */
/**
 * The container name of a recorded mime type.
 *
 * `MediaRecorder.mimeType` reports the codec as a parameter — `audio/webm;codecs=opus` — while
 * storage and the media function speak bare types. Forwarding the parameter is what made a
 * perfectly good recording fail with "unsupported mime type": the clip was fine, the label was not.
 */
export function baseMimeType(mimeType: string): string {
  return (mimeType || "").split(";")[0].trim().toLowerCase();
}

export async function uploadChatMedia(input: {
  farmerId: string;
  kind: ChatMediaKind;
  bytes: Blob;
  mimeType: string;
  durationMs?: number | null;
}): Promise<{ storage_path: string; size_bytes: number }> {
  const mimeType = baseMimeType(input.mimeType);
  if (input.bytes.size <= 0) throw new Error("VALIDATION: empty file");
  if (input.bytes.size > BUCKET_LIMIT) throw new Error("VALIDATION: a file is at most 10 MB");
  if (input.kind === "voice" && !Number.isFinite(input.durationMs ?? NaN)) {
    throw new Error("VALIDATION: a voice note needs a duration");
  }

  const params = new URLSearchParams({
    kind: input.kind,
    mime: mimeType,
    farmer_id: input.farmerId,
  });
  if (input.kind === "voice") params.set("duration_ms", String(Math.round(input.durationMs ?? 0)));

  const token = await dealerToken();
  const response = await fetchWithRetry(() =>
    fetch(`${functionsBase()}?${params.toString()}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
      body: input.bytes,
    }),
  );
  if (!response.ok) throw new Error(await readError(response));

  const body = (await response.json()) as { storage_path: string; size_bytes: number };
  return { storage_path: body.storage_path, size_bytes: body.size_bytes };
}

/**
 * A playable link for one message's file, valid for 60 seconds.
 *
 * Callers cache by message id for less than `expires_in`; the server's refusal (not this cache) is
 * what keeps another conversation's audio out of reach.
 */
export async function chatMediaLink(messageId: string): Promise<ChatMediaLink> {
  const token = await dealerToken();
  const response = await fetchWithRetry(() =>
    fetch(`${functionsBase()}?message_id=${encodeURIComponent(messageId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  if (!response.ok) throw new Error(await readError(response));
  const link = (await response.json()) as ChatMediaLink;
  // The function signs against the storage base URL IT was given, which can be a host only the
  // server can reach (the local container name, or the edge runtime's own port). The signature
  // covers the object path, not the host, and the caller already reaches storage on the project
  // origin it called the function on — so the link is re-based there, or a clip that uploaded
  // fine plays as a decode error.
  const origin = new URL(functionsBase()).origin;
  const absolute = new URL(link.url, origin);
  return { ...link, url: `${origin}${absolute.pathname}${absolute.search}` };
}

/**
 * The recorder's preferred container.
 *
 * Android's WebView advertises WebM/Opus and then, on several devices, produces a clip the
 * bucket accepts and no player can read — the preview shows 0:00 and the send fails after it
 * has been recorded. Those devices record MP4/AAC correctly, so Android asks for that first;
 * desktop Chromium keeps WebM, which it writes reliably.
 */
const IS_ANDROID = /Android/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent);
const AUDIO_PREFERENCE = IS_ANDROID
  ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
  : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export interface Recording {
  stop: () => Promise<{ blob: Blob; mimeType: string; durationMs: number }>;
  cancel: () => void;
  startedAt: number;
  /** Hold the recording where it is. A voice note longer than a sentence needs a breath. */
  pause: () => void;
  resume: () => void;
  paused: () => boolean;
  /**
   * How loud the microphone is right now, 0..1.
   *
   * The recording bar is meant to move with the voice, not with a timer, so the level is measured
   * from the same stream that is being encoded: one AnalyserNode, read on demand, no second
   * permission and no extra stream.
   */
  level: () => number;
}

/**
 * Start recording. Resolves only after the microphone is actually open, so a denied permission is
 * an error the caller can show rather than a button that silently does nothing.
 */
export async function startVoiceRecording(): Promise<Recording> {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("UNSUPPORTED: this device cannot record audio");
  }
  // Voice, not music: one channel, the browser's own noise handling, and a bitrate that keeps a
  // half-minute note around 90 KB instead of 1 MB. A recorded clip is the one thing on this screen
  // the farmer has to download over a rural connection, so it is compressed at the source — the
  // server cannot shrink it afterwards.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const mimeType = AUDIO_PREFERENCE.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: VOICE_BITS_PER_SECOND,
  });
  const chunks: BlobPart[] = [];
  const startedAt = Date.now();
  // Paused time is not part of the note: a clip says how long it plays, not how long the phone sat
  // in a pocket with the button held.
  let pausedAt = 0;
  let pausedMs = 0;

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(250);

  const closeStream = () => {
    stream.getTracks().forEach((track) => track.stop());
    if (analyserContext) void analyserContext.close().catch(() => undefined);
  };

  // A private context per recording: nothing is left running between notes.
  let analyserContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  try {
    analyserContext = new AudioContext();
    analyser = analyserContext.createAnalyser();
    analyser.fftSize = 512;
    analyserContext.createMediaStreamSource(stream).connect(analyser);
  } catch {
    analyserContext = null;
    analyser = null;
  }
  const samples = analyser ? new Uint8Array(analyser.fftSize) : null;
  const readLevel = () => {
    if (!analyser || !samples) return 0;
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const v = (samples[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / samples.length);
    // Speech sits low in a linear window; the curve is what makes quiet words visible.
    return Math.min(1, Math.pow(rms * 3.4, 0.7));
  };

  return {
    startedAt,
    level: readLevel,
    paused: () => recorder.state === "paused",
    pause: () => {
      if (recorder.state !== "recording") return;
      pausedAt = Date.now();
      recorder.pause();
    },
    resume: () => {
      if (recorder.state !== "paused") return;
      pausedMs += Date.now() - pausedAt;
      pausedAt = 0;
      recorder.resume();
    },
    cancel: () => {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } finally {
        closeStream();
      }
    },
    stop: () =>
      new Promise((resolve, reject) => {
        const finish = () => {
          closeStream();
          const type = baseMimeType(recorder.mimeType || mimeType || "audio/webm") || "audio/webm";
          const blob = new Blob(chunks, { type });
          if (blob.size === 0) return reject(new Error("VALIDATION: nothing was recorded"));
          resolve({
            blob,
            mimeType: type,
            durationMs: Math.max(1, Date.now() - startedAt - pausedMs - (pausedAt ? Date.now() - pausedAt : 0)),
          });
        };
        recorder.onstop = finish;
        recorder.onerror = () => reject(new Error("RECORDING_FAILED"));
        try {
          recorder.stop();
        } catch (error) {
          closeStream();
          reject(error instanceof Error ? error : new Error("RECORDING_FAILED"));
        }
      }),
  };
}

/** `m:ss`, the shape both the bubble and the recorder show. */
export function formatDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
