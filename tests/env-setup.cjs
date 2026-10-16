// Stub import.meta.env for tsx runs so Vite-dependent modules load in Node.
//
// NEUTRALIZED: this file used to default all three Supabase variables to the PRODUCTION project
// and its publishable key, making production the implicit target of any script that loaded it.
// It now requires the caller to supply them. Not referenced by package.json, any workflow, or any
// config; kept so an existing manual command fails with a reason instead of silently retargeting.

const REQUIRED = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PROJECT_ID"];

const missing = REQUIRED.filter((name) => !process.env[name] || !String(process.env[name]).trim());

if (missing.length) {
  throw new Error(
    "[ENV SETUP] " +
      missing.join(", ") +
      " must be set explicitly. There is no default project — defaulting is how a script reaches " +
      "production without anyone deciding to. See .env.example.",
  );
}

const env = {};
for (const name of REQUIRED) env[name] = process.env[name].trim();

globalThis.__import_meta_env__ = env;
globalThis.__VITE_META_ENV__ = env;
