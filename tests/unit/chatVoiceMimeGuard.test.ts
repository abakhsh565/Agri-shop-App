/**
 * A recorded voice note must stay sendable, and playable, after it is stored.
 *
 * Two things broke a real clip on 2026-11-25 and neither was the recording: `MediaRecorder`
 * reports its codec as a parameter (`audio/webm;codecs=opus`) and the media function only knew
 * bare container names, so a good clip was refused as "unsupported mime type"; and the signed
 * link came back on a host only the server can reach, so the upload succeeded and the bubble
 * could not play. Both were found by recording a clip in the app, not by reading the code, so
 * both are pinned here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { baseMimeType } from "@/lib/chatMedia";

const MEDIA_FUNCTION = readFileSync("supabase/functions/farmer-media/index.ts", "utf8");
const CLIENT = readFileSync("src/lib/chatMedia.ts", "utf8");

describe("chat voice notes: mime and link", () => {
  it("names the container, not the codec, when a recorder reports both", () => {
    expect(baseMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(baseMimeType("audio/mp4; codecs=mp4a.40.2")).toBe("audio/mp4");
    expect(baseMimeType("AUDIO/OGG")).toBe("audio/ogg");
    expect(baseMimeType("")).toBe("");
  });

  it("uploads and records the bare type, so storage accepts the clip", () => {
    // The upload must normalise before it builds the request, not only in the recorder.
    expect(CLIENT).toMatch(/const mimeType = baseMimeType\(input\.mimeType\)/);
    expect(CLIENT).toMatch(/mime: mimeType,/);
    expect(CLIENT).toMatch(/startVoiceRecording[\s\S]*baseMimeType\(recorder\.mimeType/);
  });

  it("tolerates a codec parameter from an older client, which is already installed", () => {
    expect(MEDIA_FUNCTION).toMatch(/get\("mime"\)[\s\S]{0,120}split\(";"\)\[0\]/);
  });

  it("records mono at the voice bitrate, so a note is compressed at the source", () => {
    expect(CLIENT).toMatch(/channelCount: 1/);
    expect(CLIENT).toMatch(/VOICE_BITS_PER_SECOND = 24_000/);
    expect(CLIENT).toMatch(/audioBitsPerSecond: VOICE_BITS_PER_SECOND/);
  });

  it("hands back a link on the origin the caller reached, not the function's own", () => {
    expect(MEDIA_FUNCTION).toMatch(/new URL\(signed\.signedUrl, url\.origin\)/);
    expect(CLIENT).toMatch(/const origin = new URL\(functionsBase\(\)\)\.origin/);
  });
});
