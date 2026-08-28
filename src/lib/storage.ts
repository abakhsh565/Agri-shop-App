import { supabase } from "@/lib/supabase";

export type ImageBucket = "product-images" | "employee-photos" | "company-logos" | "customer-images";

// ─── Image Compression (WhatsApp-quality) ───────────────────────────────────
// Resizes to max 1200px on longest edge, converts to JPEG at quality 0.82.
// Skips tiny images that are already well-compressed.
const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.82;
const SKIP_BELOW_BYTES = 150 * 1024; // skip images already under 150 KB

async function compressImage(file: File): Promise<File> {
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
