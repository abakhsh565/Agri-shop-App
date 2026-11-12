import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/storage";
import { prepareVoice } from "@/lib/audioCompression";
import { HARD_MAX_IMAGE_BYTES } from "@/lib/imageCompression";

/**
 * The papers and voice notes attached to recorded money.
 *
 * WHY THIS IS NOT `ImageUpload`. That component writes to a PUBLIC bucket and stores a public URL
 * on the record. A receipt is not a product photo: it can carry a supplier's name, a phone number
 * or a CNIC. So the object lives in the private `finance-receipts` bucket (0261), the row stores
 * only its PATH, and every draw asks the storage API for a short-lived signed URL. The screen never
 * holds a permanent link to somebody's paper.
 *
 * WHY THE UPLOAD IS TWO STEPS. The object goes to storage first, then
 * `attach_finance_media` records it against the entry. That RPC validates the entry, the type, the
 * size, the duration and the object's own folder. If it refuses, the object stays unreferenced:
 * the client has no delete grant on storage (0230, and 0263 removes the one 0261 added), so an
 * orphan here is a private file no row names — the same contract every other upload follows.
 *
 * RETRY IS A FIRST-CLASS STATE. A photo that failed to upload does not lose the money row: the row
 * is already saved, and the form keeps the failed drafts with their local previews so the same
 * save button can try again. Nothing here silently drops a file.
 */

export const FINANCE_MEDIA_BUCKET = "finance-receipts";

/** One entry can carry three receipts and two voice notes (enforced again in the database). */
export const MAX_PHOTOS = 3;
export const MAX_VOICES = 2;

/** Ten megabytes, the bucket's own limit. */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

/** The form's own cap: a minute is a note, not a meeting. The database allows ten. */
export const MAX_VOICE_MS = 60_000;

export type FinanceMediaKind = "photo" | "voice";

/** An attachment as the database returns it. */
export interface FinanceMediaRow {
  id: string;
  kind: FinanceMediaKind;
  mime: string;
  bytes: number;
  durationMs: number | null;
  path: string;
  createdAt: string;
}

/** A file chosen or recorded on this screen, before it has been uploaded. */
export interface FinanceMediaDraft {
  /** Local identity only: stable across re-renders, never sent to the server. */
  key: string;
  kind: FinanceMediaKind;
  file: File;
  /** Object URL for the preview; revoked when the draft leaves the form. */
  url: string;
  durationMs: number | null;
  mime: string;
  /** Set once the object and its row are both written. */
  uploaded: boolean;
}

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** The extension the bucket expects for a mime type. */
function extensionFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "audio/webm") return "webm";
  if (mime === "audio/ogg") return "ogg";
  if (mime === "audio/mp4" || mime === "audio/x-m4a") return "m4a";
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "audio/aac") return "aac";
  return "jpg";
}

/** The mime a blob should be stored as, falling back to the browser's own answer. */
export function mediaMime(file: File, kind: FinanceMediaKind): string {
  if (kind === "photo") {
    return PHOTO_TYPES.includes(file.type) ? file.type : "image/jpeg";
  }
  const type = (file.type || "").split(";")[0].trim().toLowerCase();
  if (type.startsWith("audio/") && type !== "audio/x-m4a") return type;
  if (type === "audio/x-m4a") return "audio/mp4";
  return "audio/webm";
}

/**
 * Upload one draft and record it against the entry.
 *
 * The photo is prepared first by the app's adaptive, 500 KB-capped path, because a modern phone
 * camera's receipt is 4–8 MB and the bucket allows 10: one bill photographed twice would fill the
 * allowance. A receipt is text-like, so that path keeps more resolution than a product photo. A
 * voice note goes through the audio path (audioCompression.ts): 32 kbps mono Opus, which is what
 * the recorder writes, so a note from this app is uploaded without a second encode.
 */
export async function uploadFinanceMedia(input: {
  shopId: string;
  branchId: string;
  entryId: string;
  kind: FinanceMediaKind;
  file: File;
  durationMs?: number | null;
}): Promise<string> {
  if (input.file.size > MAX_MEDIA_BYTES) {
    throw new Error("TOO_LARGE");
  }
  // A photo through the adaptive 500 KB path; a voice note through the 32 kbps path, which leaves
  // a note recorded by this app untouched (it is already at that bitrate) and only re-encodes one
  // that arrived above it. Both return the file to upload, never a promise to compress later.
  const prepared =
    input.kind === "photo" ? await compressImage(input.file) : (await prepareVoice(input.file)).file;
  if (input.kind === "photo" && prepared.size > HARD_MAX_IMAGE_BYTES) {
    throw new Error("TOO_LARGE");
  }
  const mime = mediaMime(prepared, input.kind);
  const path =
    `${input.shopId}/${input.branchId}/${input.entryId}/` +
    `${crypto.randomUUID()}.${extensionFor(mime)}`;

  const { error: uploadError } = await supabase.storage
    .from(FINANCE_MEDIA_BUCKET)
    .upload(path, prepared, { cacheControl: "3600", upsert: false, contentType: mime });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await supabase.rpc("attach_finance_media", {
    p_entry_id: input.entryId,
    p_kind: input.kind,
    p_path: path,
    p_mime: mime,
    p_bytes: prepared.size,
    p_duration_ms: input.kind === "voice" ? Math.round(input.durationMs ?? 0) : null,
  });

  if (error) {
    // The object is written but no row names it. The client cannot delete it (see 0263); it is
    // private, unaddressable without a signed URL and reclaimed only by server-side maintenance.
    throw new Error(error.message);
  }

  return data as string;
}

/**
 * Remove an attachment row.
 *
 * The object itself is not deleted from the browser: storage has no client delete grant (0230),
 * and a receipt is removed by removing the row that names it. The leftover object is private and
 * unreachable; `0263` says why that trade is the correct one.
 */
export async function removeFinanceMedia(id: string): Promise<void> {
  const { error } = await supabase.rpc("remove_finance_media", { p_id: id });
  if (error) throw new Error(error.message);
}

/** A short-lived link for one private object. */
export async function financeMediaUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(FINANCE_MEDIA_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** The same, for a whole entry at once. Paths that cannot be signed are simply absent. */
export async function financeMediaUrls(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const { data, error } = await supabase.storage
    .from(FINANCE_MEDIA_BUCKET)
    .createSignedUrls(paths, 60 * 60);
  if (error || !data) return map;
  for (const item of data) {
    if (item.signedUrl && item.path) map.set(item.path, item.signedUrl);
  }
  return map;
}

/** The words for how long a recording is: `0:07`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
