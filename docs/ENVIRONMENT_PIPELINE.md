# Environment pipeline — what is enforced, and what is missing

The agreed model is four stages: **development → automated checks → staging/QA → production**, with
development data disposable, staging holding controlled test data, and production serving real
customers with no experimental changes or test data.

**Promotion is a human decision (owner's policy, 2026-10-26).** Development is the only active
workspace. A change reaches staging only with the owner's approval in that request, and production
only with approval *and* a passed staging verification. A push to GitHub runs checks and nothing
else: it does not deploy, and it does not apply a migration. `deploy-production.yml` therefore has
one trigger — a dispatch — and `tests/unit/productionDeployGate.test.ts` fails if an automatic
trigger or a `migrate.mjs apply` is reintroduced into any workflow.

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
> commit only on a manual dispatch, after that commit's CI run concluded `success` and it is still
> `main`'s head. (2) The
> backup gap is closed: nightly production backups are green and every apply starts from a
> restore-verified artifact. (3) Schema divergence and demo data are closed as measured in
> `production-closed-out-2026-10-17.md`. **Still open:** production has never been restored (a restore
> is human-approved, and the rollback point is the pre-apply backup), and there is still no
> error-reporting instrument.
>
> **Correction 2026-10-19:** the three Vercel credentials are configured as **repository secrets**
> (`VERCEL_TOKEN`, `VERCEL_PROJECTID`, `VERCEL_TEAMID` — `gh secret list`, 2026-10-17), not variables,
> and the workflow reads them under those names. They are present, so no owner action is outstanding
> for the code path; a gated deploy has already run (`39125119857`, `success`, commit `d682a6d`).
> What was missing was the *end* of the path — see "The code release, as enforced" below.

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

## The code release, as enforced (2026-10-19)

This is the whole path a web change takes today. Every step is a workflow step or a script in the
repository; nothing is "remembered" by a person.

| # | Step | What it proves | Where |
|---|---|---|---|
| 1 | Push to `main` | runs checks only — a push is never promotion (owner's policy, 2026-10-26) | — |
| 2 | `ci.yml` runs `gates` (tsc, unit guards, workflow-safety proof, targeting refusals, production build) and `qa` (ledger matches the directory, integration suites against staging) | the candidate compiles, passes its guards, and its migrations match the repository | `.github/workflows/ci.yml` |
| 3 | `deploy-production.yml` starts **only** from a `workflow_dispatch` that names the commit (`dry_run: false` to deploy); nothing starts on a push or on a CI run completing | a merge, or a green run, is evidence rather than authorization | `.github/workflows/deploy-production.yml` |
| 4 | `scripts/lib/deploy-gate.mjs` re-checks the same facts from the run itself: success, `main`, a full 40-character SHA that is **still** `main`'s head, credential + project present | a green run for a commit that has since been superseded is not permission | pure function, unit-tested |
| 5 | `scripts/deploy/trigger-production.mjs` posts a deployment for that exact commit (`gitSource.sha`), never "the branch" | Vercel builds the gated commit and nothing else | — |
| 6 | **New:** `scripts/deploy/verify-production.mjs` waits for the deployment to be READY **with its alias assigned**, then fetches `https://hisaabkitaab.dpdns.org` and requires 200 + HTML + the SPA shell + `X-Content-Type-Options: nosniff`, **and** that the entry bundle (`/assets/index-<hash>.js`) is the one the deployment's own URL serves. The reference is mandatory: an unreadable, protected, timed-out or entry-less deployment URL fails the run rather than downgrading it to page checks | "Vercel accepted it" is replaced by "production serves *this* build"; a timeout, a 200 error page, a cached page from the previous build, or a reference that cannot be read fails the run | new step in the same workflow |
| 7 | **New:** if the page is wrong after the deployment went live, the same script rolls production back to the newest earlier promoted deployment (`POST /v1/projects/{id}/rollback/{deploymentId}`, any 2xx accepted), waits for it to be live, and still exits non-zero. If the rollback endpoint refuses (its reference lists a 402 error, but Vercel does not document what causes one, so no plan rule is assumed), it redeploys that deployment as production (`POST /v13/deployments` with `deploymentId`, `name`, `project`, `target`) and waits for that. **Containment is claimed only after the production domain is observed serving the previous deployment's entry bundle**; otherwise the run reports the rollback as UNCONFIRMED | a bad release is contained, and the run never reports success for it — nor claims a rollback it did not see take effect | same script |
| 8 | `.github/workflows/build-apk.yml` builds the signed artifact from the same commit | the Android path is a separate, gated build | — |

**What it deliberately does not do.** It does not apply migrations. Production's schema moves only
through `migrate.mjs apply --env production --files <batch>` behind the four preconditions in
`PRODUCTION_MIGRATION_PLAN.md` §7(a) — a PASS verification against production's own baseline, a
backup taken minutes earlier, that backup restore-verified, and a named in-position batch. Schema and
code are therefore **decoupled**, which is safe only because every production-bound change is
expand-contract and `productionMigrationPlan` requires every pending file to carry a disposition.

**Why the entry bundle is compared (measured, not assumed).** On 2026-10-19 a request to the
production domain with a fresh random `?release=` value was answered `X-Vercel-Cache: HIT` with
`Age: 7729` and the previous build's ETag — Vercel's static cache key ignores the query string. A
query-string cache-buster therefore cannot prove freshness, and a page that is 200, HTML, has the
shell and carries `nosniff` can still be the *previous* release, which would have passed a
status-and-shell-only check and skipped the rollback. The comparison uses the deployment's own
immutable URL as the reference: production may take up to `ALIAS_WAIT_SECONDS` (120s) to start
serving that entry, and past that window it is reported as a failure. Unit tests drive both the
match and the stale case against a local fake API; the stale case was proven non-vacuous by
neutering the comparison and watching it fail.

**That reference fails closed (2026-10-20).** If the deployment's own URL answers 401/403 (Vercel
Deployment Protection), any other non-200, times out, or serves a page with no
`/assets/index-<hash>.js`, the run now fails and **no rollback is attempted**. It used to log
"the entry-bundle comparison is skipped — only the page checks apply", which a cached previous page
passes; a measurement failure must not become a pass. No rollback follows, deliberately: an
unreadable reference is not evidence that production serves the *wrong* build, and moving the
production alias without evidence is the more destructive mistake. Protection is never weakened to
make the read succeed — the job needs an approved bypass credential (for example a Vercel Automation
Bypass secret) or another approved verification path, and the script names that requirement.

The reference URL comes from the deployment's own `url` when the response carries it, else from the
`deployment_url` the trigger reports from the POST answer — `GET /v13/deployments/{idOrUrl}`
documents neither `url` nor `uid` (it documents `id`), so relying on either spelling alone would
have skipped the comparison, or reported a READY deployment as unreadable, on the first real run.
Both fields and both URL sources are covered by the same unit file.

**Rollback, precisely.**

* **Code:** the Vercel rollback above asks Vercel to point production traffic at the previous
promoted deployment, and the script waits until that deployment reports READY again. The redeploy
fallback exists because the rollback *endpoint* can refuse (its reference lists a 402 error; Vercel
does not document the cause, and **no plan restriction is assumed**), while redeploying an existing
deployment is the supported alternative — so a refusal becomes a slower rollback rather than an
unhandled failure. Rollback is only invoked when the new deployment *went live* and served the wrong
page; a failed build never moves the alias, so the previous deployment keeps serving and the script
says so.
* **Containment is measured on the domain.** A READY deployment is not proof the domain moved.
Vercel documents this for rollback: *"After a rollback, Vercel turns off auto-assignment of
production domains. This means new pushes to your production branch won't go live automatically"*
(<https://vercel.com/docs/instant-rollback>). The script therefore reads the previous deployment's
entry bundle and polls the production domain until it serves that bundle. Only then does it report
`containment verified`; otherwise it reports the rollback as **UNCONFIRMED**, and the run still
exits non-zero.
* **Operator's next step after an UNCONFIRMED rollback:** in Vercel, assign the production domain to
a known-good deployment — dashboard → the project → *Undo Rollback*, choose the deployment, confirm
(re-enables automatic production-domain assignment), or `vercel promote <deployment-id-or-url>` —
then re-run the verification step. Do not treat the rollback as containment until the domain serves
the previous `index-<hash>.js`.
* **Schema:** a restore of the pre-apply backup, which is why the apply gate refuses to run without a
restore-verified artifact from the same hour. There is no down-migration, and none is accepted.

**What is still missing from this path** (stated so it is not mistaken for complete):

1. **No schema/code ordering gate.** Because production's ledger is not readable by any automated
path (policy), the deploy cannot refuse a commit whose migrations have not been applied. The
coupling today is the expand-contract rule plus the migration plan guard, not a machine check.
2. **The verification step has not run in CI yet.** It was added on 2026-10-19 and `main` has not
moved since 2026-10-18; its behaviour is proven locally (unit tests + a live probe against
`hisaabkitaab.dpdns.org`), not by a workflow run. The next push to `main` is the first real run.
3. **No automated post-release data check.** The smoke check proves the app shell is served; it does
not sign in and read a row. Production has no error-reporting instrument, so a functional regression
that still renders is found by a user, not by the pipeline.

## What closes each gap

| # | Gap | The smallest thing that closes it |
|---|---|---|
| 1 | CI not bound to where work happens | trigger the test job on `staging-snapshot` and on pull requests (or move the line of work to `main`) |
| 2 | No signed artifact for approval | add the four `ANDROID_*` secrets, then the APK job can pass its keystore step |
| 3 | No production backup | add `PROD_DB_PASS`, then run `backup-database.yml` for production and confirm **both** the backup and its isolated restore pass |
| 4 | Lanes stale at the head | bring the QA server up and run `npm run verify:full`; the tier-2 gate then covers the current head rather than 2026-09-27's |
| 5 | Production's schema and data | decide the cleanup (policy §6) **after** a fresh backup, then reconcile production to the directory through a verified path rather than a pasted bundle |
| 6 | No release path | **closed 2026-10-19** — code: `deploy-production.yml` → trigger → wait/verify/rollback (above). Schema: `migrate.mjs apply --env production --files` behind the §7(a) gate. Remaining: no machine check that the schema is ahead of the code |
| 7 | No monitoring | pick and wire an error-reporting service for production, so a failure is seen by the team and not only by a customer |

## What this document does not verify

* The E2E lanes were **not** re-run for this pass (the QA server is down); their last green
  timestamps are quoted, not re-measured.
* Production was not connected to, read or written — by policy, and there are no credentials here.
  Everything stated about production comes from the 2026-10-01 artifact, its manifest, the ledger,
  the workflow runs and `gh secret list`.
* Whether the 52 sales and 6 customers under the demo tenant are a real shop's records is
  **unknown**, not assumed: the audit reports identity and scope separately for that reason.
