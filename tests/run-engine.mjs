// Runner for the reminder engine matrix.
//
// NEUTRALIZED: this file used to hardcode the PRODUCTION project URL, its publishable key and its
// project id, then import ./real-engine-matrix.mts — which reads and writes real reminder rows.
// Running it mutated production data. It now requires the caller to name a non-production target
// and refuses to start otherwise. Not referenced by package.json, any workflow or any config.

const REQUIRED = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PROJECT_ID"];

const missing = REQUIRED.filter((name) => !process.env[name] || !String(process.env[name]).trim());

if (missing.length) {
  throw new Error(
    `[RUN-ENGINE] ${missing.join(", ")} must be set explicitly. This runner must never be pointed ` +
      `at production: it creates and deletes reminder rows. See .env.example.`,
  );
}

if (process.env.VITE_SUPABASE_PROJECT_ID.trim() === "gkswcfljxlutkfdvvqng") {
  throw new Error(
    "[RUN-ENGINE] Refusing to run against the PRODUCTION project. This runner writes rows.",
  );
}

globalThis.__viteEnv = {
  VITE_SUPABASE_PROJECT_ID: process.env.VITE_SUPABASE_PROJECT_ID.trim(),
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY.trim(),
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL.trim(),
};

await import("./real-engine-matrix.mts");
