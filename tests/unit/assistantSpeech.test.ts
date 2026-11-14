import { afterEach, describe, expect, it, vi } from "vitest";

import {
  pcmToWav,
  urduSpeech,
} from "../../supabase/functions/assistant/speech.mjs";

const pcm = Uint8Array.from([0, 0, 1, 0, 2, 0, 3, 0]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Urdu speech", () => {
  it("wraps model PCM in a browser-playable WAV header", () => {
    const wav = pcmToWav(pcm, { sampleRate: 24000, channels: 1 });
    const view = new DataView(wav.buffer);

    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(new TextDecoder().decode(wav.slice(36, 40))).toBe("data");
    expect(view.getUint32(4, true)).toBe(36 + pcm.length);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(pcm.length);
    expect(wav.slice(44)).toEqual(pcm);
  });

  it("translates with the fallback model and returns a playable WAV", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);

        if (url.includes("gemini-2.5-flash:generateContent")) {
          return new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 });
        }
        if (url.includes("gemini-flash-lite-latest:generateContent")) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: "آج آپ نے 8 فروخت میں 12,450 روپے کی فروخت کی۔" }],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("gemini-3.8-flash-tts:generateContent")) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: "audio/wav",
                          data: Buffer.from(pcmToWav(pcm)).toString("base64"),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const result = await urduSpeech({
      text: "Today you sold 12,450 rupees across 8 sales.",
      apiKey: "test-key",
      model: "gemini-2.5-flash",
      fallbackModel: "gemini-flash-lite-latest",
    });

    expect(result.urdu).toContain("12,450");
    expect(result.mimeType).toBe("audio/wav");
    const wav = Uint8Array.from(atob(result.audio), (character) => character.charCodeAt(0));
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(calls.some((url) => url.includes("gemini-3.8-flash-tts"))).toBe(true);
  });
});
