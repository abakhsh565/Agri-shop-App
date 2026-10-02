// Make import.meta.env available for Vite-dependent modules when running under tsx in Node.
//
// NEUTRALIZED: this file used to default all three Supabase variables to the PRODUCTION project
// and its publishable key. It now requires the caller to supply them explicitly. Not referenced
// by package.json, any workflow, or any config.

const REQUIRED = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PROJECT_ID"];

const missing = REQUIRED.filter((name) => !process.env[name] || !String(process.env[name]).trim());

if (missing.length) {
  throw new Error(
    "[ENV STUB] " +
      missing.join(", ") +
      " must be set explicitly. There is no default project — defaulting is how a script reaches " +
      "production without anyone deciding to. See .env.example.",
  );
}

const env = {};
for (const name of REQUIRED) env[name] = process.env[name].trim();

globalThis.__VITE_META_ENV__ = env;
for (const [key, value] of Object.entries(env)) process.env[key] = value;
