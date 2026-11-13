import { describe, expect, it } from "vitest";

import {
  VOICE_BITS_PER_SECOND,
  VOICE_SKIP_AT_OR_BELOW_BPS,
  effectiveBitrate,
  shouldReencode,
} from "@/lib/audioCompression";

/**
 * The audio pipeline's one decision: is this note already small enough?
 *
 * It matters in both directions. A note that is re-encoded for nothing loses a generation of
 * quality and holds the save button for the length of the recording; a note that is never
 * re-encoded leaves a 700 kbps WAV in a bucket built for voice messages.
 */
describe("voice-note optimisation decision", () => {
  it("measures the bitrate of a file from its bytes and its length", () => {
    // A 5 s, 352,844-byte WAV is ~565 kbps.
    expect(effectiveBitrate(352_844, 5)).toBe(564_550);
    // 20 s at the app's own target: 32 kbps.
    expect(effectiveBitrate(80_000, 20)).toBe(32_000);
  });

  it("has no opinion about a file whose length is unknown", () => {
    expect(effectiveBitrate(120_000, null)).toBeNull();
    expect(effectiveBitrate(120_000, 0)).toBeNull();
    expect(shouldReencode(120_000, null)).toBe(false);
  });

  it("re-encodes a note above the skip threshold, and leaves one at it alone", () => {
    // 1 s at 565 kbps is a WAV from a phone recorder — worth compressing.
    expect(shouldReencode(70_000, 1)).toBe(true);
    // 1 s at 32 kbps is what this app records now — a second pass would only lose quality.
    expect(shouldReencode(4_000, 1)).toBe(false);
    // The boundary itself is "already optimised".
    expect(shouldReencode(Math.round(VOICE_SKIP_AT_OR_BELOW_BPS / 8), 1)).toBe(false);
  });

  it("keeps the target below the skip threshold, with room for encoder rounding", () => {
    expect(VOICE_BITS_PER_SECOND).toBe(32_000);
    expect(VOICE_SKIP_AT_OR_BELOW_BPS).toBeGreaterThan(VOICE_BITS_PER_SECOND);
  });
});
