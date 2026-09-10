// Node.js shim for import.meta.env (Vite-specific).
// Sets the required env vars before any Vite-dependent modules load.

// Mock import.meta for Node.js / tsx runtime
if (!globalThis.import) {
  globalThis.import = { meta: { env: {} } };
} else if (!globalThis.import.meta) {
  globalThis.import.meta = { env: {} };
} else if (!globalThis.import.meta.env) {
  globalThis.import.meta.env = {};
}

// Set the env vars the app expects
var env = globalThis.import.meta.env;
if (!env.VITE_SUPABASE_PROJECT_ID) env.VITE_SUPABASE_PROJECT_ID = "gkswcfljxlutkfdvvqng";
if (!env.VITE_SUPABASE_ANON_KEY) env.VITE_SUPABASE_ANON_KEY = "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG";
if (!env.VITE_SUPABASE_URL) env.VITE_SUPABASE_URL = "https://gkswcfljxlutkfdvvqng.supabase.co";
