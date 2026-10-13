// Supabase Edge Function: assistant
//
// The AI assistant, in the app. There is no second sign-in: the function runs with the calling
// user's own Supabase access token, so it can read exactly what that user can read and nothing
// more, and the app reaches it with the session it already has.
//
// Deploy:
//   supabase functions deploy assistant
//   supabase secrets set GEMINI_API_KEY=...        # optional; without it the built-in answerer runs
//
// The rules live in `handler.mjs`, which this file only wraps, so that the same code can be run
// and proved on a laptop with `node ai-assistant/server/dev.mjs` — see that file and
// `ai-assistant/README.md`. What follows is only the Deno half: where the configuration comes from.
//
// WHAT THIS FUNCTION IS NOT
//   It is not a database client. There is no SQL tool, no generic "read this table" path, and it
//   never uses the service-role key. Every capability is one of the named tools in tools.mjs, each
//   declaring the permission it needs, and every read goes to PostgREST carrying the caller's own
//   token. An employee asking about profit does not get a sentence that says no; they get a tool
//   that does not exist for them, and a database that would refuse it anyway.
//
// WHAT IT KEEPS
//   Nothing. The chat lives in the app's memory for as long as the screen is open, and the client
//   sends back only the last few turns as context. No conversation is written to a table, a file
//   or a log — so "no history older than 24 hours" is satisfied by keeping no history at all.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handle } from "./handler.mjs";

serve((req: Request) =>
  handle(req, {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    geminiKey: Deno.env.get("GEMINI_API_KEY") ?? "",
    geminiModel: Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash",
    // Quota is counted per model per day; the small one is tried when the good one is spent.
    geminiFallbackModel: Deno.env.get("GEMINI_FALLBACK_MODEL") ?? "",
    // Optional. Empty means Google. Set it to a gateway that serves the Gemini generateContent
    // wire format (for example a self-hosted OmniRoute at http://localhost:20128/v1beta) and the
    // same function, tools and permission gate answer from there instead.
    modelBaseUrl: Deno.env.get("ASSISTANT_MODEL_BASE_URL") ?? "",
  }),
);
