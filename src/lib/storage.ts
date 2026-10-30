import { supabase } from "@/lib/supabase";

export type ImageBucket = "product-images" | "employee-photos" | "company-logos" | "customer-images";

/**
 * The business's papers live in a bucket of their own, and it is PRIVATE (migration 0250).
 *
 * A product photo rendered in a list is not a secret; a licence and a CNIC are. So nothing from
 * this bucket is ever read through `getPublicUrl` — the value stored on the business is the
 * object's PATH, and the screen turns it into a short-lived signed URL when it draws it.
 */
export const BUSINESS_DOCUMENT_BUCKET = "business-documents";

// ─── Image Compression (WhatsApp-quality) ───────────────────────────────────
// Resizes to max 1200px on longest edge, converts to JPEG at quality 0.82.
// Skips tiny images that are already well-compressed.
const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.82;
const SKIP_BELOW_BYTES = 150 * 1024; // skip images already under 150 KB

/**
 * Resize and re-encode a raster image before it is uploaded.
 *
 * Exported for the private finance-receipts path (`lib/financeMedia`), which needs the same
 * WhatsApp-quality compression as every product photo but cannot use `uploadImage`: that helper
 * writes to a public bucket and returns a public URL, and a receipt must do neither.
 */
export async function compressImage(file: File): Promise<File> {
  // Skip if already small enough
  if (file.size <= SKIP_BELOW_BYTES && file.type === "image/jpeg") return file;
  // Only compress raster images
  if (!file.type.startsWith("image/")) return file;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      // Scale down if either dimension exceeds MAX_DIMENSION
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }

      // White background for JPEG (no transparency)
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            // Compression didn't help — keep original
            resolve(file);
            return;
          }
          resolve(new File([blob], stripExt(file.name) + ".jpg", {
            type: "image/jpeg",
            lastModified: Date.now(),
          }));
        },
        "image/jpeg",
        JPEG_QUALITY,
      );
    };

    img.onerror = () => resolve(file); // on error, keep original
    img.src = URL.createObjectURL(file);
  });
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/**
 * Upload an image file to a Supabase Storage bucket and return its public URL.
 * Automatically compresses the image (WhatsApp-quality) before uploading.
 * Files are namespaced with a timestamp to avoid collisions.
 */
export async function uploadImage(bucket: ImageBucket, file: File): Promise<string> {
  // Compress before upload
  const compressed = await compressImage(file);

  const ext = compressed.type === "image/png" ? "png" : "jpg";
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
 * Upload one business paper and return the object's PATH (not a URL).
 *
 * The path is prefixed with the shop it belongs to, because that prefix is what the storage policy
 * checks against `current_shop_id()`: a member of one business cannot write into another's folder,
 * and cannot list it either. The name itself is timestamp + random, as every other upload here.
 */
export async function uploadBusinessDocument(file: File, shopId: string): Promise<string> {
  const compressed = await compressImage(file);
  const ext = compressed.type === "image/png" ? "png" : "jpg";
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
