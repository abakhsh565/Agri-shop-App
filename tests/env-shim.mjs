// Node.js shim for import.meta.env (Vite-specific).
//
// NEUTRALIZED: this file used to default `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and
// `VITE_SUPABASE_PROJECT_ID` to the PRODUCTION project, so simply importing it pointed a Node
// script at production regardless of what the caller intended. It now requires the caller to
// supply the target and fails loudly otherwise. Nothing here is referenced by package.json, any
// workflow, or any config; it is kept only so an existing manual command does not break silently.

var REQUIRED = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

var missing = REQUIRED.filter(function (name) {
  return !process.env[name] || !String(process.env[name]).trim();
});

if (missing.length) {
  throw new Error(
    "[ENV SHIM] " +
      missing.join(", ") +
      " must be set explicitly. This shim no longer defaults to any project — a default is how " +
      "a script ends up pointed at production without anyone deciding that. See .env.example.",
  );
}

if (!globalThis.import) globalThis.import = { meta: { env: {} } };
else if (!globalThis.import.meta) globalThis.import.meta = { env: {} };
else if (!globalThis.import.meta.env) globalThis.import.meta.env = {};

var env = globalThis.import.meta.env;
for (const name of REQUIRED) env[name] = process.env[name];
if (!env.VITE_SUPABASE_PROJECT_ID && process.env.VITE_SUPABASE_PROJECT_ID) {
  env.VITE_SUPABASE_PROJECT_ID = process.env.VITE_SUPABASE_PROJECT_ID;
}
