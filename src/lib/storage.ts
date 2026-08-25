import { supabase } from "@/lib/supabase";

export type ImageBucket = "product-images" | "employee-photos" | "company-logos" | "customer-images";

/**
 * Upload an image file to a Supabase Storage bucket and return its public URL.
 * Files are namespaced with a timestamp to avoid collisions. Throws on failure
 * so callers can surface an error state to the user.
 */
export async function uploadImage(bucket: ImageBucket, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  // Try upload directly
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/jpeg",
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
      const { error: retryErr } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "image/jpeg",
      });
      if (retryErr) throw new Error(retryErr.message);
    } else {
      throw new Error(error.message);
    }
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
