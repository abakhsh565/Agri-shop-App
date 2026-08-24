import { useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";
import { uploadImage, type ImageBucket } from "@/lib/storage";

interface ImageUploadProps {
  bucket: ImageBucket;
  value?: string | null;
  onChange: (url: string | null) => void;
  /** "circle" for people/logos, "square" for products. */
  shape?: "circle" | "square";
  label?: string;
}

/**
 * Reusable image picker that uploads to Supabase Storage and returns the public
 * URL via onChange. Shows a local preview immediately, an uploading spinner,
 * and an error state if the upload fails. Used on Add Product / Employee /
 * Supplier screens so records carry a recognizable image, persisted in the DB.
 */
export default function ImageUpload({
  bucket,
  value,
  onChange,
  shape = "square",
  label = "Add photo",
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(value ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const radius = shape === "circle" ? "9999px" : "16px";

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    // Instant local preview while the upload runs.
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    setBusy(true);
    try {
      const url = await uploadImage(bucket, file);
      setPreview(url);
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setPreview(value ?? null);
      onChange(value ?? null);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clear() {
    setPreview(null);
    setError(null);
    onChange(null);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="relative flex items-center justify-center overflow-hidden transition-transform active:scale-95"
        style={{
          width: shape === "circle" ? 96 : 112,
          height: shape === "circle" ? 96 : 112,
          borderRadius: radius,
          border: "1.5px dashed var(--divider)",
          background: "var(--surface-2)",
        }}
      >
        {preview ? (
          <img src={preview} alt={label} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1" style={{ color: "var(--text-secondary)" }}>
            <ImagePlus size={22} />
            <span className="text-[11px] font-medium">{label}</span>
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
            <Loader2 size={22} className="animate-spin" color="#fff" />
          </div>
        )}

        {!busy && (
          <span
            className="absolute bottom-1 right-1 w-6 h-6 rounded-full flex items-center justify-center shadow"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            <Camera size={12} strokeWidth={2.5} />
          </span>
        )}
      </button>

      {preview && !busy && (
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1 text-[11px] font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          <X size={12} /> Remove
        </button>
      )}

      {error && (
        <p className="text-[11px] text-center" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
