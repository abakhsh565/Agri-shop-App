import { supabase } from "@/lib/supabase";
import {
  HARD_MAX_IMAGE_BYTES,
  extensionForImageMime,
  imageMime,
  prepareImage,
} from "@/lib/imageCompression";

export type ImageBucket = "product-images" | "employee-photos" | "company-logos" | "customer-images";

/**
 * The business's papers live in a bucket of their own, and it is PRIVATE (migration 0250).
 *
 * A product photo rendered in a list is not a secret; a licence and a CNIC are. So nothing from
 * this bucket is ever read through `getPublicUrl` — the value stored on the business is the
 * object's PATH, and the screen turns it into a short-lived signed URL when it draws it.
 */
export const BUSINESS_DOCUMENT_BUCKET = "business-documents";

/**
 * The app's one adaptive image preparation path. The rule lives in `imageCompression.ts` so the
 * assistant's bill photo, product photos and private finance receipts all get the same treatment.
 * Re-exported here because the finance path and older call sites import `compressImage` from this
 * module.
 */
export { compressImage } from "@/lib/imageCompression";

/**
 * Upload an image file to a Supabase Storage bucket and return its public URL.
 * The adaptive preparation path caps the uploaded file at 500 KB while keeping text readable.
 * Files are namespaced with a timestamp to avoid collisions.
 */
export async function uploadImage(bucket: ImageBucket, file: File): Promise<string> {
  // Prepare before upload. Small or already-prepared pictures are returned untouched.
  const compressed = (await prepareImage(file)).file;
  if (imageMime(compressed) && compressed.size > HARD_MAX_IMAGE_BYTES) {
    throw new Error("This image is still over 500 KB. Try a smaller or simpler picture.");
  }

  const ext = extensionForImageMime(compressed.type);
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  // Try upload directly
  const { error } = await supabase.storage.from(bucket).upload(path, compressed, {
    cacheControl: "3600",
    upsert: false,
    contentType: compressed.type || "image/jpeg",
  });

  if (error) {
    // If bucket doesn't exist, try to create it
    if (error.message?.includes("Bucket not found") || error.message?.includes("not found")) {
      const { error: createErr } = await supabase.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024, // 5MB
        allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
      });
      if (createErr && !createErr.message?.includes("already exists")) {
        throw new Error(`Storage setup needed. Please create "${bucket}" bucket in Supabase Dashboard → Storage.`);
      }
      // Retry upload after creating bucket
      const { error: retryErr } = await supabase.storage.from(bucket).upload(path, compressed, {
        cacheControl: "3600",
        upsert: false,
        contentType: compressed.type || "image/jpeg",
      });
      if (retryErr) throw new Error(retryErr.message);
    } else {
      throw new Error(error.message);
    }
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * A stored image, as THIS installation can load it.
 *
 * `uploadImage` stores `getPublicUrl()`'s absolute URL on the row, and an absolute URL names the
 * project that uploaded it: an image uploaded on one origin then 404s on another, so the screen
 * quietly falls back to initials while the picture itself is perfectly fine (a customer row in
 * Development was pointing at the staging project). The object's PATH is portable; the origin is
 * not. Anything stored from one of these public buckets is therefore rebuilt against the project
 * this session is talking to, and every other shape (a bare path, an outside link) is returned
 * untouched.
 */
export function resolveImageUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/i.exec(value);
  if (!match) return value;
  const bucket = decodeURIComponent(match[1]);
  const path = decodeURIComponent(match[2].split("?")[0]);
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Upload one business paper and return the object's PATH (not a URL).
 *
 * The path is prefixed with the shop it belongs to, because that prefix is what the storage policy
 * checks against `current_shop_id()`: a member of one business cannot write into another's folder,
 * and cannot list it either. The name itself is timestamp + random, as every other upload here.
 */
export async function uploadBusinessDocument(file: File, shopId: string): Promise<string> {
  const compressed = (await prepareImage(file)).file;
  if (imageMime(compressed) && compressed.size > HARD_MAX_IMAGE_BYTES) {
    throw new Error("This document image is still over 500 KB. Try a smaller or simpler picture.");
  }
  const ext = extensionForImageMime(compressed.type);
  const path = `${shopId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage.from(BUSINESS_DOCUMENT_BUCKET).upload(path, compressed, {
    cacheControl: "3600",
    upsert: false,
    contentType: compressed.type || "image/jpeg",
  });
  if (error) throw new Error(error.message);

  return path;
}

/**
 * A stored paper as something an <img> can load.
 *
 * Two shapes reach this: a path in the private bucket (anything the owner added here) and a full
 * https URL from the signup form, which was stored as a link before this bucket existed. The URL is
 * passed through; only a bare path is signed, and the signature lasts an hour — long enough to read
 * a document, short enough not to be a permanent link to someone's identity card.
 */
export async function businessDocumentUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  const { data, error } = await supabase.storage
    .from(BUSINESS_DOCUMENT_BUCKET)
    .createSignedUrl(value, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}
