import { supabase } from "@/lib/supabase";

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
export async function uploadChatMedia(input: {
  farmerId: string;
  kind: ChatMediaKind;
  bytes: Blob;
  mimeType: string;
  durationMs?: number | null;
}): Promise<{ storage_path: string; size_bytes: number }> {
  if (input.bytes.size <= 0) throw new Error("VALIDATION: empty file");
  if (input.bytes.size > BUCKET_LIMIT) throw new Error("VALIDATION: a file is at most 10 MB");
  if (input.kind === "voice" && !Number.isFinite(input.durationMs ?? NaN)) {
    throw new Error("VALIDATION: a voice note needs a duration");
  }

  const params = new URLSearchParams({
    kind: input.kind,
    mime: input.mimeType,
    farmer_id: input.farmerId,
  });
  if (input.kind === "voice") params.set("duration_ms", String(Math.round(input.durationMs ?? 0)));

  const response = await fetch(`${functionsBase()}?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await dealerToken()}`,
      "Content-Type": input.mimeType,
    },
    body: input.bytes,
  });
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
  const response = await fetch(`${functionsBase()}?message_id=${encodeURIComponent(messageId)}`, {
    headers: { Authorization: `Bearer ${await dealerToken()}` },
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as ChatMediaLink;
}

/** The recorder's preferred container, in the order Android WebView and desktop Chromium support it. */
const AUDIO_PREFERENCE = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export interface Recording {
  stop: () => Promise<{ blob: Blob; mimeType: string; durationMs: number }>;
  cancel: () => void;
  startedAt: number;
}

/**
 * Start recording. Resolves only after the microphone is actually open, so a denied permission is
 * an error the caller can show rather than a button that silently does nothing.
 */
export async function startVoiceRecording(): Promise<Recording> {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("UNSUPPORTED: this device cannot record audio");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = AUDIO_PREFERENCE.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  const startedAt = Date.now();

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(250);

  const closeStream = () => stream.getTracks().forEach((track) => track.stop());

  return {
    startedAt,
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
          const type = recorder.mimeType || mimeType || "audio/webm";
          const blob = new Blob(chunks, { type });
          if (blob.size === 0) return reject(new Error("VALIDATION: nothing was recorded"));
          resolve({ blob, mimeType: type, durationMs: Math.max(1, Date.now() - startedAt) });
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
