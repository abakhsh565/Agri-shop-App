// Supabase Edge Function: ota-manifest
//
// WHAT IT IS. The one URL an installed app asks "is there new code for me?". It is deliberately thin:
// the decision lives in `public.ota_manifest()` (migration 0334) so the SQL side is the single place
// that understands versions, native compatibility and the active-bundle rule; this function adds the
// two things SQL cannot know.
//
//   1. THE PER-PROJECT CHANNEL ALLOW-LIST. `OTA_ALLOWED_CHANNELS` is a secret set per project, so the
//      staging project serves `dev,staging` and the production project serves `production`. A request
//      for a channel this deployment does not own is refused *before* the database is touched. This is
//      the second lock behind the deployment split: even a hand-made request naming `production`
//      against the staging project gets `403`, not a bundle.
//   2. CORS and a stable public URL. The app is a WebView; the call is a plain fetch.
//
// WHY THE TABLE IS NOT READABLE BY CLIENTS. `ota_bundles` holds every version of every channel. The
// manifest returns at most one row and only the fields an install needs, so the history cannot be
// enumerated by anyone who can open the app.
//
// SECRETS (set with `supabase secrets set`, never in the repo):
//   OTA_ALLOWED_CHANNELS   comma-separated channels this project may serve, e.g. `dev,staging`
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
//
// REQUEST  POST { "channel": "staging", "nativeVersion": 2, "current": "1.0.0", "platform": "android" }
// RESPONSE 200 { "update": true,  "channel": "staging", "version": "1.1.0", "url": "https://…zip",
//                "checksum": "<sha256>", "size_bytes": 1234, "required_native": 2, "notes": "…" }
//          200 { "update": false, "channel": "staging", "reason": "UP_TO_DATE" | "NO_ACTIVE_BUNDLE" |
//                "NATIVE_TOO_OLD", … }
//          403 { "error": "CHANNEL_NOT_SERVED" }  — this project does not own that channel
//          400 { "error": "VALIDATION" }          — no channel, or a native version that is not a number
//
// DEPLOY. `supabase functions deploy ota-manifest --no-verify-jwt` (the app calls it with the anon key,
// and the channel allow-list — not a JWT — is what decides who may read what).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** The channels this deployment is allowed to serve. Empty means "nothing", never "everything". */
function allowedChannels(): string[] {
  return (Deno.env.get("OTA_ALLOWED_CHANNELS") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  let payload: {
    channel?: unknown;
    nativeVersion?: unknown;
    current?: unknown;
    platform?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "VALIDATION", message: "a JSON body is required" }, 400);
  }

  const channel = typeof payload.channel === "string" ? payload.channel.trim().toLowerCase() : "";
  const nativeVersion = Number(payload.nativeVersion);
  const current = typeof payload.current === "string" && payload.current.trim() ? payload.current.trim() : null;

  if (!channel) return json({ error: "VALIDATION", message: "channel is required" }, 400);
  if (!Number.isFinite(nativeVersion) || nativeVersion < 1) {
    return json({ error: "VALIDATION", message: "nativeVersion must be a positive integer" }, 400);
  }
  if (current !== null && !/^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$/.test(current)) {
    return json({ error: "VALIDATION", message: "current is not a version" }, 400);
  }

  const allowed = allowedChannels();
  if (allowed.length === 0) {
    // A deployment that was never configured must refuse, not guess. Serving `production` from a
    // project that forgot its secret is the failure this function exists to prevent.
    return json({ error: "CHANNEL_NOT_SERVED", message: "this deployment has no OTA channels configured" }, 403);
  }
  if (!allowed.includes(channel)) {
    return json({ error: "CHANNEL_NOT_SERVED", channel, served: allowed }, 403);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase.rpc("ota_manifest", {
    p_channel: channel,
    p_native_version: Math.floor(nativeVersion),
    p_current: current,
  });

  if (error) {
    // Never a silent "no update": a broken manifest read reported as up-to-date is how an app stays
    // on a bad bundle forever.
    return json({ error: "MANIFEST_UNAVAILABLE", message: error.message }, 500);
  }

  return json(data);
});
