# Phase 1 — Production Safety Gates

**Date:** 1 October 2026
**Status:** implemented and verified. **No database change was made in this phase.**

**Constraints honoured.** Nothing irreversible was done. No table, column, policy, migration, user
or row was created, altered or deleted. No production Supabase project was created. No APK was
built or released. No workflow was rewritten.

Evidence in this document is from commands that were actually run. Where a claim rests on reading
a file, it says so.

---

## A. Changed files

### New

| File | Why |
|---|---|
| `src/lib/environmentContract.ts` | The rules: which environment may use which project, and the refusal to run production without real OTP. Pure — no `import.meta.env`, no `process.env` — so the app, the build and the tests all evaluate the *same* rules and the rules are testable without a build. |
| `tests/unit/environmentSafety.test.ts` | 28 tests over those rules, each with a non-vacuity half. |
| `tests/unit/authSafetyGuard.test.ts` | 10 tests proving the shared code cannot work in production. |
| `tests/unit/productionReachGuard.test.ts` | 10 tests scanning the source; nothing automated may name production, and the demo code has one definition and one acceptance point. |
| `.env.example` | The variable names an environment must set, with no values. Committed on purpose. |

### Rewritten

| File | Before | After |
|---|---|---|
| `utils/supabase/info.tsx` | `projectId = … \|\| "gkswcfljxlutkfdvvqng"`, `publicAnonKey = … \|\| "sb_publishable_8YFs…"` | No default, no project id, no key. |
| `src/lib/envGuard.ts` | A `console.log`, plus a throw that only fired under `import.meta.env.DEV` | Asserts the contract at start-up in every build; throws `EnvironmentConfigurationError`. |
| `src/lib/supabase.ts` | Fell back to the hardcoded production project and key | Reads only what the build was given; throws a message naming the missing variable. |
| `src/lib/authMode.ts` | `VITE_OTP_DELIVERY === "sms" ? "sms" : "demo"` — unset meant demo | Mode derived from the environment; production resolves to `sms` unconditionally. |
| `tests/setup/env-guard.ts` | A second copy of the project ids and the check | Delegates to `environmentContract.ts`. |
| `vitest.config.ts` | Inherited whatever `.env.local` held | Declares `VITE_APP_ENV=staging`, `VITE_OTP_DELIVERY=demo`. |
| `vite.config.ts` | — | Added an `environmentGate` plugin: a build whose environment is unnamed, unknown or pointed at the wrong project fails and produces no artifact. |
| `playwright.config.ts` | Set the URL, key and project id | Also sets `VITE_APP_ENV` and `VITE_OTP_DELIVERY`, so the lanes state their environment. |

### Edited

`src/lib/auth.ts` — `assertDemoOtpAllowed()` at every point that could honour a demo code
(`sendOTP`, `verifyConfirmOTP`, `verifyOTPAndResolveUser`, and inside `ensureAuthSession`, which is
the bridge that mints a real session from a phone number). The accept/reject decision now has one
implementation, `demoCodeAccepted()`.

`.gitignore` — added `!.env.example` (`.env*` was silently ignoring it) and `/backups/`
(`scripts/backup-database.mjs` writes full-table dumps there; it was not ignored).

**Local, untracked config** (these are your files; all are gitignored):
`.env.local` gained `VITE_APP_ENV=development`, `.env.qa` gained `VITE_APP_ENV=staging`. Both
gained `VITE_OTP_DELIVERY=demo`. Without these, both would now fail closed, by design.

### Legacy harnesses neutralized

Six unreferenced files that defaulted to **production**, so that merely loading them pointed a Node
script at it. Each now requires an explicit target and refuses production. `tests/harden-reminder.mjs`
matters most: it creates and deletes reminder rows, payments and customer balances, and it resolved
its target by reading the fallback out of `info.tsx`.

`tests/env-setup.cjs`, `tests/env-stub.cjs`, `tests/env-shim.mjs`, `tests/register-env.mjs`,
`tests/run-engine.mjs`, `tests/harden-reminder.mjs`.

---

## B. Environment safety behavior

An environment is now something the build must *state*, not something inferred from which files
happen to be present.

| Situation | Result |
|---|---|
| `VITE_APP_ENV` unset, empty, or a value that is not `development`/`staging`/`production` | Refused — build fails, app refuses to boot |
| `VITE_SUPABASE_URL` and `VITE_SUPABASE_PROJECT_ID` both unset | Refused. Previously this meant production |
| `VITE_SUPABASE_ANON_KEY` unset | Refused. Previously this meant production's key |
| development or staging pointed at the production project | Refused |
| production pointed at anything but the production project | Refused |
| staging pointed at anything but the staging project | Refused |
| URL from one project, anon key from another | Refused (read from the key's own `ref` claim) |
| production without `VITE_OTP_DELIVERY=sms` | Refused |

Enforced in two places, both exercised below: at build time by `environmentGate` in `vite.config.ts`
(no artifact is produced), and at run time by `logEnvironmentInfo()` in `src/App.tsx`.

`development` is deliberately allowed to use the staging project *for now*: no development project
exists, and refusing it would break your dev server and every lane that runs today. That gap is
listed in section E rather than papered over.

---

## C. Authentication safety behavior

The defect: `VITE_OTP_DELIVERY` is set nowhere in this repository, `authMode.ts` treated anything
other than `"sms"` — including unset — as demo, and demo accepts `123456` for any registered phone
number, after which a real Supabase session is minted for that person's profile. Knowing a phone
number was enough to sign in as its owner.

Three locks now, and a test for each:

1. **The environment cannot be production without `sms`.** `resolveEnvironment` returns
   `DEMO_OTP_IN_PRODUCTION`. A missing value counts as demo, because missing is the dangerous case.
2. **A refused configuration resolves to the strict mode.** `otpModeFor()` answers `"sms"` for any
   verdict that is not `ok`. A broken configuration must never be answered with the permissive mode.
3. **One acceptance point.** `demoCodeAccepted(token, mode)` returns false for every mode except
   demo, and `auth.ts` calls it instead of comparing to the constant itself. The guard test asserts
   that no other file in `src/` performs such a comparison.

**Honest limit — this is the client boundary, not the server's.** The server boundary is Supabase
Auth: in production the Email/Password provider must be disabled (the demo bridge signs in with
`signInWithPassword` against an identity derived from the phone number), and
`provision_member_login` must stop creating those password identities. Both are dashboard settings
and a migration, and both belong to Phase 2 — a migration in this phase would have broken the
stated constraint. Until they are done, a build cannot *use* the bypass, but the identities the
bypass signs into still exist in the project that provisioning created them in.

---

## D. Tests executed and results

Every number below is from a command that was run.

| # | Check | Command | Result |
|---|---|---|---|
| 1 | TypeScript | `npx tsc --noEmit` | **clean**, exit 0 |
| 2 | New environment guards | `npx vitest run tests/unit/environmentSafety.test.ts` | **28 passed** |
| 3 | New authentication guards | `npx vitest run tests/unit/authSafetyGuard.test.ts` | **10 passed** |
| 4 | New source-scan guard | `npx vitest run tests/unit/productionReachGuard.test.ts` | **10 passed** |
| 5 | Full unit suite | `npx vitest run tests/unit` | **401 passed / 41 files** (was 353 / 38) |
| 6 | Full suite incl. integration | `npx vitest run` | **773 passed, 14 failed, 7 skipped (794)**, 6 failed files — see below |
| 7 | Production build | `npm run build` | **succeeds**; logs `[EnvGuard] building DEVELOPMENT → bpybjrjenwccowvtrevu (otp: demo, key verified)` |
| 8 | Build gate: production + demo OTP | `VITE_APP_ENV=production VITE_OTP_DELIVERY=demo … npx vite build` | **REFUSED, exit 1** — `DEMO_OTP_IN_PRODUCTION` |
| 9 | Build gate: production pointed at staging | `VITE_APP_ENV=production VITE_OTP_DELIVERY=sms VITE_SUPABASE_URL=https://bpybjrjenwccowvtrevu… vite build` | **REFUSED, exit 1** — `PRODUCTION_ENV_WRONG_PROJECT` |
| 10 | Build gate: a correct staging build still works | `VITE_APP_ENV=staging VITE_OTP_DELIVERY=demo npx vite build` | **succeeds**, `built in 4.25s` |
| 11 | Runtime guard: correct config | dev server + browser console | `[EnvGuard] DEVELOPMENT → bpybjrjenwccowvtrevu (otp: demo, key verified)`; app **renders** |
| 12 | Runtime guard: development pointed at production | second dev server + browser console | `EnvironmentConfigurationError: [ENVIRONMENT MISMATCH] Refusing to start: this is a "development" build but it points at the PRODUCTION Supabase project (gkswcfljxlutkfdvvqng)` — thrown from `assertEnvironment` ← `logEnvironmentInfo` ← `App.tsx:16` |
| 13 | Did it still reach production? | browser network log on that tab | **empty — zero requests**, `#root` had 0 children. It failed before rendering, and connected to nothing |
| 14 | Repo scan: production fallback | `node scripts/audit-production-readiness.mjs` | automated surface 400 files → **0** hardcode a production URL or key |
| 15 | Repo scan: demo OTP bypass | same | the constant is defined once; no other `src/` file compares against it |
| 16 | Non-vacuity: reinject the original defect | re-added the fallback lines to `info.tsx`, ran the guard, restored | **4 tests failed**, naming `utils/supabase/info.tsx`; after restoring, **10 passed** again |

Checks 8–13 are the ones that matter most: they are the behaviours the audit found missing, run for
real rather than inspected.

### The 14 integration failures — classified, not waved away

| File | Failures | Cause (verbatim from the run) | Attribution |
|---|---|---|---|
| `splitPayments.test.ts` | 8 | `error: NOT_AUTHENTICATED` from the DB, then 0 rows where a write was expected | pre-existing; the QA auth-fixture blocker recorded before this phase |
| `employeeAccessOverrides.test.ts` | 3 | `expected [ 'companies.view', … ] to match object { data: [] }`, `expected […] to not include 'sales.create'` | pre-existing; DB-side permission-override resolution drift |
| `rbacEnforcement.test.ts` | 1 | same family | pre-existing |
| `rbacFoundation.test.ts` | 1 | same family | pre-existing |
| `tenantResolverReplay.test.ts` | 1 | the DB returns 3 functions the test's expected list does not contain (`authorize_business_action`, `get_effective_permissions`, `resolve_invite`) | pre-existing schema drift |
| `priceTraceability.test.ts` | whole file | `create_product: INVALID_UNIT: a product is measured in kg or liter, not "piece"` | pre-existing business-rule drift on QA |

Two independent pieces of evidence that these are not mine:

- **Negative control.** The full run was grepped for every signature this phase could produce —
  `EnvironmentConfigurationError`, `ENVIRONMENT MISMATCH`, `[CONFIG]`, `DEMO_OTP`, `VITE_APP_ENV`,
  `EnvGuard] Refusing`, `assertDemoOtpAllowed`, `demoCodeAccepted`. **Zero occurrences.**
- **No SQL was changed.** `git status` shows no modified `.sql` file. Every failure above is a
  database answer or an assertion about database state, and this phase did not touch the database.
  If it had broken these tests, the failures would be thrown config errors, not `NOT_AUTHENTICATED`
  and `INVALID_UNIT`.

I did not attempt to fix them: they are outside this phase's scope, and fixing DB-side drift is
Phase 2 work.

---

## E. Remaining production blockers

**P0 — the server-side half of the OTP fix.** `provision_member_login` and the demo bridge sign in
with a password derived from the phone number. Production must have the Email/Password provider
disabled and provisioning must stop creating those identities. Requires `supabase-js`-side
inspection and a migration → Phase 2. Until then, a production *build* cannot use the bypass, but
the bypass's identities exist wherever provisioning ran.

**P0 — the release APK workflow does not supply any environment.** `.github/workflows/build-apk.yml`:

```yaml
      - name: Build Web App          # line 120
        run: npm run build           # line 121   ← no `env:` block
```

`VITE_*` appears in that file only at lines 67–69, which belong to the Playwright step in the
*test* job. The build job has no job-level `env:` either. So every APK this workflow produced was
built with no Supabase configuration at all — and with the old fallback in place, that means **every
released APK connected to the production project, with production's publishable key, in demo-OTP
mode where `123456` signs in as any registered number.** That is the most serious finding of this
engagement, and it is now fixed in the sense that the step fails instead of producing that artifact.

Consequence: **`build-apk.yml` will now fail at "Build Web App" until the four variables are added**
(section F). This is intended — your requirement is that the production APK is not generated yet.

**P0 — the database still points one way.** Unchanged from the audit: 34 tables where `anon` holds
write grants, `product_variants_select USING (true)`, the missing `product_variants_public` view that
breaks the employee catalogue, 15 deny-all tables, 32 unindexed foreign keys, and migration history
that records 3 of 167 files. All Phase 2.

**P1 — no development project.** `.env.local` is labelled `development` but points at the staging
project (`bpybjrjenwccowvtrevu`). The guard permits this today because no alternative exists. The
dev build's console line reads `DEVELOPMENT → bpybjrjenwccowvtrevu`, which is accurate and visible —
but it is one database for two environments, exactly the isolation gap the audit recorded.

**P1 — 25 unmanaged harnesses under `tests/` hardcode production.** Nothing references them, several
write rows (`tests/deploy-migration-0040.cjs` applies migrations; `tests/security-audit.cjs`,
`tests/dashboard-audit.cjs`, `tests/create-trigger-test-data.mjs` create and delete data). Their
count is now a ratchet in `productionReachGuard.test.ts`: it may fall, it may not rise. Recommend
deletion in Phase 2 with `git rm`, after a glance at each.

**P1 — the backup workflow backs up the wrong database and has never been restored.**
`backup-database.yml` is titled "Backup Production Database" and reads `QA_DB_*`.

**P1 — no monitoring.** Unchanged.

---

## F. Anything requiring approval

### F1. Two lines for the APK workflow (I did not touch it, per your instruction)

`.github/workflows/build-apk.yml`, under the "Build Web App" step, needs an `env:` block. In
staging-first form:

```yaml
      - name: Build Web App
        run: npm run build
        env:
          VITE_APP_ENV: staging
          VITE_OTP_DELIVERY: demo
          VITE_SUPABASE_URL: ${{ secrets.QA_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.QA_SUPABASE_ANON_KEY }}
```

For a *production* APK this must become `VITE_APP_ENV: production` and `VITE_OTP_DELIVERY: sms`,
with production secrets — and it cannot be done before the SMS provider exists. Also worth changing
at the same time: the trigger is `push: branches: [main]`, so every push to `main` currently produces
a release APK with no approval step.

**I recommend adding the staging form now** so the lane runs again, and leaving production for the
release phase.

### F2. Correct the environment table before Phase 2

| Environment | Project ref | Status |
|---|---|---|
| development | *(none)* | does not exist — must be created |
| staging | `bpybjrjenwccowvtrevu` | today's QA project |
| production | `gkswcfljxlutkfdvvqng` | taken from `src/lib/environmentContract.ts`, which inherited it from `envGuard.ts` |

**Please confirm `gkswcfljxlutkfdvvqng` is production and whether it holds real data.** The whole
guard depends on that name being right. If it is wrong, it is a one-line change in
`environmentContract.ts` and the tests change with it.

### F3. Vercel — nothing to change in the repo, but the dashboard is unverified

`vercel.json` in this repository contains only an SPA rewrite:

```json
{ "rewrites": [{ "source": "/(((?!assets/).*))", "destination": "/index.html" }] }
```

There is no environment configuration in the repo, and it would be wrong to put credentials there.
So the mapping below is what the dashboard **must** contain; I could not verify it from here.

| Vercel scope | Branch | Must set | Expected project |
|---|---|---|---|
| Production | `main` | `VITE_APP_ENV=production`, `VITE_OTP_DELIVERY=sms`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `gkswcfljxlutkfdvvqng` |
| Preview | `staging` | `VITE_APP_ENV=staging`, `VITE_OTP_DELIVERY=demo`, QA URL/key | `bpybjrjenwccowvtrevu` |
| Development | `develop`, `feature/*` | `VITE_APP_ENV=development`, its own project | *(to be created)* |

Please check: (a) that Preview and Development do **not** inherit the Production values, and (b) that
a Production-scoped deploy has both `VITE_APP_ENV` and `VITE_OTP_DELIVERY` set. If they are missing,
the deploy will now fail at build time rather than serve a broken environment — which is the
intended outcome, but it will look like a broken pipeline at first.

#### F3.1 Measured 2026-10-16 — what the Production scope must hold, and that the gate agrees

`vercel.json` still contains only the SPA rewrite, and the dashboard still cannot be read from this
checkout. What changed is that the requirement stopped being prose: `tests/unit/vercelDeployScopes.test.ts`
derives the required names from `.env.example` and from `src/lib/environmentContract.ts`, and puts each
scope's configuration through the same decision the build makes. The guard is non-vacuous — adding a
required name to the template, or pointing one scope at another's project, fails it.

The build was then run four times with `vite build --mode production` — the command `npm run build`
runs, which is what Vercel runs:

| Configuration given to the build | Result |
|---|---|
| nothing (today's state if the Production scope holds no variables) | **refused, exit 1** — `ENV_NAME_MISSING` |
| `VITE_APP_ENV=production`, production URL + key, **no** `VITE_OTP_DELIVERY` | **refused, exit 1** — `DEMO_OTP_IN_PRODUCTION` |
| `VITE_APP_ENV=production`, `VITE_OTP_DELIVERY=sms`, **staging** project | **refused, exit 1** — `PRODUCTION_ENV_WRONG_PROJECT` |
| the four required names, for the production project | **built, exit 0** — `[EnvGuard] building PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)` |

So the **Production** scope, on the `main` branch, must define exactly:

| Name | Value |
|---|---|
| `VITE_APP_ENV` | `production` |
| `VITE_SUPABASE_URL` | `https://gkswcfljxlutkfdvvqng.supabase.co` |
| `VITE_SUPABASE_PROJECT_ID` | `gkswcfljxlutkfdvvqng` |
| `VITE_SUPABASE_ANON_KEY` | the production project's publishable/anon key |
| `VITE_OTP_DELIVERY` | `sms` |

`VITE_APP_URL` is optional; nothing else is read. A test key was used for the successful build, in the
same shape `tests/unit/environmentSafety.test.ts` already uses — it proves the *gate and the build*
accept that configuration, and it is not a production credential.

**Two things this does not settle.** Whether the Production scope currently holds these values is
**UNKNOWN** — no Vercel credential or project link exists in this checkout, so the dashboard was not
read. And a *working* production deployment is blocked by something the variables cannot fix:
production's schema is 182 ledger entries behind this repository (`supabase/baseline/production-baseline.json`),
so the deployed app would point at a database without the tables it reads. The variables make the build
succeed; they do not make the app work.

#### F3.2 Measured 2026-10-16 (second pass) — the dashboard read, and the Production scope was wrong

**CORRECTED.** §F3.1 closed by saying the Production scope's contents were UNKNOWN, because no Vercel
credential existed in this checkout. A Vercel MCP connection made the scope readable, and it was read.
Three of the five names were wrong or missing — and five consecutive production deployments had
failed as a result.

| Name (Production scope) | What it held | What it must hold |
|---|---|---|
| `VITE_APP_ENV` | `production` ✓ | `production` |
| `VITE_OTP_DELIVERY` | `sms` ✓ | `sms` |
| `VITE_SUPABASE_URL` | `https://supabase.com/dashboard/project/bpybjrjenwccowvtrevu` — a **dashboard link**, and the **staging** ref | `https://gkswcfljxlutkfdvvqng.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | a JWT whose own `ref` claim is `bpybjrjenwccowvtrevu` — **staging's** key | the production project's publishable/anon key |
| `VITE_SUPABASE_PROJECT_ID` | **absent** | `gkswcfljxlutkfdvvqng` |

**The failure that produced.** The five most recent production deployments — `main` @ `de1a962e`,
`source: redeploy`, the newest `dpl_4kxkuW9zowAZBnA6vU2HW5BEqsmD` — are all `state: ERROR` with
`errorCode: BUILD_UTILS_SPAWN_1`, `errorMessage: Command "npm run build" exited with 1`. Rebuilding
that exact configuration locally produces the refusal, so this is the reported failure and not a
guess about it:

```
[ENVIRONMENT GATE] Refusing to build.
  PROJECT_ID_UNREADABLE
  Cannot read a Supabase project id from this build's config
  (VITE_SUPABASE_URL="https://supabase.com/dashboard/project/bpybjrjenwccowvtrevu", VITE_SUPABASE_PROJECT_ID="")
```

exit 1. The gate behaved exactly as designed; the scope is what is wrong.

**The corrected set, built — with the production project's own key**, read from that project rather
than synthesised (so this is the real credential, not a stand-in):

```
$ VITE_APP_ENV=production VITE_OTP_DELIVERY=sms VITE_SUPABASE_PROJECT_ID=gkswcfljxlutkfdvvqng \
  VITE_SUPABASE_URL=https://gkswcfljxlutkfdvvqng.supabase.co VITE_SUPABASE_ANON_KEY=<the production key> \
  npx vite build --mode production
[EnvGuard] building PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)
```

exit 0. **The write was then done, and the deploy verified.** The connected Vercel MCP is read-only —
every tool it exposes reports `readOnly: true`, and no create/update/redeploy tool exists — and the
Vercel CLI session on this machine belongs to a different account (`abakhsh56-3780`, team
`farmer-app1`) that cannot see this scope (`The specified scope does not exist`). The owner approved
signing the CLI in as `abuxkhawaja56-1850` (OAuth device flow, isolated config dir, project linked
outside the repository), after which the three values were set, read back through `vercel env pull`,
and `main` was redeployed:

| Result | Evidence |
|---|---|
| Production scope now holds all five names, with the key cross-checked to production | `vercel env pull`: `VITE_APP_ENV=production`, `VITE_OTP_DELIVERY=sms`, `VITE_SUPABASE_URL=https://gkswcfljxlutkfdvvqng.supabase.co`, `VITE_SUPABASE_PROJECT_ID=gkswcfljxlutkfdvvqng`, key `ref` = `gkswcfljxlutkfdvvqng` |
| The redeploy is green | `vercel redeploy dpl_4kxkuW9zowAZBnA6vU2HW5BEqsmD --target production` → **`✓ Ready in 26s`**, aliased `https://hisaabkitaab.dpdns.org` |
| The gate accepted it at build time | build log: `[EnvGuard] building PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)` |
| The site serves the app | `https://hisaabkitaab.dpdns.org` → HTTP 200, `<title>AgriShop</title>`, and the running app logs `[EnvGuard] PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)` |

Full record: `device-evidence/vercel-config-scheduled-cycle-and-drill-2026-10-16.md` §1.6.
`tests/unit/environmentSafety.test.ts` also encodes the refusal (`PROJECT_ID_UNREADABLE`) and its
non-vacuity, because until this pass no test fed the gate a URL it cannot read.

**One trap, reported rather than fixed.** `PROJECT_ID_UNREADABLE` fires *only* because no project id
is set. Leave the dashboard link in place and add `VITE_SUPABASE_PROJECT_ID` alone, and the gate
accepts the build — while `src/lib/supabase.ts` uses `VITE_SUPABASE_URL` verbatim, so production
would serve a client pointed at a dashboard page. Replace the URL; do not merely add the missing
name. Requiring a *usable* hosted URL for staging and production would close that hole, and it is not
done here: it changes the gate's semantics and belongs in its own reviewed pass.

### F4. GitHub Actions risks (reported only — nothing rewritten)

| Workflow | Trigger | Targets | Secrets used | Risk |
|---|---|---|---|---|
| `build-apk.yml` | `push: [main]`, manual | staging project only | `QA_SUPABASE_*`, `QA_DB_*`, Android signing | **Every push to `main` releases an APK, with no approval and no rollback step.** The release build receives no env (E). Signing secrets are correctly not readable by PRs from forks. |
| `backup-database.yml` | daily 02:00 UTC, manual | staging project | `QA_DB_*` | Titled "Production", backs up staging. No restore path exists. |

- **Can a staging workflow modify production?** No. Neither workflow references the production
  project or any production secret. There is no `PROD_*` secret in either file.
- **Can a production secret be used by staging or development?** No production secret is referenced
  by any workflow at all, so there is nothing to leak yet. When production secrets are added, give
  them `PROD_` prefixes and add them only to a job that is gated on approval — do **not** add them to
  the job-level `env:` at line 13, which currently hands the QA service-role key to every step of the
  test job, including one that deletes rows (`clean-test-data.mjs`).
- **The one real hazard:** that job-level `QA_SUPABASE_SERVICE_ROLE` plus `clean-test-data.mjs`. If
  a production URL were ever put into those `QA_*` secrets, the test job would delete production
  rows. The guard in section B prevents the *app* from doing that; it cannot prevent a workflow.

---

## G. Recommended next phase

**Phase 2 — Environment separation + database migration/deployment safety.** In order:

1. **Create the development project.** Build its schema by replaying `supabase/migrations/`, never by
   copying. Then add its ref to `DEVELOPMENT_PROJECT_ID` in `environmentContract.ts` — at which point
   the "staging must be staging" rule applies to development too, automatically.
2. **Fix the migration ledger.** 167 files, 3 recorded rows. Add a deployment script that records
   every applied file, add the replay check to CI, and normalise the two odd filenames
   (`0042b_security_rls_fix.sql`, `20260903_credit_limit_requests__reminder_groups.sql` — the latter
   sorts after `0174`).
3. **Close the server-side OTP boundary** (E, P0): disable the Email/Password provider in production
   and change `provision_member_login` so production has no phone-derived password identities.
4. **The database security fixes from the audit, in the safe order:** revoke the `anon` write grants;
   create `product_variants_public` and tighten `product_variants_select`; scope `audit_events_insert`
   to the actor's shop; scope `user_permissions_insert` to the target's shop; pin `search_path` on
   the three functions. Migrations 0175 onward, each verified with an employee login.
5. **Backups that have been restored:** retarget the workflow, write `scripts/restore-database.mjs`,
   run a drill into a scratch project and record it.
6. **Branches and gates:** create `develop` and `staging`, protect `main`, and change the APK trigger
   so a push does not release.
7. **Delete the 25 unmanaged harnesses** and lower the ratchet in `productionReachGuard.test.ts`.

Do not start Phase 2 until F2 is confirmed — every rule in Phase 1 is anchored to the project ids in
that table.

---

## Committing this work

Nothing from this phase is committed, and the tree also holds 27 modified files and 5 untracked
migrations (`0170`–`0174`) from the earlier mission. **Commit before creating any branch**: your
database is currently ahead of your repository, and a checkout could lose the schema's own source of
truth.
