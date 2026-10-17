# Environment pipeline — what is enforced, and what is missing

The agreed model is four stages: **development → automated checks → staging/QA → production**, with
development data disposable, staging holding controlled test data, and production serving real
customers with no experimental changes or test data.

This document says, stage by stage, **what the repository actually enforces** and **where the gap
is**. Measured on 2026-10-13. Nothing here is aspirational: every "enforced" line has a command, a
file or a workflow run behind it, and every gap is stated with the evidence that shows it.

`environments.json` is the single source of truth for which project each stage belongs to, and
`scripts/lib/environments.mjs` resolves one environment or refuses — a run cannot borrow another
stage's credentials.

---

## Stage 1 — Development: **enforced**

Development is this machine's Supabase CLI stack in Docker, not a hosted project: `projectRef` is
`null`, `localProjectId` is `localdev`, and no network path reaches either hosted environment.

| Rule | Enforced by |
|---|---|
| A development build may not point at a hosted project | `src/lib/environmentContract.ts` (refuses a `*.supabase.co` URL and any resolved id that is not `localdev`) |
| A build must declare which environment it is | `vite.config.ts` gate — `VITE_APP_ENV` must be `development`, `staging` or `production`, or the build fails |
| Ordinary development will not start against nothing | `src/lib/localStackHealth.ts` — only loopback is probed, and a non-loopback URL is itself the reason |
| Local data is never a backup target | `environments.mjs` — a target with no project ref cannot be verified |

**Gap: none material.** A third hosted project for development is blocked by Supabase's free plan
(two active projects, both spent) and the local stack is the stronger answer anyway — recorded in
`environments.json`.

## Stage 2 — Automated checks: **exists, mis-wired**

`npm run verify` computes a tier (0 docs, 1 UI, 2 money/RBAC/migrations) and runs `tsc`, the unit
guards, the affected E2E lanes and the build; tier 2 is forced and never downgraded. CI's
**Run Tests** job runs unit, integration, E2E and a QA cleanup against staging.

*Measured today:* `npx tsc --noEmit` exit 0; `npx vitest run tests/unit/` **759/759**, exit 0. Last
CI confirmation: run `37076349097`, branch `staging-snapshot`, 2026-10-02 — job **Run Tests:
success** (job Build APK: failure, see stage 3).

| Gap | Evidence |
|---|---|
| **CI is bound to `main`, work happens on `staging-snapshot`** | `build-apk.yml` triggers on `push: branches: [main]`; `git rev-list --left-right --count main...staging-snapshot` = **0 behind, 20 ahead** — so the 20 commits this branch carries have run no CI |
| **The local gate's own record is stale, and it did not pass** | `ENGINEERING_OS_STATE.md` checkpoint: last verify `tier 2 · running` (2026-09-27, 362s, ran 4 of 27 lanes, crashed mid-run); the previous three tier-2 runs **failed**; last `verified` head is 2026-09-23 |
| **No general CI for branches or PRs** | `.github/workflows/` holds two files: `backup-database.yml` (schedule, read-only) and `build-apk.yml` (push to `main`, dispatch). There is no `ci.yml` |

## Stage 3 — Staging / QA: **enforced and consistent, but stale at the head**

Staging is `bpybjrjenwccowvtrevu` (`QA_*`). It is the only live environment any tool in this
repository will write to, and the migration ledger is verified against it.

*Measured today:* `npm run migrate:status` → **193 files, newest `0201`, ledger agrees exactly**
(every file recorded, every record has a file, every hash matches), exit 0. 27 E2E lanes are
recorded green (2026-09-24/27) in `ENGINEERING_OS_STATE.md`; QA cleaning is opt-in
(`QA_CLEAN_AFTER_RUN=1`) so a run does not delete the owner's test entries.

| Gap | Evidence |
|---|---|
| **The lanes have not been re-run at the current head** | last lane-green timestamps are 2026-09-24/27 (they depend on the QA server, which is down), and the tier-2 gate record is stuck `running`. Nothing since 2026-09-27 is lane-verified |
| **Owner approval has nothing to approve** | the APK job fails at **"Decode release keystore"**: `gh secret list` (2026-10-13) has **0 of 4 `ANDROID_*`** secrets; the last APK run (2026-10-02, 47m26s) failed there |

## Stage 4 — Production: **not met, and it is the deepest gap**

> **Update 2026-10-18 — three of the gaps below are closed, two remain.** (1) There *is* a release
> path now: `migrate.mjs apply --env production --files` behind the four preconditions in §7(a) of
> `PRODUCTION_MIGRATION_PLAN.md`, and a code release path that waits for CI — `vercel.json` no longer
> auto-deploys `main`, and `.github/workflows/deploy-production.yml` asks Vercel to build one exact
> commit only after that commit's CI run concluded `success` and it is still `main`'s head. (2) The
> backup gap is closed: nightly production backups are green and every apply starts from a
> restore-verified artifact. (3) Schema divergence and demo data are closed as measured in
> `production-closed-out-2026-10-17.md`. **Still open:** production has never been restored (a restore
> is human-approved, and the rollback point is the pre-apply backup), and there is still no
> error-reporting instrument. The deploy path needs one owner action before it can publish:
> `VERCEL_TOKEN` as a repository secret plus `VERCEL_PROJECT_ID`/`VERCEL_TEAM_ID` as repository
> variables — without them the workflow refuses and nothing deploys.

Production is `gkswcfljxlutkfdvvqng` (`PROD_*`, cluster fingerprint `7666007964130682852`).

**What is enforced** — production is deliberately hard to touch, and that part works:

| Rule | Enforced by |
|---|---|
| Credentials never live in the checkout | `environments.json` sets `localEnvFile: null`; `run-with-production-credentials.mjs` refuses a path inside the repository before reading a byte |
| Nothing automated may name production | `tests/unit/productionReachGuard.test.ts` |
| No tool applies migrations to production | `scripts/migrate.mjs` refuses `--env production` **exit 2, before connecting** — deliberate, and not a bug |
| The app may not run production in demo mode | `environmentContract.ts` requires `VITE_OTP_DELIVERY=sms` for production |
| Only the owner deletes records; nothing seeds test data into a new environment | `docs/PRODUCTION_DATA_POLICY.md` + rules 1–9 of `tests/unit/productionDataPolicy.test.ts` |

**The gaps, in the order they bite:**

1. **There is no release path.** Nothing in this repository applies code or schema to production —
   no workflow, no tool (`migrate.mjs` refuses it outright). The step is therefore a human in the
   Supabase SQL editor, and that is exactly how production acquired a shop called `Default Shop`.
   The tracked bundles at the repository root (`ALL_MIGRATIONS_TO_RUN.sql`,
   `COMPLETE_DATABASE_SETUP.sql`) name the production project in their own headers and carry the
   demo seed; rule 9 now freezes them and fails on a new one.
2. **Production has no working backup.** The daily workflow requires `PROD_DB_HOST`, `PROD_DB_USER`
   and `PROD_DB_PASS`; only the first two exist (`gh secret list`, 2026-10-13). It has **failed
   every scheduled run from 2026-10-03 to 2026-10-13** (11 consecutive, ~24s each — the preflight
   refusal, which is the design). The newest production artifact is **2026-10-01**, and production
   is on the free plan: no PITR, no managed backups.
3. **Production's schema is not this repository's.** Its ledger says `0016` with 8 rows against
   **193 files** in the directory (staging: 193). `SCHEMA_STRATEGY.md` measured the chain replaying
   onto production's captured schema with **71 failed statements** — real lineage divergence, not a
   broken directory.
4. **Production holds test data.** `npm run audit:production-data` exits **1**: 23 rows keyed by
   demo identities, 4 accounts on demo phone numbers, a shop named `Default Shop` and a user named
   `Test QA User`. Policy §6 sets out the owner's three options; deleting is destructive and is not
   a script's decision.
5. **"Monitor real users" has no instrument.** Nothing is wired: no error reporting, no analytics,
   no crash reporting anywhere in the app or its functions, and the only recovery point is a
   twelve-day-old logical dump.

---

## What closes each gap

| # | Gap | The smallest thing that closes it |
|---|---|---|
| 1 | CI not bound to where work happens | trigger the test job on `staging-snapshot` and on pull requests (or move the line of work to `main`) |
| 2 | No signed artifact for approval | add the four `ANDROID_*` secrets, then the APK job can pass its keystore step |
| 3 | No production backup | add `PROD_DB_PASS`, then run `backup-database.yml` for production and confirm **both** the backup and its isolated restore pass |
| 4 | Lanes stale at the head | bring the QA server up and run `npm run verify:full`; the tier-2 gate then covers the current head rather than 2026-09-27's |
| 5 | Production's schema and data | decide the cleanup (policy §6) **after** a fresh backup, then reconcile production to the directory through a verified path rather than a pasted bundle |
| 6 | No release path | the shape is already specified — verify each new file against the production baseline, then apply it under an authorized, ledger-recording path. That tool does not exist yet; until it does, releases are hand-run and this document is the record of it |
| 7 | No monitoring | pick and wire an error-reporting service for production, so a failure is seen by the team and not only by a customer |

## What this document does not verify

* The E2E lanes were **not** re-run for this pass (the QA server is down); their last green
  timestamps are quoted, not re-measured.
* Production was not connected to, read or written — by policy, and there are no credentials here.
  Everything stated about production comes from the 2026-10-01 artifact, its manifest, the ledger,
  the workflow runs and `gh secret list`.
* Whether the 52 sales and 6 customers under the demo tenant are a real shop's records is
  **unknown**, not assumed: the audit reports identity and scope separately for that reason.
