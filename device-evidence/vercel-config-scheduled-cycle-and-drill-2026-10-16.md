# Vercel configuration, the first scheduled cycle, alerting, and a real-engine recovery drill — 2026-10-16

**What this covers:** the four open items after the production-credentials pass — (1) the Vercel
Production configuration and whether a build with it succeeds, (2) the first *scheduled* backup and
watchdog cycle on `main`, (3) whether GitHub issues alone are an alert, (4) a timed recovery drill in
a production-shaped environment.

**What this does not claim.** Nothing was deployed to production; no production row was read or
written; no Vercel project was read (no credential or project link exists in this checkout). **The
4-hour RTO is NOT validated** — the drill measures the database-restore step, which is the part that
turns out to be seconds, and §4 names everything it excludes. The parallel record on
`post-merge-proof/recovery-drill` (`device-evidence/recovery-drill-2026-10-16.md`) covers the merge,
the first real alert and a PGlite drill; this file adds what that one names as missing — the
*provisioning* half of a recovery, on a real engine — and does not repeat it.

---

## 1. Vercel Production configuration — the required variables, and what the gate does with them

### 1.1 What the dashboard must hold, decided by the code rather than by a document

The contract is `src/lib/environmentContract.ts`, read by the build gate (`vite.config.ts`) and the
app (`src/lib/envGuard.ts`). For a **production** build it requires, at minimum, `VITE_APP_ENV`,
one of `VITE_SUPABASE_URL` / `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_ANON_KEY`, and
`VITE_OTP_DELIVERY=sms` (`VITE_APP_URL` is optional). `tests/unit/vercelDeployScopes.test.ts` (new,
**11 tests**) now derives the required *names* from `.env.example`'s own "required" section and puts
each Vercel scope's configuration through the same `resolveEnvironment` decision the build makes.

| Vercel scope | Branch | `VITE_APP_ENV` | Project it must name | Codes |
|---|---|---|---|---|
| Production | `main` | `production` | `gkswcfljxlutkfdvvqng` | `sms` |
| Preview | `staging` | `staging` | `bpybjrjenwccowvtrevu` | `demo` |
| Development | `develop`, `feature/*` | `development` | the local stack (`localdev`) | `demo` |

The guard is non-vacuous, proven by three injections, each of which failed the suite and each of which
was then reverted (the tree is clean): a new required name added to `.env.example`; `VITE_OTP_DELIVERY`
moved out of the required section; and the staging project ref set to production's.

### 1.2 The build Vercel runs, with each configuration — measured, not reasoned

`vite build --mode production` is what `npm run build` runs and what Vercel runs. There is no
`.env.production` in this checkout, so — exactly as on Vercel — the process environment is the only
source of these values.

| Configuration given to the build | Exit | Gate's verdict |
|---|---|---|
| nothing (`VITE_APP_ENV=` … all five empty) | **1** | `[ENVIRONMENT GATE] Refusing to build` — `ENV_NAME_MISSING` |
| `VITE_APP_ENV=production`, production URL + key, **no** `VITE_OTP_DELIVERY` | **1** | `DEMO_OTP_IN_PRODUCTION` |
| `VITE_APP_ENV=production`, `VITE_OTP_DELIVERY=sms`, **staging** project | **1** | `PRODUCTION_ENV_WRONG_PROJECT` |
| `VITE_APP_ENV=production`, production URL, `VITE_SUPABASE_PROJECT_ID`, key, `VITE_OTP_DELIVERY=sms` | **0** | `[EnvGuard] building PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)` |

The successful run produced a real bundle (an artifact directory with `index.html` and `assets/`) in a
temporary directory, which was then deleted — no production artifact was made, kept, or shipped, and
the key used was a synthetic one in the same shape `tests/unit/environmentSafety.test.ts` already
uses. What the run proves is that **the gate and the build accept exactly this variable set and refuse
everything else**, before an artifact exists.

### 1.3 The honest status of item 1

| Question | Answer |
|---|---|
| Are the required variables known, exactly? | **Yes** — §1.1, machine-checked, with the copy-paste values in `PHASE_1_PRODUCTION_SAFETY_GATES.md` §F3.1 |
| Does a build with them succeed? | **Yes** — exit 0, measured above |
| Does a build without them fail instead of shipping? | **Yes** — three of the four runs above |
| Is the Vercel **dashboard** configured that way today? | **UNKNOWN.** No Vercel CLI, `.vercel` link, or `VERCEL_*` credential exists in this checkout, and the MCP tool registry for this session exposes only `supabase`. The dashboard was not read, so this file does not claim it is fixed. |
| Would a correctly-configured production deploy now work? | **No** — and not because of the variables. Production's schema is 182 ledger entries behind (`supabase/baseline/production-baseline.json`: ledger `{count: 8, latest: "0016"}` vs 198 files), so the deployed app would point at a database without the tables it reads. That is the §D schema decision, unchanged by this work. |

---

## 2. The first scheduled cycle on `main`

### 2.1 What is already proven, and what the scheduled cycle adds

The corrected workflow's steps run correctly on `main` — dispatch `38831480604` (2026-10-16T00:47:23Z)
is green end to end and stored artefacts `database-backup-production-37`. The merge (`de1a962e`,
PR #1, 00:45:48Z) is what puts the fix in front of the **cron**. So the first scheduled cycle to run
against the fix is the **02:00 UTC** backup of 2026-10-16, judged by the **04:40 UTC** watchdog — the
one thing the post-merge record lists as still outstanding ("the scheduled 02:00 UTC run on `main`
still took the pre-fix workflow").

| Fact | Evidence |
|---|---|
| The cron was late: at 02:10 UTC the 02:00 run had not appeared | `gh run list --workflow=backup-database.yml --event schedule` showed only `38696121562` (2026-10-15T07:02:29Z, the pre-fix run, `failure` at the credentials preflight) |
| The previous scheduled run failed **by design preparation**, before the fix | `38696121562` — the missing `PROD_DB_PASS` preflight; the credential was set 2026-10-15T23:54Z |
| `main` now has production credentials | preflight passes in dispatch runs on `main` (above) |

### 2.2 The watchdog's own code path, run against the live API

Rather than only wait for the 04:40 job, the watcher's exact decision code was executed against the
Actions API with `--dry-run` (which decides and prints; it touches no issue and no repository):

```
$ GITHUB_REPOSITORY=abakhsh565/Agri-shop-App node scripts/check-backup-health.mjs --dry-run --json /tmp/watchdog-now.json
{ "checkedAt": "2026-10-16T02:07:47.818Z", "thresholds": { "rpoHours": 24, "slackHours": 3, "thresholdHours": 27 },
  "completedRuns": 3, "inFlightRuns": 0, "simulated": false,
  "state": "ok", "healthy": true,
  "run": { "id": 38831480604, "run_number": 37, "event": "workflow_dispatch", "conclusion": "success", "head_branch": "main" },
  "artefactCount": 1, "ageHours": 1.34,
  "summary": "Verified backup 1.3 h old with 1 live artefact(s), within the 24 h RPO.",
  "responsible": null, "alert": { "action": "none (healthy)", "issue": null } }
exit 0
```

That is the scheduled job's logic, on the live record, at the live clock: healthy, from `main`, with a
live artefact. The alert half of the cycle is already demonstrated with real conditions rather than a
simulation — watchdog run `38831384562` found `state: red` (newest completed run `38826369696`,
`failure`), **opened issue #2**, and run `38831620800` then found `state: ok` and closed it. That is
recorded in `device-evidence/recovery-drill-2026-10-16.md` §2 and is not repeated here.

**Status of item 2, stated precisely:** the pipeline is verified on `main` and the watchdog's decision
is verified against the live API; the **cron-triggered** pair (02:00 backup, 04:40 watchdog) had not
fired at 02:10 UTC when this was written. Confirming it is one command at any later time:

```bash
gh run list --workflow=backup-database.yml --event schedule --limit 1   # expect: schedule, success
gh run list --workflow=backup-watchdog.yml --event schedule --limit 1   # expect: schedule, success
```

---

## 3. Are GitHub issues enough of an alert? No — so the alert now names a person

### 3.1 The facts this decision rests on (GitHub's own documentation, quoted in §7)

* Notifications for a **scheduled workflow run** go to *the user who created the workflow*; if the
  cron syntax is later changed, they go to that user instead. There is no documented "the repository
  owner is emailed" rule.
* There is a user-level setting for failed runs (*Settings → Notifications → System → Actions*,
  "Only notify for failed workflows", with On GitHub and Email channels). Its **default is not
  documented** — so it cannot be assumed on.
* A new **issue** notifies the repository's watchers only if what they watch includes Issues (or all
  activity), and delivery still depends on that person having email/inbox notifications on.
* Being **@mentioned** gives a person the `mention` notification reason and subscribes them to the
  conversation. No documented restriction exists for a mention in an issue created with
  `GITHUB_TOKEN`.

### 3.2 Decision

Issue-only alerting is **a durable record, not a delivery**: it reaches a human only if that human
already watches Issues and has notifications on, and nothing in the repository could tell the
difference. So the alert now **addresses a person**, using the one delivery mechanism GitHub itself
documents:

| Change | Where |
|---|---|
| The issue body mentions the responsible handle, and the report/run summary record who was addressed | `scripts/check-backup-health.mjs` (`normalizeResponsible`, `alertBody`, `main`) |
| With no handle configured, the issue and the summary say *"No responsible person is named for this alert"* — an alert with no recipient is not allowed to look like one | same |
| The handle is supplied from the **repository variable** `BACKUP_ALERT_RESPONSIBLE` (not a secret: a handle is public, and the operator must be able to read back who is addressed) | `.github/workflows/backup-watchdog.yml` |
| Four new guard tests: the mention is written plainly enough to be parsed, the absence is stated, a malformed handle is refused rather than pasted in, and the workflow uses `vars.` not `secrets.` | `tests/unit/backupHealthWatchdog.test.ts` (**29 tests**, `0`→ passing) |

`normalizeResponsible` refuses `''`, `'   '`, `'@'`, `'@@owner'`, `'two words'`, `'owner!'` and a
41-character string, and accepts `owner`, `@owner`, `a-b-c` — asserted, so "anything becomes a
mention" cannot pass.

### 3.3 What remains, and why it is not mine to set

Two settings decide whether the issue actually reaches a person, and both are **user-level**, not
repository-level: the responsible person's email/inbox notification settings, and — for a failed
*scheduled* run — the Actions notification setting on the workflow's creator. They are recorded in
`docs/RECOVERY.md` §9 as required configurations rather than asserted as done.

A push channel (chat/SMS) would need a destination and a secret, and there is no such integration
connected to this workspace. The issue plus the mention is the strongest delivery this repository can
configure on its own, and it now names who is expected to act. **So: item 3 is answered — issue-only
was insufficient; a named recipient is configured; the residual risk is the two user-level settings
above, which no commit can turn on.**

---

## 4. A real-engine recovery drill, and what the 4-hour RTO still is not

### 4.1 Why this is not the PGlite drill again

`restore-verify` replays into in-process Postgres and compares against live production: a correctness
proof, and the parallel record's drill timed it at 30.0 s. It explicitly names what it could not do —
*"provisioning the recovery target, its credentials and network access, and repointing the app"*. This
drill starts there: it **provisions a database** on the local Supabase CLI stack — the real engine,
**Postgres 17.6**, production's own server version — gives it the platform's `auth`/`storage`/
`extensions` schemas, installs `pgcrypto`/`pg_trgm` where a hosted project keeps them, and then
applies the production artefact **whole, including its 249 rows**, because a row-less restore is the
fast half of the problem. New tool: `scripts/dev/rehearse-restore-local-engine.mjs`
(`npm run rehearse:restore`).

### 4.2 Measured

Source: `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-15T23-57-01.sql` (333,989 bytes,
sha256 `ceb62aa9…` re-measured and matched against its manifest before anything ran).

| Phase | Measured | What it did |
|---|---|---|
| Provision | **4.5 s** | create database, copy platform schemas schema-only, install the extensions |
| Restore | **3.3 s** | **769 statements** — 520 schema, **249 data** — one `psql` invocation over the whole file |
| Verify | **19.1 s** | structure counts + per-table row counts + auth rows, against the manifest |
| **Total** | **26.9 s** | artefact on disk → verified database |
| SQL errors | **0** | the artefact's documented `functions-pre-tables` phase produced no error on this engine |

Verification, from the drill's own report (`backups/restore-drill-production-2026-10-16.json`) —
`status: PASS`:

| Check | Result |
|---|---|
| Structure vs manifest | **0 deltas** — 28 tables, 37 functions, 2 views (by name), 47 non-constraint indexes, 56 FKs, 9 checks, 9 uniques, 10 triggers, 104 policies, 8 enums |
| Rows vs manifest | **0 deltas** across all 30 dumped tables (249 rows) |
| Auth | `auth.users` **2**, `auth.identities` **2** — a restored database that can be signed into |
| RLS | **28/28** public tables |
| Grants | **0/28** readable by `authenticated` *here*, against **60** in the stack's own database |

The last row is an **environment difference, not a defect**: the dump excludes grants and ownership by
design (its own manifest says so), and this scratch database was given the platform's *schemas* but not
its *default privileges*. A hosted target supplies them for objects the `postgres` role creates. It is
recorded as a thing to measure on the target, which is exactly the kind of gap this drill exists to
find.

### 4.3 The drill is not vacuous — its refusals and its FAIL path were measured too

| Injected condition | Result |
|---|---|
| Manifest's `sha256` altered | **REFUSED**, exit 2 — the artifact hash is re-measured before anything is created |
| Target database named `rehearsal_production` | **REFUSED**, exit 2 — a drill loads rows and may only write to `drill_*` |
| Hosted credentials present in the environment (`PROD_DB_PASS`) | **REFUSED**, exit 2 — it cannot be pointed at a hosted project |
| Manifest outside `backups/` | **REFUSED**, exit 2 |
| One row count overstated by 1 in the manifest | **FAIL**, exit 1, naming `public.companies: manifest 5, restored 4` — and `0` structure deltas, so the failure is attributed correctly |

Two defects in the drill's own first implementation were found and fixed by using it, and are recorded
because they are the class of error this repository catalogues: counting constraint-backed indexes
(reported 84 restored against 47 — exactly the 28 primary keys and 9 unique constraints the backup
tool excludes), and installing `pgcrypto` into `public` (reported 104 public functions against 37 —
the extension's own 67). Both produced false FAILs; neither was a real restore defect.

### 4.4 What the RTO still is, after this

| Component of "4 hours from the decision to restore" | Measured? |
|---|---|
| Fetch the artefact and verify its digest | **Yes** — 3.6 s + 3.1 s (parallel record) |
| Replay + verify faithfully | **Yes** — 769 statements, 1.08 s (parallel record), 0 failures |
| **Provision a production-shaped database and load every row into it** | **Yes** — 26.9 s here, on Postgres 17.6 with the platform schemas |
| Creating the hosted Supabase project, its credentials and network access | **No** — not reproducible from this machine, and standing up a second home for production data is the owner's decision |
| Grants / ownership on the target, storage objects, extensions and role passwords | **Not exercised** — excluded from the dump by design; the 0/28-vs-60 figure above says measure it on the target |
| Repointing the application: Vercel environment variables, the Android build, DNS | **No** |
| Human decision time and the `docs/RECOVERY.md` §5 approval checklist | **No** — inherently not mechanical |

So the mechanical database path is **seconds, measured twice by two different methods on two different
engines**, and the 4-hour objective is dominated by the items above, none of which this drill touched.
**The figure is not validated, and no restore has been performed into any hosted target.**

---

## 5. Reproducing all of it

```bash
# item 1 — the deploy contract, and a build with the required set
npx vitest run tests/unit/vercelDeployScopes.test.ts
VITE_APP_ENV=production VITE_SUPABASE_URL=https://gkswcfljxlutkfdvvqng.supabase.co \
  VITE_SUPABASE_PROJECT_ID=gkswcfljxlutkfdvvqng VITE_SUPABASE_ANON_KEY=<key> VITE_OTP_DELIVERY=sms \
  npx vite build --mode production --outDir /tmp/gate-check --emptyOutDir

# item 2 — the scheduled cycle, when it lands
gh run list --workflow=backup-database.yml --event schedule --limit 1
gh run list --workflow=backup-watchdog.yml --event schedule --limit 1
GITHUB_REPOSITORY=<owner>/<repo> node scripts/check-backup-health.mjs --dry-run

# item 3 — the alert's recipient
npx vitest run tests/unit/backupHealthWatchdog.test.ts

# item 4 — the drill (drop the database afterwards unless --keep)
npm run rehearse:restore -- --manifest backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-15T23-57-01.manifest.json \
  --json backups/restore-drill-production-2026-10-16.json
```

## 6. Files changed

New: `scripts/dev/rehearse-restore-local-engine.mjs`, `tests/unit/vercelDeployScopes.test.ts`, this file.
Extended: `scripts/check-backup-health.mjs` (responsible recipient), `.github/workflows/backup-watchdog.yml`,
`tests/unit/backupHealthWatchdog.test.ts` (+4 tests), `package.json` (`rehearse:restore`),
`PHASE_1_PRODUCTION_SAFETY_GATES.md` §F3.1, `docs/RECOVERY.md` §9.

Gates: `npx tsc --noEmit` **0** · `npx vitest run tests/unit` **72 files, 913 tests, exit 0**.

## 7. Sources for §3.1

* Notifications for workflow runs (scheduled-run recipient) — <https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs>
* Managing GitHub Actions notifications (the failed-workflow setting) — <https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications>
* Configuring notifications (watching, Issues, delivery) — <https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications>
* About notifications (mentions, subscription reasons) — <https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications>
* GITHUB_TOKEN (no documented mention restriction) — <https://docs.github.com/en/actions/concepts/security/github_token>
