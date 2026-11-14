/**
 * Adaptive image preparation for every picture the app uploads.
 *
 * The old rule was one size for everything: longest edge 1200px, JPEG quality 0.82. That is a
 * reasonable product tile and a bad receipt: shrinking a supplier bill to 1200px can make the
 * figures unreadable, while re-encoding an already-small product photo wastes a generation of
 * quality. This module decides from the picture itself:
 *
 *   · text / documents / screenshots keep more resolution and a higher quality floor,
 *   · ordinary photographs are allowed a smaller file because detail is decorative,
 *   · graphics with transparency stay transparent,
 *   · an image that is already under the shop's 500 KB ceiling, or was just prepared by the crop
 *     screen and is still under it, is left alone.
 *
 * THE HARD CEILING IS 500 KB. A soft target below it absorbs the difference between the browser's
 * encoder and the file it actually writes; if that target cannot be reached at the planned size,
 * the image is scaled down in steps until it fits. Readability comes first, so text keeps its
 * resolution longer than a photograph of a shelf does.
 */

export type ImageProfile = "text" | "photo" | "graphic";

export interface ImageSurfaceStats {
  /** Share of neighbouring pixels whose brightness changes sharply. Text has a lot; skies do not. */
  edgeDensity: number;
  lightFraction: number;
  darkFraction: number;
  /** Share of visible pixels with meaningful colour. Documents are mostly neutral. */
  colourFraction: number;
  alphaFraction: number;
}

export interface ImageProfilePlan {
  profile: ImageProfile;
  maxEdge: number;
  /** Tried high to low; the first one under the soft budget wins. */
  qualities: number[];
  /** A soft bytes-per-output-pixel estimate. Not a global target or a hard maximum. */
  bytesPerPixel: number;
}

export interface PreparedImage {
  file: File;
  originalBytes: number;
  bytes: number;
  width: number;
  height: number;
  profile: ImageProfile | null;
  quality: number | null;
  format: string;
  changed: boolean;
}

const ANALYSIS_EDGE = 220;
/** The owner's rule: no uploaded picture is larger than this. */
export const HARD_MAX_IMAGE_BYTES = 500 * 1024;
/** Aim below the ceiling so an encoder difference never pushes a file over it. */
const SOFT_MAX_IMAGE_BYTES = 460 * 1024;
const MIN_SOFT_BUDGET = 96 * 1024;
const MIN_EDGE = 640;
const PREPARED = new WeakSet<File>();
const JPEG_LIKE = new Set(["image/jpeg", "image/webp"]);
const RASTER = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/bmp",
]);

let webpSupport: Promise<boolean> | null = null;

/** The MIME a file should be treated as, including files whose type is empty. */
export function imageMime(file: File): string {
  const raw = String(file.type || "").toLowerCase().split(";")[0].trim();
  if (raw === "image/jpg") return "image/jpeg";
  if (raw) return raw;
  const extension = String(file.name ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "avif") return "image/avif";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  if (extension === "bmp") return "image/bmp";
  return "";
}

export function extensionForImageMime(mime: string): "jpg" | "png" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** A file that has already been through this pipeline, or through the crop screen. */
export function markImagePrepared(file: File): File {
  PREPARED.add(file);
  return file;
}

export function isImagePrepared(file: File): boolean {
  return PREPARED.has(file);
}

/**
 * Classify the visible surface. Text and screenshots have many sharp edges and little colour;
 * a photograph has soft edges and colour; a logo often has transparency and large flat areas.
 */
export function classifyImageSurface(stats: ImageSurfaceStats): ImageProfile {
  const neutral = 1 - stats.colourFraction;
  const textSignal = stats.edgeDensity * 2.8 + neutral * 0.45 + (stats.lightFraction + stats.darkFraction) * 0.35;
  if (stats.alphaFraction > 0.04 && stats.edgeDensity < 0.08) return "graphic";
  if (stats.edgeDensity > 0.065 && neutral > 0.58 && textSignal >= 0.78) return "text";
  if (textSignal >= 1.05) return "text";
  return "photo";
}

export function planForProfile(profile: ImageProfile): ImageProfilePlan {
  switch (profile) {
    case "text":
      return {
        profile,
        maxEdge: 2560,
        qualities: [0.92, 0.9, 0.86, 0.82, 0.78],
        bytesPerPixel: 0.18,
      };
    case "graphic":
      return {
        profile,
        maxEdge: 1800,
        qualities: [0.92, 0.88, 0.84],
        bytesPerPixel: 0.16,
      };
    default:
      return {
        profile: "photo",
        maxEdge: 2200,
        qualities: [0.88, 0.84, 0.8, 0.75, 0.7, 0.64],
        bytesPerPixel: 0.105,
      };
  }
}

function supportsWebp(): Promise<boolean> {
  if (webpSupport) return webpSupport;
  webpSupport = new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      canvas.toBlob(
        (blob) => resolve(!!blob && blob.type === "image/webp"),
        "image/webp",
        0.8,
      );
    } catch {
      resolve(false);
    }
  });
  return webpSupport;
}

function loadImage(file: File): Promise<{ image: HTMLImageElement; url: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve({ image, url, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

function surfaceStats(image: HTMLImageElement, width: number, height: number): ImageSurfaceStats {
  const scale = Math.min(1, ANALYSIS_EDGE / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return { edgeDensity: 0, lightFraction: 0, darkFraction: 0, colourFraction: 1, alphaFraction: 0 };
  }
  context.clearRect(0, 0, sampleWidth, sampleHeight);
  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const total = sampleWidth * sampleHeight;
  let visible = 0;
  let light = 0;
  let dark = 0;
  let colour = 0;
  let alpha = 0;
  let edges = 0;
  let comparisons = 0;

  const luminance = (index: number) => {
    const i = index * 4;
    return 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
  };

  for (let y = 0; y < sampleHeight; y++) {
    for (let x = 0; x < sampleWidth; x++) {
      const index = y * sampleWidth + x;
      const i = index * 4;
      const a = pixels[i + 3];
      if (a < 250) alpha++;
      if (a < 24) continue;
      visible++;
      const value = luminance(index);
      if (value >= 235) light++;
      if (value <= 35) dark++;
      const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (max > 0 && (max - min) / max > 0.22) colour++;
      if (x + 1 < sampleWidth && pixels[(index + 1) * 4 + 3] >= 24) {
        comparisons++;
        if (Math.abs(value - luminance(index + 1)) > 26) edges++;
      }
      if (y + 1 < sampleHeight && pixels[(index + sampleWidth) * 4 + 3] >= 24) {
        comparisons++;
        if (Math.abs(value - luminance(index + sampleWidth)) > 26) edges++;
      }
    }
  }

  return {
    edgeDensity: comparisons ? edges / comparisons : 0,
    lightFraction: visible ? light / visible : 0,
    darkFraction: visible ? dark / visible : 0,
    colourFraction: visible ? colour / visible : 0,
    alphaFraction: total ? alpha / total : 0,
  };
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Prepare one picture and report what changed. The returned file is marked, so a second call on
 * the same object (for example upload after a crop) does not recompress it.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const mime = imageMime(file);
  const unchanged: PreparedImage = {
    file,
    originalBytes: file.size,
    bytes: file.size,
    width: 0,
    height: 0,
    profile: null,
    quality: null,
    format: mime || "application/octet-stream",
    changed: false,
  };

  // A crop is already high-quality and must not be encoded twice — unless it is still over the
  // ceiling, in which case this pass is the one that makes it acceptable.
  if (PREPARED.has(file) && file.size <= HARD_MAX_IMAGE_BYTES) return unchanged;
  // GIFs may be animated and SVGs are vector: rasterising either would destroy information.
  if (!RASTER.has(mime)) return unchanged;
  // A small JPEG/WebP is already doing the job; decoding it just to re-encode would lose quality.
  if (file.size <= 120 * 1024 && JPEG_LIKE.has(mime)) return unchanged;

  const decoded = await loadImage(file);
  if (!decoded) return unchanged;
  const { image, url, width, height } = decoded;

  try {
    if (!width || !height) return unchanged;
    const stats = surfaceStats(image, width, height);
    const profile = classifyImageSurface(stats);
    const plan = planForProfile(profile);

    // An image already within the ceiling and its planned edge is not spending a generation of
    // quality for a few kilobytes. Above the ceiling, compression is mandatory.
    if (file.size <= HARD_MAX_IMAGE_BYTES && Math.max(width, height) <= plan.maxEdge) return unchanged;

    const initialScale = Math.min(1, plan.maxEdge / Math.max(width, height));
    const initialWidth = Math.max(1, Math.round(width * initialScale));
    const initialHeight = Math.max(1, Math.round(height * initialScale));
    const outputPixels = initialWidth * initialHeight;
    const softBudget = Math.min(
      SOFT_MAX_IMAGE_BYTES,
      file.size * 0.92,
      Math.max(MIN_SOFT_BUDGET, outputPixels * plan.bytesPerPixel),
    );

    const webp = await supportsWebp();
    const hasTransparency = stats.alphaFraction > 0.01;
    const chosenType = webp ? "image/webp" : hasTransparency ? "image/png" : "image/jpeg";

    const render = async (
      outputWidth: number,
      outputHeight: number,
      type: string,
      qualities: number[],
    ): Promise<{ blob: Blob; quality: number } | null> => {
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.clearRect(0, 0, outputWidth, outputHeight);
      if (type === "image/jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, outputWidth, outputHeight);
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, outputWidth, outputHeight);

      let best: { blob: Blob; quality: number } | null = null;
      for (const quality of qualities) {
        const blob = await encode(canvas, type, quality);
        if (!blob) continue;
        if (!best || blob.size < best.blob.size) best = { blob, quality };
        if (blob.size <= softBudget) break;
      }
      return best;
    };

    let best: { blob: Blob; quality: number; width: number; height: number } | null = null;
    let scale = initialScale;
    // At most twelve steps: the soft target is usually reached on the first or second, and the
    // loop exists for a dense scan that keeps overshooting it. Every step preserves the aspect
    // ratio; the floor keeps the result useful rather than technically under 500 KB and unreadable.
    for (let attempt = 0; attempt < 12; attempt++) {
      const outputWidth = Math.max(1, Math.round(width * scale));
      const outputHeight = Math.max(1, Math.round(height * scale));
      const qualities =
        attempt === 0
          ? plan.qualities
          : [...new Set([...plan.qualities, 0.74, 0.68, 0.62, 0.56])].sort((a, b) => b - a);
      const attemptBest = await render(outputWidth, outputHeight, chosenType, qualities);
      if (attemptBest && (!best || attemptBest.blob.size < best.blob.size)) {
        best = { ...attemptBest, width: outputWidth, height: outputHeight };
      }
      if (attemptBest && attemptBest.blob.size <= softBudget) break;
      if (Math.max(outputWidth, outputHeight) <= MIN_EDGE) break;
      scale *= 0.82;
    }

    // Browser encoders occasionally disagree with the estimate. A last, small JPEG is the
    // guaranteed way to honour the ceiling rather than upload a file that merely looks close.
    if (best && best.blob.size > HARD_MAX_IMAGE_BYTES) {
      for (const cap of [480, 320]) {
        const emergencyScale = Math.min(1, cap / Math.max(width, height));
        const emergencyWidth = Math.max(1, Math.round(width * emergencyScale));
        const emergencyHeight = Math.max(1, Math.round(height * emergencyScale));
        const emergency = await render(emergencyWidth, emergencyHeight, "image/jpeg", [0.56, 0.48]);
        if (emergency && emergency.blob.size < best.blob.size) {
          best = { ...emergency, width: emergencyWidth, height: emergencyHeight };
        }
        if (best.blob.size <= HARD_MAX_IMAGE_BYTES) break;
      }
    }

    if (!best) return unchanged;
    // If the original already met the ceiling and re-encoding did not improve it, keep the
    // original rather than spend quality for no smaller file.
    if (best.blob.size >= file.size * 0.96 && file.size <= HARD_MAX_IMAGE_BYTES) return unchanged;
    // The ceiling wins over the original whenever the original was over it.
    if (best.blob.size > HARD_MAX_IMAGE_BYTES && file.size <= HARD_MAX_IMAGE_BYTES) return unchanged;

    const blobType = best.blob.type || chosenType;
    const extension = extensionForImageMime(blobType);
    const base = (file.name || "image").replace(/\.[^.]+$/, "").trim() || "image";
    const prepared = new File([best.blob], `${base}.${extension}`, {
      type: blobType,
      lastModified: Date.now(),
    });
    PREPARED.add(prepared);

    return {
      file: prepared,
      originalBytes: file.size,
      bytes: prepared.size,
      width: best.width,
      height: best.height,
      profile,
      quality: best.quality,
      format: blobType,
      changed: true,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The upload paths only need the file. */
export async function compressImage(file: File): Promise<File> {
  return (await prepareImage(file)).file;
}
