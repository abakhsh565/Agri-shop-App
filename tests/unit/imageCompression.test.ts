import { describe, expect, it } from "vitest";

import {
  HARD_MAX_IMAGE_BYTES,
  classifyImageSurface,
  extensionForImageMime,
  planForProfile,
} from "../../src/lib/imageCompression";

describe("the image ceiling and its adaptive plans", () => {
  it("never allows an uploaded picture above 500 KB", () => {
    expect(HARD_MAX_IMAGE_BYTES).toBe(500 * 1024);
  });

  it("keeps more resolution and a higher quality floor for text than for a photo", () => {
    const text = planForProfile("text");
    const photo = planForProfile("photo");
    expect(text.maxEdge).toBeGreaterThan(photo.maxEdge);
    expect(Math.min(...text.qualities)).toBeGreaterThan(Math.min(...photo.qualities));
  });

  it("classifies a dense neutral scan as text", () => {
    expect(
      classifyImageSurface({
        edgeDensity: 0.14,
        lightFraction: 0.7,
        darkFraction: 0.1,
        colourFraction: 0.12,
        alphaFraction: 0,
      }),
    ).toBe("text");
  });

  it("classifies a colourful, soft photograph as a photo", () => {
    expect(
      classifyImageSurface({
        edgeDensity: 0.02,
        lightFraction: 0.4,
        darkFraction: 0.02,
        colourFraction: 0.72,
        alphaFraction: 0,
      }),
    ).toBe("photo");
  });

  it("keeps a transparent logo a graphic rather than flattening it", () => {
    expect(
      classifyImageSurface({
        edgeDensity: 0.02,
        lightFraction: 0.2,
        darkFraction: 0.1,
        colourFraction: 0.4,
        alphaFraction: 0.3,
      }),
    ).toBe("graphic");
  });

  it("names the file extension from the encoded mime, not from the original name", () => {
    expect(extensionForImageMime("image/png")).toBe("png");
    expect(extensionForImageMime("image/webp")).toBe("webp");
    expect(extensionForImageMime("image/jpeg")).toBe("jpg");
  });
});
