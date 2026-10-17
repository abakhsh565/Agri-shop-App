# Why Production was green and Preview was red — and what fixed it

**Date:** 2026-10-18 · Project `agri-shop-app` (`prj_tWZoyuctxYUj6RiA60q1d3ZACK52`) · Production untouched

## Symptom

GitHub showed the `Production` deployment green and the `Preview` deployment red on the same project.
On PR #3 (`post-merge-proof/recovery-drill`, head `12fbf50`) the "Vercel" check failed while the live
`main` deployment was fine.

## Cause — Vercel's own build log, not an inference

The failing check was Preview deployment `dpl_GGinwn8xmtqztfFgP5rycecqX76h`: `ERROR`,
`BUILD_UTILS_SPAWN_1 — Command "npm run build" exited with 1`. Its events end with:

```
[ENVIRONMENT GATE] Refusing to build.
  ENV_NAME_MISSING
  VITE_APP_ENV is not set. It must be exactly one of: development, staging, production. …
  Build mode: production
  VITE_APP_ENV: (unset)
  VITE_OTP_DELIVERY: (unset)
  VITE_SUPABASE_URL: (unset)
Error: [BUILD_UTILS_SPAWN_1] Command "npm run build" exited with 1
```

The project's `VITE_*` variables existed only under the **Production** scope. A preview build got none
of them, and `vite.config.ts`'s environment gate deliberately refuses to produce an artifact whose
environment is unnamed — the rule that stops a staging build from silently becoming production doing
its job. Production builds had the values, so they passed.

## Change

Five variables added to the project, scoped to **Preview** only, pointing at QA (staging):

| Key | Value |
|---|---|
| `VITE_APP_ENV` | `staging` |
| `VITE_SUPABASE_URL` | `https://bpybjrjenwccowvtrevu.supabase.co` |
| `VITE_SUPABASE_PROJECT_ID` | `bpybjrjenwccowvtrevu` |
| `VITE_SUPABASE_ANON_KEY` | QA publishable key (public by design, matches the URL and ref) |
| `VITE_OTP_DELIVERY` | `demo` |

No application code changed; `main` and the production deployment were not touched.

## Verification

| Check | Result |
|---|---|
| Rebuild PR #3's head as a preview (`dpl_A3CZK3xus8sFiTAgnL7rbRTVsFcZ`) | **READY** in 13.5s, `readySubstate: STAGED`, branch alias assigned |
| The build received the variables | build env contains `VITE_APP_ENV`, `VITE_SUPABASE_URL`, `VITE_OTP_DELIVERY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_ANON_KEY` |
| GitHub check on PR #3 | `Vercel — pass — Deployment has completed` |
| Preview renders | opened the branch URL: welcome screen renders in Urdu, no blank page |
| Wired to QA, not production | the loaded chunks contain `bpybjrjenwccowvtrevu.supabase.co`; the production ref appears once, as the `environmentContract` guard constant, not as the configured URL |
| Production unchanged | `dpl_CPwWXEUCsSvHg8KG1yHdzsZBrXBt`, `main` @ `7d19c25`, still `READY` |

## Consequence to keep in mind

Preview URLs now talk to QA **with demo OTP delivery**, so anyone holding a preview link can request a
code for a QA account. That was the chosen trade-off; switching Preview's `VITE_OTP_DELIVERY` to `sms`
removes the exposure without changing the database.

PR #3 still has one red check that is unrelated to this: `E2E lanes against QA` failed on the same
2026-10-16 commit (`accessUx`: "employee detail is missing \"Job & access\"", `adminFullAccess`: the
saved name did not survive a reload, `systemDrive`: a design token no longer reached the row label,
`actionCenter`: a 2-minute navigation timeout). That branch needs a rebase before those lanes can be
read as current.
