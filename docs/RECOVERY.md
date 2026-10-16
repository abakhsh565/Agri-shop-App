# Backup & Recovery Procedures

> **This file previously described a system that did not exist.** It documented a `SUPABASE_DB_URL`
> secret, an `npx supabase db dump` step and a `pg_restore --if-exists` verification. None of those
> were ever implemented. The workflow it described was titled "Backup Production Database" and
> backed up QA. Its claims are corrected below, and the reasons are recorded so they are not
> rebuilt.

## 1. Status — read this first

| Item | Status | Evidence |
|---|---|---|
| Supabase managed daily backups | ❌ **Not available** | Organisation plan is `free`; Supabase backs up Pro/Team/Enterprise only |
| Downloadable backups | ❌ **Not available** | Supabase: "Database backups are not available for download for Free Plan projects" |
| Point-in-time recovery | ❌ **Not available** | PITR is a Pro add-on (~$100/mo for 7 days) |
| Off-site logical backup tooling | ✅ **Implemented** | `scripts/backup-database.mjs`, `scripts/lib/environments.mjs` |
| Restore verification tooling | ✅ **Implemented** | `scripts/restore-verify.mjs` |
| Backup of the **staging** (QA) project | ✅ **Taken and restore-verified** | see `PHASE_2A_BACKUP_RESTORE.md` |
| Backup of the **production** project | 🚫 **NOT POSSIBLE TODAY** | no `PROD_DB_*` credentials exist anywhere in the repository or its secrets |
| Production restore | ⛔ **Never performed, and must not be** | a destructive restore is a human-approved operation |

**Production currently has no verified recovery path.** That is the plain fact, not a gap in
documentation. Until the credentials in §7 are configured and the workflow runs green, no change to
production schema or data is permitted — the rule that made this phase necessary:

> **NO VERIFIED BACKUP + RESTORE = NO PRODUCTION DATABASE CHANGES.**

## 2. What was actually wrong (so it is not rebuilt)

1. `.github/workflows/backup-database.yml` was named **"Backup Production Database"**, ran daily,
   and passed **`QA_DB_*`**. Its artefacts were QA dumps stamped `-- Environment: QA`. Every run was
   green. Nothing checked that the database reached was the database named.
2. `scripts/backup-database.mjs` hardcoded `QA_DB_*`, and **silently skipped any table with more
   than 1000 rows** — precisely the tables most likely to matter.
3. It never dumped the `auth` schema, so a "restored" database had **no users and no logins at all**.
4. **No restore script existed anywhere in the repository.** A restore had never been executed, so
   nothing in the project had ever tested the recovery path it claimed to have.
5. This document described all of the above as implemented and verified.

The motivating lesson: *a workflow's name is not a check, and a backup that has never been restored
is a hypothesis.*

## 3. The single source of truth

`environments.json` (repository root) is the one place that maps an environment to a Supabase
project. The app's build gate, the audit script, the backup tool, and the restore verifier all read
it. Changing a project ref there changes it everywhere.

| Environment | Project ref | Credentials prefix | Local credential file | Cluster fingerprint |
|---|---|---|---|---|
| `development` | *none* (does not exist) | `DEV` | — | — |
| `staging` (a.k.a. QA) | `bpybjrjenwccowvtrevu` | `QA` | `.env.qa` (gitignored) | `7678069749886157684` |
| `production` | `gkswcfljxlutkfdvvqng` | `PROD` | `~/.agrishop/production.env` (outside the repo) | `7666007964130682852` |

A project ref is **not** a secret (it is in every Supabase URL). Credentials are **never** stored in
this file, and production has no credential file *inside the repository*: `PROD_DB_HOST/USER/PASS`
come from the process environment — in CI from repository secrets, and locally from
`~/.agrishop/production.env` (outside the checkout, injected into a single allow-listed child by
`scripts/run-with-production-credentials.mjs`). The production cluster fingerprint was enrolled on
2026-10-01, from the manifest of the first verified backup run.

### Why the fingerprint matters

Supabase's pooler authenticates the client as `postgres.<project-ref>` and then rewrites the session
role: a live connection reports `current_user = 'postgres'` with no ref in it, and
`current_setting('supabase.project_ref')` returns NULL (measured on this project, 2026-10-01). So the
server cannot be asked which project it is. The project is therefore taken from **the credential we
authenticated with**, and corroborated by `pg_control_system().system_identifier` — a value the
pooler cannot rewrite — which is compared against the one enrolled in `environments.json`.

### Which migrations are applied here — the ledger

`supabase_migrations.schema_migrations` is the database's own record of what has been applied to
it, and `scripts/migrate.mjs` is now the only path that writes it:

```bash
node scripts/migrate.mjs status --env staging          # directory vs ledger, read-only
node scripts/migrate.mjs verify --env staging          # the same check as an exit code (CI runs this)
node scripts/migrate.mjs apply  --env staging --apply  # apply pending files; each file is recorded in the same transaction
```

Every recorded file carries its sha256, so a migration that is edited *after* it was applied is
reported as `changed after it was applied` instead of being silently trusted. The directory grammar
is enforced — one canonical `<4 digits>_<name>.sql` per version — and the runner refuses to apply a
file numbered before the newest recorded version, because that rewrites history.

Nothing in this tool reads or writes production, and history is never replayed anywhere: the decided
strategy (`SCHEMA_STRATEGY.md`) is a **frozen baseline per environment plus forward-only files**,
each verified against the target's baseline in PGlite before it is applied anywhere:

```bash
npm run verify:baseline -- --baseline production --since 0178   # check a file against the frozen schema
npm run verify:baseline -- --baseline staging    --since 0178
```

Production's baseline is recorded in `supabase/baseline/production-baseline.json`; its own ledger
(8 rows, latest `0016`) is left exactly as the server has it, because replaying this directory onto
production is measured to fail (30/169 files) and rewriting that history would be a fiction. **Staging's ledger today:** 169 files,
`0009` → `0177` — 167 adopted on 2026-10-01 and two (`0176`, `0177`) applied through the runner
itself (`PHASE_2_MIGRATION_LEDGER.md`). One of them (`0176`) carries a `reconcile_note`: it was
edited comment-only after it was applied, and the ledger records that fact rather than hiding it.
The retired filenames
`0042b_security_rls_fix.sql` and `20260903_credit_limit_requests__reminder_groups.sql` are gone:
the first was merged into `0042`, the second renumbered to `0060`.

## 4. Taking a backup

The environment must be named. **There is no default**, because a default is how the original bug
happened.

```bash
# Staging (credentials come from .env.qa)
node scripts/backup-database.mjs --env staging

# Production, locally — the credentials live in a file OUTSIDE the repository and are validated and
# injected into exactly one child process (see §7 step 2). Do NOT `export` them in a shared shell:
# that puts the value in the shell's history file and in every later process of that shell.
npm run creds:production -- --check
npm run creds:production -- -- node scripts/backup-database.mjs --env production
```

Both write two files to `backups/` (**gitignored** — they contain personal data and password hashes):

| File | Contents |
|---|---|
| `backup-<env>-<projectRef>-<timestamp>.sql` | the dump: pre-data, data, post-data |
| `backup-<env>-<projectRef>-<timestamp>.manifest.json` | environment, project, timestamp, cluster, per-table row counts, structure counts, byte size, sha256, and an explicit list of what the dump does **not** cover |

| Field the procedure must identify | Where it comes from |
|---|---|
| Source environment | `--env`, recorded in the manifest and the file header |
| Source Supabase project | the ref named by the credentials, verified against `environments.json` |
| Backup timestamp | `generatedAt` in the manifest, and the filename |
| Schema/data scope | `structure` + `tableCounts` in the manifest; `public` and `auth` schemas |
| Backup artefact | the `.sql` file, with its sha256 |
| Retention | see §6 — GitHub artefacts 30 days by default; local copies are yours to manage |
| Restore target | §5. Verification restores into in-process Postgres; a real restore is human-approved |
| Verification method | `scripts/restore-verify.mjs`; run it every time, including in CI |

## 5. Verifying a backup — mandatory, and automatic in CI

```bash
node scripts/restore-verify.mjs --from backups/<artifact>.manifest.json \
  --compare-with staging --json backups/restore-report-staging.json
```

This replays the artefact, statement by statement, into a **throwaway Postgres running inside the
verification process**, then compares it with the live source:

* **integrity** — the file still hashes to the manifest's sha256 and is not a byte shorter;
* **replay** — every statement is applied individually; failures are reported with the statement
  that caused them (a pass marked `functions-pre-tables` is the one documented exception, and is
  re-applied later in the same file);
* **counts** — restored rows == rows recorded at backup time, with any change in the source since
  reported separately, because a backup is a point in time;
* **structure** — tables, columns, constraints, indexes, policies, triggers, functions, views, RLS
  flags and enum labels, all compared against the live source;
* **row digests** — where the source has not changed, a row-level digest proves the **same rows**
  arrived, not merely the same number of them.

`--target` accepts exactly one value: `pglite`. There is no code path that restores into a Supabase
project — a restore aimed at production or staging is refused by name, by project ref, and as a
connection string.

### A real restore (human-approved, never automated)

The artefact is a **logical** dump, so a real recovery is a two-step operation:

1. **Schema** — replay the migrations (`supabase/migrations/`) against the target, which reproduces
   tables, policies and functions as reviewed and versioned. `node scripts/migrate.mjs status
   --env <target>` says what that target already has, from its own ledger, before anything is
   replayed into it.
2. **Data** — apply the artefact, which supplies every row plus functions, views and policies.

`scripts/restore-verify.mjs` proves step 2 replays cleanly and faithfully. It does **not** prove a
destructive restore against a live project, and no such restore has been performed. Any production
restore requires the approval checklist below and is expected to be performed against a **new**
project first, then cut over — never by overwriting production in place.

**Approval checklist:** project owner notified · reason documented · artefact identified and hash
verified · expected data loss calculated · downtime communicated · rollback plan exists · the
artefact has been restore-verified into a throwaway target immediately beforehand.

## 6. Retention, and why the copy on disk is not the copy that matters

* GitHub Actions artefacts: `retention-days` — **agreed policy: 30 days** (§9), which is also the
  workflow's default. The input accepts 1–90, so any other value is a deliberate policy change rather
  than a tweak. The artefact and its verification report are uploaded together, which gives **at least
  30 daily recovery points** and lets personal data leave GitHub after 30 days.
* `backups/` on a developer machine is gitignored and is **not** a backup strategy.
* The Free plan deletes nothing for you: there is no managed copy to fall back on. Keep at least one
  copy somewhere other than the machine that produced it.
* Recommended: verify the most recent artefact monthly by running `restore-verify` against it. An
  unverified artefact is a guess.

## 7. To give production a recovery path (the outstanding work)

### Step 1 — the corrected workflow must be on `main` first  ✅ done 2026-10-01

**Status: complete.** The corrected workflow is on `main` as commit `de13eb1d`, and the file on
GitHub is byte-identical to the one in this checkout (verified by blob SHA, not by reading the
push output). `gh workflow list` shows it as `Backup Database (to the environment it names)`.

The commands below are kept because this is the prerequisite that is easiest to miss: everything
else can be done without it, and nothing appears to go wrong — the old file just keeps being the one
that runs. Re-run them after any change to the workflow:

```bash
git status --porcelain .github/workflows/backup-database.yml   # must print nothing
git log --oneline -1 -- .github/workflows/backup-database.yml
gh workflow list                                               # name must be the corrected one
```

Until the rewrite is committed and pushed, GitHub will keep executing the old file — whose job
environment passes only `QA_DB_*` — so a run with `environment = production` would fail rather than
back up the wrong database, and a scheduled run keeps producing nothing. See §11 for what that has
actually looked like. **Do not add the credentials before this step**: credentials plus the old
workflow is how a mislabelled artefact gets produced.

**A further correction, 2026-10-16 — and this section's own rule applies to it.** The rewrite fixed the
*target*; a second defect then discarded the *artefact*: the Summary step read the manifest with
`require()` on a relative path (`MODULE_NOT_FOUND`), and because that step is ordered before the upload,
a verified production backup was thrown away (run `38826369696` — preflight, backup, restore-verify and
artefact-confirmation all ✓, *Upload* skipped). The fix is committed as **`92a8802a`** on
`ci-proof/full-tree` and sits in **PR #1 → `main`**, **not yet merged** — so `main` does not have it yet.
After it is merged, re-run the three commands above (they exist precisely so this cannot be missed) and
dispatch the workflow once to produce the first green run **with** an uploaded artefact.

**That green run has already happened, without the merge.** `workflow_dispatch` runs the file from the
ref it is given, so `gh workflow run backup-database.yml --ref ci-proof/full-tree` executed the corrected
workflow: run **`38828524870`**, every step ✓, artefact **uploaded** — `database-backup-production-36`,
53,237 bytes, expires 2026-11-15 (the agreed 30 days). The merge is therefore needed only so the
`main`-based **scheduled** run and future dispatches use the fix; coverage itself no longer waits on it.

### Step 2 — add the credentials  ✅ done 2026-10-16

**Status 2026-10-16:** both routes are configured. Route A's file (`~/.agrishop/production.env`) passes
the intake check — `npm run creds:production -- --check` → *3 keys loaded, PROD_DB_USER names production
(gkswcfljxlutkfdvvqng)* — and Route B is complete: `PROD_DB_HOST`, `PROD_DB_USER` and **`PROD_DB_PASS`**
are all set as repository secrets (2026-10-15T23:54Z), which is what turned the CI preflight from red to
green. What remains is Step 1's merge and the uploaded artefact (§11).

All three values come from the Supabase dashboard for the production project (Settings → Database →
Connection string / Connection pooling). The host is the pooler host; the user is
`postgres.<project-ref>`, **not** a bare `postgres`. There are two routes, and only the second needs
GitHub.

**Route A — local (free, no runner, works today; this is the route Phase 2A needs).** The value is
written once into a file that must live **outside this repository**, then injected into exactly one
allow-listed child process:

```bash
npm run creds:production -- --init      # ~/.agrishop/production.env — HOST and USER prefilled, PASS empty
#   ← fill in that one line, from the dashboard. Not into chat, not into a tracked file.
npm run creds:production -- --check     # validates the file; opens no connection
```

The location rule is enforced before the file is read, so "not committed" is structural rather than
an ignore rule: a path that resolves inside the repository is refused even if it does not exist. The
file is deliberately not `.env.production.local`, which Vite loads during a production build. The
wrapper refuses a QA identity behind a `PROD_` prefix, a bare `postgres` user, a missing or empty
password, and any command other than `backup-database.mjs` and `restore-verify.mjs`; it never prints
the value. `npm run verify:credentials` proves all of it (23 checks) with a fresh canary per run.

**Route B — GitHub repository secrets**, for the CI path, through the authenticated `gh` CLI (`gh` is
logged in with the `repo` and `workflow` scopes). Encrypted at rest by GitHub, write-only from any
client, masked in logs. Kept working for when Actions can run — see the billing caveat in step 3.

```bash
gh secret list                    # names and timestamps only; never prints a value

# No --body on purpose: gh prompts, and the value goes straight to the API. It never enters your
# shell history, a file in the checkout, a log, or a transcript.
gh secret set PROD_DB_HOST        # aws-0-<region>.pooler.supabase.com
gh secret set PROD_DB_USER        # postgres.gkswcfljxlutkfdvvqng   (exactly this)
gh secret set PROD_DB_PASS        # the database password

gh secret list                    # confirm the three names now appear
```

**Never** put these values in source, a committed `.env`, a report, a chat message, or an artefact.
The backup tooling reads them from the process environment only, and production has no env file by
configuration — `scripts/lib/environments.mjs` will not read one. Route A is the sanctioned way to
fill that environment locally without an `export`: the file is outside the checkout, is read by the
intake wrapper alone, and is refused outright if it resolves inside the repository.

3. Run the **"Backup Database (to the environment it names)"** workflow with `environment =
   production`, or run the command in §4 locally.

   ```bash
   gh workflow run "Backup Database (to the environment it names)" \
     -f environment=production -f reason="first verified production backup"
   gh run list --workflow backup-database.yml --limit 1
   ```

   **Caveat as of 2026-10-01:** GitHub Actions cannot start any job in this repository until the
   account billing block is cleared (§11). Until then, `gh workflow run` will produce a run that
   fails in ~2 seconds with zero steps, and the message will be about payments rather than about
   credentials. The equivalent local command takes the same backup through the same code, so the
   first verified production backup does not have to wait for billing:

   ```bash
   npm run creds:production -- -- node scripts/backup-database.mjs --env production
   npm run creds:production -- -- node scripts/restore-verify.mjs \
     --from backups/<the new manifest> --compare-with production
   ```
4. The run takes the dump, restore-verifies it, and only then uploads it — a failed verification
   means no artefact is accepted and the run is red.
5. Enrol the production `clusterId` into `environments.json` from that first manifest, so later runs
   can detect a cluster swap.
6. Walk the approval checklist in §5 against the resulting artefact, and record the result.

Until step 3 has completed successfully, the gate in §1 stands.

## 8. Failure behaviour (all four are required, and all four are tested)

| Situation | Behaviour |
|---|---|
| No `--env` given | exit 2, usage printed. There is no default |
| `--env development` | exit 2 — no project ref recorded, so the target cannot be verified |
| Production backup with no `PROD_DB_*` | exit 2, names the missing variables, and does **not** fall back to `QA_*` |
| QA credentials under the `PROD_` prefix | exit 2 **before any connection is opened**, naming both projects |
| Production credentials under the `QA_` prefix | exit 2, same check in the other direction |
| Restore aimed at production/staging | exit 2, refused before the artefact is even read |
| Credential that names no project | exit 2 — an unverifiable target is not a target |
| Cluster fingerprint mismatch | exit 1, and no artefact is written |

| Credential file that resolves inside the repository | exit 2 **before the file is read**, even when the path does not exist |
| `PROD_DB_PASS` empty (an unfilled template) | exit 2, names the missing key, points at the dashboard |
| An intake command that is not `backup-database.mjs` / `restore-verify.mjs` | exit 2 — the intake wrapper is not a general credential launcher |

These are asserted by `tests/unit/backupTargeting.test.ts` (**24 tests**, each refusal paired with the
correct configuration that must be accepted, so the refusals cannot pass vacuously; the same file also
asserts the §9 objectives against this workflow, and was proven able to fail by changing the cron and
by changing §9's RPO figure) and, at the
process boundary, by `npm run verify:targeting` (8 CLI cases) and `npm run verify:credentials`
(23 checks, including a mutation injection that deletes the identity check and watches the wrong
project become acceptable — so the check is known to be load-bearing rather than decorative).

## 9. Recovery objectives — agreed 2026-10-16

These are **agreed figures**, each with the thing that would break it named beside it. They replace the
2026-10-01 line *"Production RPO: Unbounded — no backup can be taken today"*, which was true when it
was written and is false now.

| Metric | Agreed | What it means, and what breaks it |
|---|---|---|
| Production RPO | **24 hours** | The scheduled run is daily at 02:00 UTC (07:00 PKT, before the trading day), so the worst case is the transactions since that run. **Conditional:** a failed or missing run means the RPO is *exceeded* until a manual dispatch succeeds — the workflow's failure notice exists for exactly that, and dispatching is the repair, and the **Backup Watchdog** below turns it into an issue within one period rather than waiting to be noticed. |
| Staging RPO | Last successful **manual** run | Staging is deliberately not scheduled; its RPO is whatever the operator last took. |
| Production RTO | **4 hours from the decision to restore** (database) | The objective. **The mechanical path is now measured, not estimated:** a timed drill on 2026-10-16 went from the artefact stored on GitHub to a full `PASS` in **30.0 s** — fetch `3.6 s` + independent digest check `3.1 s` + replay and live comparison `23.2 s` (769 statements, 1.08 s of it the replay itself), at 30 tables · 249 rows · a 334 KB dump. See `device-evidence/recovery-drill-2026-10-16.md`. **What the 4 hours still covers, because the drill did not exercise it:** provisioning the recovery target, its credentials and network access, and repointing the app — the repository refuses a Supabase restore destination by design, so the isolated target was PGlite, and standing up a second home for production data is the owner's decision. |
| Time to *notice* an outage, a bad run or a silent one | **≤ 27 hours** (one watchdog period plus the RPO and slack) | The `Backup Watchdog` workflow (`scripts/check-backup-health.mjs`, daily 04:40 UTC) reads the Actions record of `backup-database.yml` and **opens an issue** labelled `backup-alert` when the newest completed run is red, succeeded with **no live artefact**, or is older than the RPO; a healthy check comments and closes that issue by itself. It is deliberately a separate workflow, because a backup cannot report its own absence — a run that never started is the case this exists for. **What breaks it:** deleting or disabling the watchdog, or GitHub disabling scheduled workflows in an otherwise quiet repository (the risk both schedules share). |
| Retention | **30 days** of daily artefacts | The workflow's `retention_days` default; 1–90 is accepted, so any other value is a deliberate policy change. Artefact + verification report travel together → at least 30 daily recovery points. Local `backups/` is **not** part of this policy (§6). |
| PITR | **None** (Free plan) | With Pro + the PITR add-on the RPO becomes seconds at roughly **$100/month plus compute**; that purchase is the owner's decision and is the cheapest way to shrink the 24-hour window. |

**The figures are enforced, not merely written here.** The workflow's schedule and its retention
default are asserted against this section by `tests/unit/backupTargeting.test.ts`, so editing one side
without the other fails the suite instead of silently changing the policy. The alerter behind *time to
notice* is guarded the same way by `tests/unit/backupHealthWatchdog.test.ts`, which pins one case per
way a backup can be a lie — red, green with no artefact, artefact expired, older than the RPO, and no
run at all — plus the boundary, the schedule's position after the backup it watches, and the rule that
a watcher which cannot look must report **unhealthy**, never healthy.

## 10. Responsibilities

| Responsibility | Owner |
|---|---|
| Configure `PROD_DB_*` secrets and run the first production backup | Project Owner |
| Investigate red backup runs | Developer |
| Approve production restores | Project Owner |
| Perform production restores | Developer, with approval |
| Re-verify the newest artefact monthly | Developer |
| Decide on Pro plan / PITR | Project Owner |
| Keep this document true | Whoever changes the tooling |

## 11. What the live backup job has actually been doing

### Update 2026-10-16 — the job runs, the backup happens

| Observation | Value |
|---|---|
| `PROD_DB_PASS` secret | **Set** 2026-10-15T23:54Z from the validated out-of-repo file (stdin only) — the preflight is green |
| CI run `38826369696` (`environment=production`) | *Preflight* ✓ · *Take the backup* ✓ · *Verify the backup against the environment it names* ✓ · *Confirm the artefact names the environment* ✓ · *Summary* ✗ (its own `require()` bug) · *Upload* **skipped** |
| CI run `38828524870` — the **fixed** workflow, dispatched on `ci-proof/full-tree` | **every step ✓** including *Summary* and *Upload*: the verify step's own output reads *Statements: 769 applied in 0.3 s · Failures: 0* and *PASS integrity · replay · counts · structure · digests*, with the live source identity compared |
| Local production artefact, 2026-10-16 | `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-15T23-57-01.sql` — 333,989 bytes, sha256 `ceb62aa9…`, cluster `7666007964130682852`, 30 tables · **249 rows** · 56 FKs · 104 policies |
| Restore verification on it | **PASS** — integrity, replay (769 statements, 0 failures), counts (per-table `content identical`), structure, digests, auth `auth.users` 2/2 |
| Production artefacts stored on GitHub | **1** — run `38828524870` uploaded `database-backup-production-36`: **53,237 bytes**, digest `sha256:1c8d0abd…`, **expires 2026-11-15**, i.e. the agreed 30 days |

The 2026-10-01 row *"Runs that succeeded: 0"* has therefore changed, and the reporting step no longer
fails either: run `38828524870` is **green end to end**, including *Summary* and *Upload*. What remains is
only that the **scheduled** run takes the fix once `main` carries it (PR #1).

### Update 2026-10-16 — the fix is on `main`, watched, and drilled

| Observation | Value |
|---|---|
| **PR #1 merged** `2026-10-16T00:45:48Z` | merge commit `de1a962e` — `main` carries the fix, the upload ordering, both guards and the watchdog |
| Backup run on `main` `38831480604` | **success**, every step ✓ with *Upload* before *Summary*; stored **`database-backup-production-37`** (53,239 bytes, digest `sha256:f5134f9c…`, expires 2026-11-15) |
| First real alert | watchdog run `38831384562` found `state: red` (`simulated: false`, newest completed run `38826369696` = failure) and **opened issue #2**; after the successful run above, watchdog `38831620800` found `state: ok` and **closed it** (`00:49:04Z`) — no human involved |
| Timed recovery drill | artefact from `main`'s run → **`PASS` integrity · replay · counts · structure · digests · auth**, `failures: []`, in **30.0 s** of tool time; artefact digest matched GitHub's recorded digest exactly |

The full record, including what the drill does *not* cover, is `device-evidence/recovery-drill-2026-10-16.md`.

### Update 2026-10-16 — a reporting step can no longer discard a verified artefact

The fix above corrected the *typo* in the summary. It did not correct the *arrangement* that let a typo
cost a backup, and that arrangement was still in the file: the `Summary` step — which reports, and runs
`if: always()` — was ordered **before** the upload. So a failure anywhere in a step that only describes
the run skipped storage entirely, which is exactly what happened in run `38826369696`: every gate passed,
the backup was real, and it was thrown away by the step that was supposed to tell someone about it.

Storage is now the first step after the last gate. Everything ordered after it is a reporter that runs
regardless of the outcome, so no summary, notice or typo can sit between "this backup is verified" and
"this backup is kept". Note the deliberate asymmetry: the upload still carries **no** `if:`, because an
unverified artefact must be impossible to store — the change removes the ability to lose a verified
backup, not the ability to publish an unverified one.

That ordering is asserted, not recommended. `tests/unit/backupTargeting.test.ts` parses the job's steps
in order and fails if any reporting step (`if: always()` / `if: failure()`) is placed before storage, if
the upload loses its unconditional form, or if a new step is introduced between verification and
storage without a decision. The guard was proven able to fail by injecting the old arrangement once —
the suite went red naming run `38826369696` — with the file then restored byte-identically and the suite
re-run green: **28 tests, exit 0**.

### The 2026-10-01 record, kept because it is why the ten failures looked the way they did

Recorded 2026-10-01, from GitHub, read-only:

| Observation | Value |
|---|---|
| Runs in the last 10 days | 10 |
| Runs that succeeded | **0** — all ten are `failure` |
| Backup artefacts stored on GitHub | **0** (`total_count: 0`) |
| Job environment in that file | `QA_DB_HOST`, `QA_DB_USER`, `QA_DB_PASS` only |
| Steps the job actually executed | **0** — it failed before the first one |
| Why it failed | *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* |

Three conclusions, and the first two are the ones people miss.

A workflow titled "Backup Production Database" passed only QA credentials to a script that hardcoded
the same variables — so it could not have backed up production even when it succeeded.

It never ran at all, though. The ten failures were not the script failing; they were GitHub refusing
to start the job, which is why it failed in three seconds with zero steps. So the honest statement is
not "the backup was wrong" but "no backup process has ever executed". There is no artefact of any
kind, from any environment, on GitHub today. *(Superseded 2026-10-16: production artefacts now exist from
run `38828524870` — see the update above; this paragraph is kept as the record of what the job was doing
on 2026-10-01.)* Production has no recovery path, and neither has
staging.

### GitHub Actions cannot start any job in this repository at present

This is an account-level block, not a workflow problem, and it is **independent of the credentials**:

```
The job was not started because recent account payments have failed or your
spending limit needs to be increased. Please check the 'Billing & plans' section
in your settings
```

Every job on the `main` commit shows it, including `Run Tests` in the APK workflow (0 steps) and a
dispatch of the corrected backup workflow (0 steps, 2 seconds). `repos/.../actions/permissions`
reports `enabled: true`, so this is billing alone. **Resolving it requires the account owner.**

Two consequences for recovery:

* The scheduled daily production backup cannot succeed until billing is resolved, no matter what
  secrets exist. Its runs will keep being red for that reason, not because of anything in this
  repository.
* The gate does **not** depend on GitHub Actions. `node scripts/backup-database.mjs --env
  production` run from a machine holding the credentials produces the same artefact through the same
  code, and that is how the first verified production backup can be taken while billing is
  unresolved.

### What is already in place (2026-10-01)

| Item | State |
|---|---|
| Corrected workflow on `main` | **Yes** — commit `de13eb1d`, blob-verified identical to this checkout, registered as `Backup Database (to the environment it names)` |
| `PROD_DB_HOST` secret | **Set** — `aws-0-ap-northeast-1.pooler.supabase.com` (a shared regional address, verified by probe) |
| `PROD_DB_USER` secret | **Set** — `postgres.gkswcfljxlutkfdvvqng` (a username, already in `environments.json`) |
| `PROD_DB_PASS` secret | **Not set in GitHub — the local route supplies it** (`~/.agrishop/production.env`, written through the sanctioned intake form on 2026-10-01); CI still needs this secret if the scheduled job is ever unblocked |
| GitHub Actions | **Blocked by billing** — no job can start |
| First verified production backup + restore | **Done, 2026-10-01** — artifact `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-01T11-21-48.sql`; isolated restore PASS (788 statements, 0 failures, 28/28 row digests identical); two mutation proofs on the same artifact |

`PROD_DB_HOST` was not guessed. The pooler resolves the project ref in the *username*, so a login
attempt with a deliberately wrong password distinguishes the two failure modes that matter:

| Probe | Result |
|---|---|
| `aws-0-…` pooler + `postgres.gkswcfljxlutkfdvvqng` | `password authentication failed for user "postgres"` — the tenant was resolved, so host and username are correct and only the password is absent |
| `aws-1-…` pooler + the same username | `tenant/user postgres.gkswcfljxlutkfdvvqng not found` — proves the probe discriminates instead of always failing |

### Verifying the tooling without production credentials

```bash
npm run verify:targeting   # 8 cases at the process boundary: exit codes, pre-connection refusal, no secret in any output
npm run verify:workflow    # 24 checks: structure, shell syntax, and each invariant proven able to fail
```

Both are also runnable directly (`node scripts/verify-targeting-refusals.mjs`,
`node scripts/verify-workflow-safety.mjs`). `verify:workflow` executes the workflow's own preflight
and artefact-confirmation steps under controlled environments, so "never falls back to QA
credentials" and "never uploads an unverified artefact" are demonstrated by running the deciding
code rather than by restating the intention.

## Changelog

| Date | Change |
|---|---|
| 2026-09-12 | Initial recovery documentation (described a system that did not exist) |
| 2026-10-01 | Rewritten against the real tooling: explicit targeting, restore verification, and the honest statement that production has no backup path yet |
| 2026-10-01 | Added the commit prerequisite (§7 step 0), the exact credential-provisioning commands, and the recorded state of the live backup job (§11) |
| 2026-10-01 | Workflow pushed to `main` (`de13eb1d`); `PROD_DB_HOST` and `PROD_DB_USER` provisioned and probe-verified; recorded that GitHub Actions is blocked by account billing, and that the ten historic failures were that block rather than the script |
| 2026-10-01 | **First verified production backup + isolated restore (PASS).** The original database password was not retrievable, so it was reset in the dashboard after a dependency analysis proved no runtime or job used it; the new value went only to `~/.agrishop/production.env` through the local intake form. Cluster `7666007964130682852` enrolled; artifact-gate checks in `verify:workflow` now present a chosen manifest instead of the newest one (24 checks) |
| 2026-10-16 | **Production credentials complete and §9 objectives agreed.** `PROD_DB_PASS` set from the validated out-of-repo file (stdin only), so the CI preflight passes; run `38826369696` takes the production dump and restore-verifies it in CI; a fresh local artefact (333,989 bytes) restore-verifies **PASS**; the Summary-step `require()` bug that discarded the artefact is fixed (`92a8802a`, PR #1); §9 now records **RPO 24 h** (conditional on the daily run), **RTO 4 h** from the restore decision (target, undrilled), **retention 30 days**, and detection unbounded until monitoring exists |
