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

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
