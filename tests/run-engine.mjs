// Set the Vite env before any modules load
globalThis.__viteEnv = {
  VITE_SUPABASE_PROJECT_ID: "gkswcfljxlutkfdvvqng",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG",
  VITE_SUPABASE_URL: "https://gkswcfljxlutkfdvvqng.supabase.co",
};

// Now dynamically import the test
import("./real-engine-matrix.mts");
