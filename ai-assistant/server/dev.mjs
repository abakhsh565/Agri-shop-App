/**
 * dev.mjs — the assistant's function, running on this machine.
 *
 * Edge functions need a deployed project, an access token and a network round trip per change;
 * the part of this system that has to be examined closely — who is handed what — shouldn't need
 * any of that. So this file wraps **the same `handle()` the deployed function uses**
 * (`supabase/functions/assistant/handler.mjs`) in a few lines of Node's http server. There is no
 * second set of rules here and no second sign-in: a request arrives with the app's own access
 * token, exactly as it does in production.
 *
 * Point the app at it and the whole assistant — the tab, the widgets, the permission wall — can be
 * used with a normal sign-in:
 *
 *   node ai-assistant/server/dev.mjs                     # http://localhost:64701
 *   VITE_ASSISTANT_DEV_URL=http://localhost:64701 npm run dev
 *
 * Uses VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from `.env.local` first — the same local stack
 * the development app uses — with QA_* from `.env.qa` as the fallback. GEMINI_API_KEY comes from
 * `ai-assistant/.env` when present. With no model key the built-in answerer answers instead, from
 * the same tools — which is how the permission checks are run without spending anything.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handle } from "../../supabase/functions/assistant/handler.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/** The same environment the app and the selftest read, in the same order, so they cannot disagree. */
for (const file of [path.join(ROOT, "ai-assistant", ".env"), path.join(ROOT, ".env.local"), path.join(ROOT, ".env.qa")]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0 || line.trim().startsWith("#")) continue;
    const key = line.slice(0, at).trim();
    if (!process.env[key]) process.env[key] = line.slice(at + 1).trim().replace(/^\[|\]$/g, "");
  }
}

const env = {
  // The app in development talks to the LOCAL stack in `.env.local`; the harness must carry the
  // same token to the same project, or every local question is a 401 that looks like a model
  // failure. QA remains the fallback for a checkout with no local stack.
  supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.QA_SUPABASE_URL || "",
  anonKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.QA_SUPABASE_ANON_KEY || "",
  geminiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  geminiFallbackModel: process.env.GEMINI_FALLBACK_MODEL || "",
  // Where the model calls go: Google by default, or a gateway that serves the same Gemini wire
  // format when ASSISTANT_MODEL_BASE_URL is set. Read here and passed down, so this file stays the
  // one place that decides what the runner is configured with.
  modelBaseUrl: process.env.ASSISTANT_MODEL_BASE_URL || "",
};

if (!env.supabaseUrl || !env.anonKey) {
  console.error("No Supabase configuration found — expected .env.qa in the repository root.");
  process.exit(2);
}

const port = Number(process.env.ASSISTANT_PORT || 64701);

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        model: env.geminiKey ? env.geminiModel : "built-in",
        project: env.supabaseUrl,
        // Said out loud so a question that fails can be traced to where it was sent.
        gateway: env.geminiKey
          ? env.modelBaseUrl || "https://generativelanguage.googleapis.com/v1beta"
          : null,
        // Said out loud because it is the promise the whole design rests on.
        keeps: "nothing — the transcript lives in the app's memory only",
        routes: ["POST / {action:'tools'}", "POST / {text, photo?, history?}"],
      }),
    );
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");

  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === "POST" ? body : undefined,
  });

  try {
    const response = await handle(request, env);
    const text = await response.text();
    // Every header the handler set is passed on. This is not decoration: the app sends an
    // Authorization header, which makes the browser issue a preflight, and a reply that loses
    // `Access-Control-Allow-Origin` is a reply the browser throws away — the question appears to
    // fail while the function answered it correctly.
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    res.writeHead(response.status, headers);
    res.end(text);
  } catch (error) {
    console.error("[assistant dev] failed:", error?.message);
    res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: "I could not finish that. Please try again." }));
  }
});

server.listen(port, () => {
  console.log(`agrishop-assistant dev harness — http://localhost:${port}`);
  console.log(`  project ${env.supabaseUrl}`);
  console.log(
    `  model   ${
      env.geminiKey
        ? `${env.geminiModel}${env.geminiFallbackModel ? ` → ${env.geminiFallbackModel}` : " → gemini-flash-lite-latest (built in)"}`
        : "built-in (no GEMINI_API_KEY)"
    }`,
  );
  if (env.geminiKey) {
    console.log(
      `  sends   ${env.modelBaseUrl || "https://generativelanguage.googleapis.com/v1beta"}`,
    );
  }
  console.log("  keeps   nothing — the transcript never leaves the app");
});
