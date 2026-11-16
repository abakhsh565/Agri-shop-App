/**
 * The assistant in every environment, not just this laptop.
 *
 * The same function file is deployed to staging and production and run from the dev harness, and
 * the only thing that differs between them is `env`. These tests state what each environment's
 * configuration must do: a deployment with no model key must degrade to the built-in layer and
 * refuse the voice instead of throwing, a deployment with a key must answer, and an older app that
 * does not know about split speech must keep working against the newer function.
 *
 * The static half is the other mistake an environment makes: a key or a loopback address written
 * into the source, which ships to every environment at once.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { handle } from "../../supabase/functions/assistant/handler.mjs";
import { splitForSpeech } from "../../supabase/functions/assistant/speech.mjs";

const ASSISTANT_DIR = "supabase/functions/assistant";
const REPLY =
  "Today's sales total 0 rupees. No sales were recorded today. You can open it from Sales.";

const wav = Uint8Array.from([
  ...new TextEncoder().encode("RIFF"),
  36, 0, 0, 0,
  ...new TextEncoder().encode("WAVE"),
  ...new TextEncoder().encode("fmt "),
  16, 0, 0, 0, 1, 0, 1, 0, 0x80, 0xbb, 0, 0, 0, 0x77, 1, 0, 2, 0, 16, 0,
  ...new TextEncoder().encode("data"),
  0, 0, 0, 0,
]);

function request(body: unknown) {
  return new Request("https://app.example/functions/v1/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer header.payload.sig" },
    body: JSON.stringify(body),
  });
}

/** The network the function is allowed to see: Supabase, plus whatever the case adds. */
function stubNetwork(extra?: (url: string) => Response | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const custom = extra?.(url);
      if (custom) return custom;
      if (url.includes("/rest/v1/rpc/get_my_permissions")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/rest/v1/users")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
}

/** A provider that answers the way the real ones do: Urdu text, then a WAV. */
function providers() {
  return (url: string): Response | null => {
    if (url.includes("api.groq.com") && url.endsWith("/chat/completions")) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "آج کی کل فروخت صفر روپے ہے۔ آج کوئی فروخت نہیں ہوئی۔" } }],
        }),
        { status: 200 },
      );
    }
    if (url.includes(":generateContent")) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: "audio/wav", data: Buffer.from(wav).toString("base64") } },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    return null;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a deployment with no model key", () => {
  it("labels itself built-in rather than naming a model it cannot reach", async () => {
    stubNetwork();
    const res = await handle(request({ action: "tools" }), {
      supabaseUrl: "https://staging.example.supabase.co",
      anonKey: "anon",
    });

    expect(res.status).toBe(200);
    expect((await res.json()).model).toBe("built-in");
  });

  it("refuses the voice with a message instead of crashing", async () => {
    stubNetwork();
    const res = await handle(request({ action: "speak", text: REPLY, part: 0 }), {
      supabaseUrl: "https://staging.example.supabase.co",
      anonKey: "anon",
    });

    expect(res.status).toBe(503);
    expect(String((await res.json()).error)).toMatch(/not switched on/i);
  });
});

describe("a deployment with keys", () => {
  it("speaks the first sentence and says how many parts the reply has", async () => {
    stubNetwork(providers());
    const res = await handle(request({ action: "speak", text: REPLY, part: 0 }), {
      supabaseUrl: "https://staging.example.supabase.co",
      anonKey: "anon",
      groqKey: "test-groq-key",
      geminiKey: "test-gemini-key",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mimeType).toBe("audio/wav");
    expect(body.total).toBe(splitForSpeech(REPLY).length);
    expect(body.index).toBe(0);
  });

  it("still speaks the whole reply for an app that never sends a part", async () => {
    stubNetwork(providers());
    const res = await handle(request({ action: "speak", text: REPLY }), {
      supabaseUrl: "https://staging.example.supabase.co",
      anonKey: "anon",
      groqKey: "test-groq-key",
      geminiKey: "test-gemini-key",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.audio.length).toBeGreaterThan(0);
    // No part was asked for, so no part metadata is invented for the caller.
    expect(body.total).toBeUndefined();
  });
});

describe("nothing environment-specific is written into the shipped function", () => {
  const sources = readdirSync(ASSISTANT_DIR)
    .filter((name) => name.endsWith(".mjs") || name.endsWith(".ts"))
    .map((name) => ({ name, text: readFileSync(join(ASSISTANT_DIR, name), "utf8") }));

  it("carries no provider key literal", () => {
    const offenders = sources.filter(({ text }) =>
      /(gsk_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_\-]{20,}|sk-[A-Za-z0-9]{20,})/.test(text),
    );
    expect(offenders.map((source) => source.name)).toEqual([]);
  });

  it("carries no loopback address that only this machine can reach", () => {
    // Comments are allowed to mention one (they explain what a gateway URL looks like); a string
    // the code could actually call is not.
    const offenders = sources.filter(({ text }) => {
      const withoutComments = text
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      return /(127\.0\.0\.1|localhost)/.test(withoutComments);
    });
    expect(offenders.map((source) => source.name)).toEqual([]);
  });

  it("reads every provider setting from the environment it is given", () => {
    const handler = sources.find((source) => source.name === "handler.mjs")?.text ?? "";
    for (const setting of ["geminiKey", "geminiModel", "groqKey", "groqModel", "supabaseUrl", "anonKey"]) {
      expect(handler).toContain(`env.${setting}`);
    }
    expect(handler).not.toMatch(/process\.env/);
  });

  it("keeps the local key files untracked by the repository", () => {
    const gitignore = readFileSync(".gitignore", "utf8");
    expect(gitignore).toMatch(/^\.env\*$/m);
  });
});
