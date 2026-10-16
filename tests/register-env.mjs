// Register hook to set import.meta.env for Vite modules.
//
// NEUTRALIZED: this file used to fill in the PRODUCTION project and PRODUCTION publishable key
// whenever they were not already set, so a plain `node --import ./tests/register-env.mjs …` run
// talked to production by default. It now requires the caller to state the target.
// Not referenced by package.json, any workflow, or any config.

const REQUIRED = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PROJECT_ID"];

const missing = REQUIRED.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  throw new Error(
    `[REGISTER-ENV] ${missing.join(", ")} must be set explicitly. There is no default project: ` +
      `defaulting is how a script reaches production without anyone deciding to. See .env.example.`,
  );
}

import.meta.env = import.meta.env || {};

for (const name of REQUIRED) import.meta.env[name] = process.env[name].trim();
