import { createClient } from "@supabase/supabase-js";
import { projectId, publicAnonKey } from "@/../utils/supabase/info";

/**
 * Supabase client for browser/device access (RLS-enforced) + Realtime.
 *
 * There is no fallback project and no fallback key. Both come from the build's own environment,
 * and a build that was not given them fails here with a message naming what is missing.
 *
 * This is the second half of the fix in utils/supabase/info.tsx: that file used to default to the
 * PRODUCTION project id and PRODUCTION publishable key, so a build with no env vars silently
 * talked to production. Now nothing is inferred, and the failure is immediate and legible.
 *
 * The environment's *rules* (which project each environment may use, and the refusal to run as
 * production without real OTP delivery) are asserted separately by src/lib/envGuard.ts at
 * start-up, so a wrong-but-present configuration fails too, not only a missing one.
 */

const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();

/**
 * A build may name the project instead of the URL — CI does. Deriving a URL from a project id
 * that the build explicitly provided invents nothing. Deriving one from an id the build never
 * supplied is precisely how a build used to reach production, and it is gone: with neither value
 * set, this throws instead of guessing.
 */
const rawProjectId = (
  import.meta.env.VITE_SUPABASE_PROJECT_ID ??
  projectId ??
  ""
).trim();

const resolvedUrl = rawUrl || (rawProjectId ? `https://${rawProjectId}.supabase.co` : "");

if (!resolvedUrl) {
  throw new Error(
    "[CONFIG] Neither VITE_SUPABASE_URL nor VITE_SUPABASE_PROJECT_ID is set for this build, and " +
      "there is no fallback project. Set this environment's own Supabase URL. A build that " +
      "cannot name its database must not guess one.",
  );
}

const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? publicAnonKey ?? "").trim();

if (!rawKey) {
  throw new Error(
    "[CONFIG] VITE_SUPABASE_ANON_KEY is not set for this build, and there is no fallback key. " +
      "Set this environment's own anon/publishable key.",
  );
}

export const supabaseUrl = resolvedUrl;

export const supabase = createClient(resolvedUrl, rawKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
