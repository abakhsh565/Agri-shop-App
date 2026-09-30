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
| `production` | `gkswcfljxlutkfdvvqng` | `PROD` | **none, by design** | *not enrolled — needs one successful run* |

A project ref is **not** a secret (it is in every Supabase URL). Credentials are **never** stored in
this file, and production has no credential file at all: `PROD_DB_HOST/USER/PASS` must come from the
process environment, which in CI means repository secrets.

### Why the fingerprint matters

Supabase's pooler authenticates the client as `postgres.<project-ref>` and then rewrites the session
role: a live connection reports `current_user = 'postgres'` with no ref in it, and
`current_setting('supabase.project_ref')` returns NULL (measured on this project, 2026-10-01). So the
server cannot be asked which project it is. The project is therefore taken from **the credential we
authenticated with**, and corroborated by `pg_control_system().system_identifier` — a value the
pooler cannot rewrite — which is compared against the one enrolled in `environments.json`.

## 4. Taking a backup

The environment must be named. **There is no default**, because a default is how the original bug
happened.

```bash
# Staging (credentials come from .env.qa)
node scripts/backup-database.mjs --env staging

# Production (credentials must already be in the process environment)
export PROD_DB_HOST=... PROD_DB_USER=postgres.<project-ref> PROD_DB_PASS=...
node scripts/backup-database.mjs --env production
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
   tables, policies and functions as reviewed and versioned.
2. **Data** — apply the artefact, which supplies every row plus functions, views and policies.

`scripts/restore-verify.mjs` proves step 2 replays cleanly and faithfully. It does **not** prove a
destructive restore against a live project, and no such restore has been performed. Any production
restore requires the approval checklist below and is expected to be performed against a **new**
project first, then cut over — never by overwriting production in place.

**Approval checklist:** project owner notified · reason documented · artefact identified and hash
verified · expected data loss calculated · downtime communicated · rollback plan exists · the
artefact has been restore-verified into a throwaway target immediately beforehand.

## 6. Retention, and why the copy on disk is not the copy that matters

* GitHub Actions artefacts: `retention-days` (default 30, 1–90). The artefact and its verification
  report are uploaded together.
* `backups/` on a developer machine is gitignored and is **not** a backup strategy.
* The Free plan deletes nothing for you: there is no managed copy to fall back on. Keep at least one
  copy somewhere other than the machine that produced it.
* Recommended: verify the most recent artefact monthly by running `restore-verify` against it. An
  unverified artefact is a guess.

## 7. To give production a recovery path (the outstanding work)

### Step 1 — the corrected workflow must be on `main` first

This is the prerequisite that is easiest to miss, because everything else can be done without it and
nothing will appear to go wrong. The workflow on GitHub today is still the old one:

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

### Step 2 — add the credentials

Supply the three secrets with values obtained from the Supabase dashboard for the production project
(Settings → Database → Connection string / Connection pooling). Host is the pooler host; the user is
`postgres.<project-ref>`, not a bare `postgres`.

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
The script reads them from the process environment only, and production has no credential file by
configuration — `scripts/lib/environments.mjs` will not read one.

3. Run the **"Backup Database (to the environment it names)"** workflow with `environment =
   production`, or run the command in §4 locally.

   ```bash
   gh workflow run "Backup Database (to the environment it names)" \
     -f environment=production -f reason="first verified production backup"
   gh run list --workflow backup-database.yml --limit 1
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

These are asserted by `tests/unit/backupTargeting.test.ts` (20 tests, each refusal paired with the
correct configuration that must be accepted, so the refusals cannot pass vacuously).

## 9. Honest RPO / RTO

| Metric | Current |
|---|---|
| Production RPO | **Unbounded** — no backup can be taken today |
| Staging RPO | Time since the last successful run (manual; not scheduled) |
| RTO (staging, small database) | Minutes to create a target and replay; the restore itself replayed in ~2 seconds in-process |
| PITR | Not available; with the Pro plan + PITR add-on RPO would be seconds, at roughly $100/month plus compute |

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

Recorded 2026-10-01, from GitHub, read-only:

| Observation | Value |
|---|---|
| Workflow registered on GitHub | `Backup Production Database` (`backup-database.yml`, id 356696657) — the **pre-rewrite** file |
| Runs in the last 10 days | 10 |
| Runs that succeeded | **0** — all ten are `failure` |
| Backup artefacts stored on GitHub | **0** (`total_count: 0`) |
| Job environment in the live file | `QA_DB_HOST`, `QA_DB_USER`, `QA_DB_PASS` only |

Two conclusions, and the second is the one people miss. A workflow titled "Backup Production
Database" passed only QA credentials to a script that hardcoded the same variables — so it could not
have backed up production even when it succeeded. And it has not succeeded: there is no artefact of
any kind, from any environment, on GitHub today. Production has no recovery path, and neither has
staging.

### Verifying the tooling without production credentials

```bash
npm run verify:targeting   # 8 cases at the process boundary: exit codes, pre-connection refusal, no secret in any output
npm run verify:workflow    # 22 checks: structure, shell syntax, and each invariant proven able to fail
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
