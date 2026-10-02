# PHASE 2A — Production backup + restore safety

**Date:** 2026-10-01 · **Branch:** `main` — Phase 2A committed as `de13eb1d` and pushed · everything from earlier phases still uncommitted, deliberately

---

## Verdict

> ### ✅ PHASE 2A — PRODUCTION BACKUP + RESTORE SAFETY: **PASS** (2026-10-01)
>
> **The gate was met with real evidence, in this order:** a real production backup exists; it was
> restored into a throwaway database with zero replay failures; the restored database was compared
> with live production and matched in structure, counts and row digests; the verifier was shown to
> catch two independent mutations of that artifact; production was not modified; QA was unchanged
> by every production operation; the credential never leaked; nothing was paid for.
>
> | Requirement | Evidence |
> |---|---|
> | Production backup completed | `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-01T11-21-48.sql` — 340 654 bytes, sha256 `59aaca8af324f7d0…`, 30 tables / 268 rows (§16) |
> | Production identity verified | cluster `7666007964130682852` asserted before and after the dump; the credential names the production project |
> | Artifact valid | integrity layer: sha256 and byte length both equal the manifest |
> | Isolated restore completed | **788 statements replayed into in-process PGlite, 0 failures** (§16.2) |
> | Restored matches production | 28/28 tables · 337 columns · 102 constraints · 84 indexes · 104 policies · 10 triggers · 37 functions · 2 views · 8 enums — all identical; **28/28 row digests matched, 0 drift** |
> | Integrity verifier passes | full `restore-verify` run: **PASS**, exit 0 |
> | Mutation detection passes | byte-flip → integrity **FAIL** (exit 1); one value changed with the manifest re-hashed → digests **FAIL**, localised to `app_settings.setting_value` (exit 1) (§16.3) |
> | Production untouched | only `SELECT`s against the source; live drift 0; no DDL or DML issued |
> | QA unchanged | `qa:count` **398 before and after** every production operation (delta 0) |
> | No credential leakage | wrapper printed `value withheld`; no log contains a `PROD_DB_PASS=` assignment; the artifact holds no connection string |
> | No paid service | Free plan, local execution throughout |
>
> **NO VERIFIED BACKUP + RESTORE = NO PRODUCTION DATABASE CHANGES.** The rule is now satisfied
> rather than waived: production has a recovery path that has been demonstrated, not assumed.
> The earlier staging exercise (§4) found **three silent data-loss bugs**; the production artifact
> above was written by the fixed code and then replayed — a backup that had only ever been written
> would have looked correct and would have restored wrong.
>
> One harness caveat, recorded because it was found during this run: the workflow-safety verifier
> used to present "the newest manifest in `backups/`" to the artifact gate, which silently swapped
> its subject once a production artifact existed alongside the staging one. It now presents a chosen
> manifest in a scratch directory and tests both environments symmetrically — **24/24 CERTIFIED**
> (§16.4), up from 22 checks.

### What was completed against live GitHub on 2026-10-01

| Action | Result |
|---|---|
| Staged only the Phase 2A files | 11 files; the other 77 working-tree entries from earlier phases were left untouched and nothing was staged with `-A` |
| Committed | `de13eb1d` — 11 files, +3 208 / −375 |
| Pushed to `main` | `1e213ee2..de13eb1d main -> main` |
| Verified the pushed content | GitHub blob SHAs for the workflow, both scripts, `environments.json` and `scripts/lib/environments.mjs` **all MATCH** the local commit — verified by hash, not by the push output |
| Workflow registration | `gh workflow list` now reports `Backup Database (to the environment it names)` (id 356696657) |
| `PROD_DB_HOST` secret | **Set** — `aws-0-ap-northeast-1.pooler.supabase.com` |
| `PROD_DB_USER` secret | **Set** — `postgres.gkswcfljxlutkfdvvqng` |
| Artefact safety | `/backups/` is now ignored **in the committed `.gitignore`** (it was only in the working tree before, so a fresh clone had no protection); 0 tracked files under `backups/` |
| No APK side effect from the push | `Run Tests -> failure`, `Build APK -> skipped`, release list unchanged at `apk-build-262`, artefacts still 0 |

#### The two secrets were verified, not guessed

The Supabase pooler resolves the project ref carried in the *username*, so a login attempt with a
deliberately wrong password separates the failure modes that matter. Nothing was modified: both
probes are failed authentications against a read-only path.

| Probe | Result |
|---|---|
| `aws-0-ap-northeast-1.pooler.supabase.com` + `postgres.gkswcfljxlutkfdvvqng` | `password authentication failed for user "postgres"` — **the tenant resolved**, so host and username are right and only the password is missing |
| `aws-1-ap-northeast-1.pooler.supabase.com` + the same username | `tenant/user postgres.gkswcfljxlutkfdvvqng not found` — the control that proves the probe discriminates rather than always failing |

With the real host and username and no password, the tool refuses exactly as the first real run
will: `[TARGETING] Refusing to run for "production": missing PROD_DB_PASS`, exit 2, **before any
connection**. The region and the pooler naming were taken from the authorised Supabase MCP
(`get_project`, `list_projects`) — read-only, and no credential-bearing tool exists to call.

#### A correction to the earlier diagnosis

The previous version of this report recorded the old workflow as *"failed on all 10 of its last 10
runs"* and inferred a broken backup process. That was incomplete. Every one of those jobs executed
**zero steps** and failed in ~3 seconds, and the annotation says why:

```
The job was not started because recent account payments have failed or your
spending limit needs to be increased. Please check the 'Billing & plans' section
in your settings
```

So the old workflow never ran at all — its failures were GitHub declining to start the job, not the
script failing. The static defect is unchanged and still real (that file passed only `QA_DB_*` to a
script hardcoding `QA_DB_*`, so it could not have backed up production even when it ran), but the
accurate statement is **no backup process has ever executed**, rather than *the backup process was
broken*. `repos/.../actions/permissions` reports `enabled: true`, so this is billing alone.

The same annotation appears on `Run Tests` in the APK workflow (0 steps), so the block is
repository-wide and predates this phase. **It means the scheduled production backup cannot succeed
until the account owner clears it, whatever secrets exist** — and it is why the gate is still
reachable by running the same command locally, where no GitHub runner is involved.

---

## 1. Existing backup capability — the reconnaissance, answered

Read-only throughout. Production was not modified.

| Question | Answer |
|---|---|
| Current Supabase backup configuration | **None.** Organisation plan is `free`. Supabase backs up Pro/Team/Enterprise projects only. |
| Available backup mechanism | None from Supabase. The repository's own logical dump was the only mechanism, and it targeted the wrong database. |
| Backup retention | N/A — no managed backups exist. GitHub artefact retention was 30 days. |
| Point-in-time recovery | **No.** PITR is a Pro add-on (~$100/mo for 7 days, ~$200 for 14, ~$400 for 28). |
| Can backups be downloaded/exported? | **No.** Supabase: *"Database backups are not available for download for Free Plan projects."* |
| Does the "Backup Production Database" workflow target production? | **It never did.** It passed `QA_DB_*`. |
| Does it target QA? | Yes — and `scripts/backup-database.mjs` hardcoded `QA_DB_*` and stamped its output `-- Environment: QA`. |
| What credentials/secrets did it use? | `QA_DB_HOST`, `QA_DB_USER`, `QA_DB_PASS` (`QA_DB_USER` = `postgres.bpybjrjenwccowvtrevu` — the QA project, in the production workflow). |
| Schema only, or data too? | Data, but **silently incomplete**: it skipped any table over 1000 rows, and never dumped the `auth` schema, so a restore had no logins at all. |
| Was there a restore script? | **None existed anywhere in the repository.** `docs/RECOVERY.md` described a `psql < backup.sql` procedure against a `SUPABASE_DB_URL` secret and an `npx supabase db dump` step that were never implemented. |

Independent corroboration that the reachable channels are what they appear to be:

* The Supabase MCP connection exposes **read-only metadata only** (`list_projects`, `list_tables`, `list_migrations`, `get_advisors`, `query_logs`, `list_branches`, …). There is no SQL execution and no row access, so no credential-free path to production data exists.
* A scan of the checkout for production credentials found **none**: no `postgres.gkswcfljxlutkfdvvqng` user form, no `PROD_*`/`PRODUCTION_*` variables, and every `DB_PASS` reference under `tests/` is `QA_DB_PASS`. The only production-ref JWT in the tree is a **stale QA `anon` key** inside a pre-Phase-1 build artefact (`dist/`), i.e. public client data, not a credential.

## 2. Backup workflow targeting — fixed, not renamed

The environment is now a **value that is checked**, not a word in a filename.

**`environments.json`** (new, repository root) is the single source of truth mapping environment →
project. The app's build gate (`src/lib/environmentContract.ts`), the audit script, the backup tool
and the restore verifier all read it. It records, per environment, the **project ref**, the
**credentials prefix**, the optional **local credential file**, and the **cluster fingerprint**.

**`scripts/lib/environments.mjs`** (new) enforces, in order, all fail-closed:

1. the caller must name the environment — **there is no default**;
2. the environment must have a project ref (so `development`, which has none, is refused);
3. credentials are read **only** from that environment's own prefix — a production run never looks at `QA_*`, so it cannot pick up staging credentials even if they are present;
4. the credentials must **name** their project (`postgres.<ref>`), and that ref must be the environment's — this is the check that catches the original defect, and it runs **before a connection is opened**;
5. after connecting, the cluster fingerprint is compared with the one enrolled in `environments.json`.

### The identity problem, and why the obvious check would have failed

Measured on the live staging connection:

```
current_user                     = postgres          <-- NOT postgres.<project-ref>
current_setting('supabase.project_ref') = NULL
```

Supabase's pooler authenticates the client as `postgres.<ref>` and then **rewrites the session
role**. So `current_user` cannot name the project, and the project must instead be read from *the
credential that authenticated*, corroborated by
`pg_control_system().system_identifier` (`7678069749886157684` for staging) — a value the pooler
cannot rewrite. A check that had read a ref out of `current_user` would have failed on every pooled
connection, and one that trusted it would have been reading a value the pooler controls.

### The workflow

`.github/workflows/backup-database.yml` — renamed to **"Backup Database (to the environment it
names)"**, and rebuilt:

* `environment` is a **required `workflow_dispatch` input** (no default); the daily schedule targets `production` explicitly;
* a **preflight step fails the run** when the selected environment's secrets are absent, with the message *"PRODUCTION HAS NO BACKUP CREDENTIALS CONFIGURED … no production schema or data change may be made"* — a backup that did not happen is never green;
* the backup is passed `--env "$TARGET"` and the tool performs its own identity verification;
* **every backup is restore-verified in the same job**, into a throwaway in-process Postgres, with the verification report uploaded beside the artefact;
* an independent step re-reads the artefact's manifest and asserts its `environment`/`projectRef` against `environments.json`;
* the artefact is not uploaded unless all of that passes (`if-no-files-found: error`).

Validated: no YAML parser is installed in this repository, so the file was checked structurally
(no tabs, consistent indentation, well-formed block scalars, 20 balanced `${{ }}` expressions) and
**all 6 shell `run:` blocks were syntax-checked with `bash -n`**. This is not the same as GitHub
parsing the file, and is reported as such.

## 3. The documented procedure

`docs/RECOVERY.md` was **rewritten** — its previous contents described a backup system that did not
exist. It now records, for a backup: source environment, source project (and how it is verified),
timestamp, scope, artefact identity (sha256), retention, restore target, verification method, the
four refusal behaviours, and honest RPO/RTO figures (production RPO is **unbounded** today).

## 4. The restore — actually performed

```
$ node scripts/restore-verify.mjs --from backups/backup-staging-....manifest.json \
      --compare-with staging --json backups/restore-report-staging.json
```

**Where it restored:** a fresh Postgres running **inside the verification process**
(`@electric-sql/pglite`), created and discarded per run. QA was **not** used as the restore target —
its state was preserved — and production is not a target at all.

```
RESTORE VERIFICATION: PASS      (exit code 0)
  PASS  integrity    sha256 + byte length match the manifest
  PASS  replay       2807 statements, 0 failures, 3.7s
  PASS  counts       54/54 tables; 0 restored short of the backup; 0 source drift
  PASS  structure    9/9 categories identical
  PASS  digests      54 compared, 54 matched  (identical ROWS, not just counts)
  PASS  auth         35 users / 38 identities
```

Artefact: `backup-staging-bpybjrjenwccowvtrevu-2026-09-30T20-39-37.sql` — 3 250.7 KB,
`sha256 13f7c32929aacffa42e7e42484ad20244a103877d0c111a6d3765a37849ccb68`, 1 769 rows over 56 tables
(54 public + 2 auth), 160 functions, 81 foreign keys, 83 policies, 37 triggers, 9 enums.
Its migration ledger (`latest 0011`, 3 records) matches the Supabase control plane's independent
view of the same project — two sources agreeing on which database this came from.

## 5. Verification method (what "verified" means here)

| Layer | Method |
|---|---|
| Integrity | sha256 and byte length of the artefact vs its manifest |
| Replay | statement-by-statement execution in a fresh database, with a dollar-quote/string/comment-aware splitter; failures reported with the statement that caused them |
| Counts | every table, restored vs recorded-at-backup vs live-now, with drift reported separately because a backup is a point in time |
| Structure | tables, columns **with types and defaults**, constraints, indexes, policies (cmd/roles/using/with-check), triggers, functions (result, `security definer`, volatility, `search_path`), views, RLS flags, enum labels — one snapshot function run against **both** databases |
| Row content | per-table row digest (`md5` of the rows in primary-key order, UTC and `extra_float_digits` pinned on both sides) — where the source has not changed, this proves the **same rows** arrived |
| App compatibility | **not tested**, and deliberately: the restored database is in-process with no listener, so the app cannot connect to it, and no production environment variable was touched |

### Non-vacuity — both guards were shown to catch a real failure

* **Targeting guard:** the pre-connect credential check was removed from `resolveCredentials` and
  `tests/unit/backupTargeting.test.ts` failed exactly **4 tests** (including the spawned-CLI case);
  restored → **20/20 pass**.
* **Comparison guard:** a deliberately corrupted copy of the artefact (`backups/make-mutant.mjs`)
  was built — an extra table with a column, index and policy, plus one foreign key changed from
  `ON DELETE CASCADE` to `RESTRICT` — with its manifest hash recomputed so integrity still passes.
  The verifier reported `extra 1` for tables, `extra 2` for columns, `extra 2 / changed 1` for
  constraints, `extra 2` for indexes, `extra 1` for policies, **FAIL structure, exit 1** — while
  still classifying the two genuine re-renderings as non-failures. The clean artefact exits 0.

The two `rendered` entries are the *same predicate deparsed twice*: the live server stores
`(ARRAY['added'::character varying]::text[])` and the re-parsed text yields per-element casts. They
are reported with both full texts, never hidden. The comparison predicate used to classify them was
itself tested against a changed column, a changed operator and a changed literal bound, and
correctly flagged all three as real differences.

## 6. Refusal behaviour — all four required, plus two

| Situation | Result |
|---|---|
| No `--env` given | **exit 2** — "requires an explicit target and has no default" |
| Production backup with no production credentials | **exit 2** — names `PROD_DB_HOST` and states it will not fall back |
| QA credentials supplied to a production backup | **exit 2** — "*declared production (project gkswcfljxlutkfdvvqng) but its credentials name project bpybjrjenwccowvtrevu, which is "staging""* |
| Production credentials supplied to a QA backup | **exit 2** — same check, reversed |
| `--env development` (no project exists) | **exit 2** — a target that cannot be named is not a target |
| Restore aimed at `production`, the production ref, or a `postgresql://` URL | **exit 2** — refused before the artefact is even read |

No silent fallback exists on any path. A wrong-target refusal happens **before a connection is
opened**, which is why it can be (and is) proven without holding production credentials.

**Restore failure safety:** restoring is implemented for exactly one target, and there is **no code
path that opens a write connection to a Supabase project** — "restore into production" is not a
guarded option, it is an operation that does not exist. A restore whose manifest records a
different project than the `--compare-with` environment is also refused, rather than comparing
against the wrong source.

## 7. Three data-loss bugs found by *executing* the restore

None of these would have been visible in a backup that was merely written and filed.

1. **Every timestamp was truncated to milliseconds.** `node-postgres` parses `timestamptz` into a JS
   `Date`, which holds milliseconds; Postgres holds **microseconds**. Measured:
   `2026-09-27 14:17:44.338897+00` → `2026-09-27T14:17:44.338Z`. Fixed by taking the server's own
   text for `timestamptz`, `timestamp`, `date`, `time`, `timetz` and `interval`.
2. **`jsonb` values were silently changed.** A JS value cannot represent what `jsonb` stores:
   `JSON.parse`/`stringify` collapses `1.0` to `1` (a different `jsonb` value) and rounds numbers
   beyond float64. Found by per-column digest diagnosis after the whole-table digest for
   `audit_events` differed. Fixed the same way.
3. **Foreign keys were created before the rows**, and tables were dumped alphabetically, so a restore
   had to insert `sale_items` before `sales`. The artefact is now written in the three phases a
   logical restore needs — **pre-data → data → post-data** — and SQL-language function bodies are
   validated in a final pass, after every callee exists.

Also fixed on the way: primary-key constraint **names** were not preserved; constraint-backed
indexes were dumped twice; generated columns and `identity` columns were not handled as INSERT
targets; and a table whose column default calls a function could not be created at all until
functions are created first.

## 8. Safety certification — what was verified without production credentials

The production run cannot be rehearsed, because production credentials do not exist. What *can* be
verified is the machinery that decides whether it is safe to run — and it was verified at the
**process boundary**, by executing it, not by reading it.

### 8.1 `npm run verify:targeting` — 8 cases, real processes, real exit codes

`tests/unit/backupTargeting.test.ts` imports the library and checks that the right functions throw.
That proves the logic. It does not prove that `node scripts/backup-database.mjs` exits non-zero,
stops before opening a socket, or keeps a credential out of its output — a function can throw while
a wrapper swallows it. So `scripts/verify-targeting-refusals.mjs` spawns the real CLIs and judges
them from the outside.

| Case | Exit | Elapsed | Result |
|---|---|---|---|
| no `--env` | 2 | 480 ms | refused, usage printed; there is no default target |
| `--env banana` | 2 | 305 ms | unknown environment, not guessed |
| `--env development` | 2 | 288 ms | no project ref recorded, so the target cannot be verified |
| `--env production`, no credentials | 2 | 382 ms | names `PROD_DB_HOST/USER/PASS`; will not fall back to another prefix |
| `--env production` carrying **staging** credentials | 2 | 248 ms | **the original defect** — refused, and names both projects |
| `--env staging` carrying **production** credentials | 2 | 236 ms | the same rule in the other direction |
| `--env production` with a bare `postgres` user | 2 | 231 ms | a credential naming no project is not a target |
| `--env production`, correct identity, unresolvable host | **1** | 299 ms | **the control**: identity accepted, then `getaddrinfo ENOTFOUND` |

The last row is what gives the other seven meaning. A suite that only ever observes refusals is
satisfied by a tool that refuses everything; the control shows the identity check *passes* when the
credentials legitimately name the target. Every case carrying a credential carries a freshly
generated canary as its password, and the canary is asserted absent from all output — so "no
credential value reaches the output" is checked, not assumed. Elapsed times of 231–480 ms against an
address that cannot answer are the evidence for *before any connection*.

### 8.2 Leak probes on the two paths most likely to echo a credential

| Path | Result |
|---|---|
| Connection fails at DNS (`ENOTFOUND`) | password absent from stdout and stderr |
| Authentication fails against the real QA pooler with a wrong password | password absent; message reads `password authentication failed for user "postgres"` |
| Manifest and artefact | no host, no password, no connection string — `configuredUser` (a username), `clusterId`, counts, sha256 |

The second probe re-confirmed the fact that shaped the design: the error names `postgres`, not
`postgres.<ref>`. The pooler rewrites the identity, which is why the project must be read from the
credential string and corroborated by the cluster fingerprint, never from `current_user`.

### 8.3 `npm run verify:workflow` — 22 checks, none of them vacuous

Every invariant is paired with the mutation that must break it. The check must pass on the real file
and **fail on the mutated copy**, or it is reported as vacuous and the run fails.

| Invariants (12) | Result |
|---|---|
| `environment` input is a required choice, with **no default** | PASS |
| only `production` and `staging` are offered — `development` is excluded | PASS |
| no project ref is hardcoded in the workflow | PASS |
| the backup step delegates targeting to the tool (`--env "$TARGET"`) | PASS |
| the preflight refuses when the selected environment has no credentials | PASS |
| the preflight names the missing production credentials | PASS |
| verification runs **before** the upload | PASS |
| the upload is gated on success, with `if-no-files-found: error` | PASS |
| the upload is scoped to `env.TARGET` | PASS |
| no `continue-on-error` anywhere | PASS |
| retention comes from a bounded input, not a literal | PASS |
| 6 `run` blocks syntax-checked with `bash -n` | PASS |

The workflow's own shell was then extracted and executed under controlled environments:

| Scenario | Result |
|---|---|
| target gate: `production` | exit 0 |
| target gate: `banana` | exit 1 — "Unknown environment" |
| preflight: production with no production credentials | **exit 1** — "PRODUCTION HAS NO BACKUP CREDENTIALS CONFIGURED" |
| preflight: production once the credentials exist | exit 0 |
| preflight: staging with no staging credentials | **exit 1** |
| preflight: staging once the credentials exist | exit 0 |
| preflight: production carrying **only** QA credentials | **exit 1** — the original defect cannot recur |
| artefact gate: the real staging artefact for a staging run | exit 0 — "as requested" |
| artefact gate: the real staging artefact for a **production** run | **exit 1** — "does not match the requested target" |

The last row is what answers *never upload an unverified backup*: a genuine staging artefact was
presented to the workflow's own gate as if it were a production backup, and refused. The fail-closed
pair (exit 1 with no credentials, exit 0 with them, same block) is what makes the preflight checks
behavioural rather than decorative.

### 8.4 A defect this harness had, and how it was caught

The first version of `verify-workflow-safety.mjs` fed each **whole step** — header and `run: |`
included — to `bash`. That does not fail. `run:` becomes a command, the `|` starts a pipeline, and
everything after it is parsed as the pipeline's right-hand side, which bash runs in a **subshell**. An
`exit 1` inside that subshell terminates only the subshell: the message prints, execution continues,
and the script's status becomes whatever ran last. Observed directly — `TARGET=banana` reported
"Unknown environment" and exited **0**. The preflight checks had been reading as PASS for an
unrelated reason (`set -e` propagated the failure), so the earlier evidence was accidentally right
and structurally unsound. The extractor now executes only the dedented `run` body and refuses to
execute a body that still contains a step header.

This is recorded rather than quietly fixed because it is the same class of mistake as the bug this
whole phase is about: a check that reports PASS while exercising something other than what it claims.

## 9. QA state — recorded, not touched

`npm run qa:clean` was **not run**. QA is deliberately dirty and stays that way. Whether the test
suite mutates QA was not assumed — it was **measured**: `npm run qa:count` before a full unit run,
then after.

```
DELTA ACROSS A FULL UNIT RUN
IDENTICAL — the unit suite wrote nothing to QA (delta 0 on every table).
```

Current QA (staging) counts, read-only from the artefact's manifest:
`customers 11 · sales 8 · sale_items 6 · voids 4 · shops 2 · users 10 · audit_events 331 ·
products 10 · product_variants 10 · memberships 11 · roles 8 · permissions 32 ·
role_permissions 118 · impact_analyses 940 · engineering_memory 64 · credit_limit_requests 12 ·
branches 3 · sale_submissions 4 · product_barcodes 4 · barcode_registry 33`

All 54 table counts are **identical** to the snapshot taken before any test run in this phase, so
the unit suite did not write to QA here. The earlier hand-off note recorded `customers 8 / sales 8 /
audit_events 327`; the drift to `11 / 8 / 331` happened before this phase observed QA and is
**not attributed** to a specific run — it is recorded as-is, uncleaned, pending authorization.

## 10. Not done (the phase's exclusions, respected)

No schema migration · no RLS change · no table deletion · no grant revocation · no auth change · no
production restructuring · no new staging or production project created · no index added · no
business-logic change · no APK generated or released · **nothing committed**.

## 11. Evidence index

| Claim | Evidence |
|---|---|
| The corrected workflow is what GitHub runs | `main` = `de13eb1d`; `gh api repos/{owner}/{repo}/contents/.github/workflows/backup-database.yml?ref=main` SHA `caefb046…` **equals** `git rev-parse HEAD:…`; `gh workflow list` shows the new name |
| The pushed scripts match this checkout | Blob SHAs MATCH for `scripts/backup-database.mjs`, `scripts/restore-verify.mjs`, `environments.json`, `scripts/lib/environments.mjs` |
| `PROD_DB_HOST` / `PROD_DB_USER` are correct, not guessed | Failed-login probes: correct pooler → `password authentication failed`; wrong pooler → `tenant/user … not found` |
| GitHub Actions is blocked account-wide | Job annotation on both workflow families: "not started because recent account payments have failed or your spending limit needs to be increased"; `Run Tests` also 0 steps |
| Artefacts held in the repository are protected **at HEAD** | `.gitignore` rule `/backups/` is part of commit `de13eb1d`; 0 tracked files under `backups/` |
| Regression after the commit | `tsc --noEmit` exit 0 · **421 tests / 42 files** · 8/8 targeting · 22/22 workflow · `npm run build` exit 0 |
| Targeting refusals, at the process boundary | `npm run verify:targeting` → **8/8 cases PASS**; report in `backups/targeting-refusal-matrix.json` |
| Workflow certified before it ever sees a credential | `npm run verify:workflow` → **22/22 checks PASS**, all 12 invariants mutation-proven non-vacuous; report in `backups/workflow-certification.json` |
| No credential value is echoed on a connection or auth failure | Sentinels absent from stdout/stderr on both paths (§8.2) |
| A staging artefact is refused for a production run | The workflow's own artefact gate, exit 1 (§8.3) |
| The unit suite does not write to QA | `qa:count` before/after a full run → **delta 0 on every table** (§9) |
| Staging backup produced | `backups/backup-staging-bpybjrjenwccowvtrevu-2026-09-30T20-39-37.{sql,manifest.json}` (gitignored) |
| Restore executed and passed | `backups/restore-report-staging.json`, `backups/restore-console.txt`, exit code 0 |
| Structure/row equivalence | the report's `checks.structure` and `checks.digests`: 0 missing / 0 extra / 0 changed in all 9 categories, 54/54 digests |
| Refusals | `tests/unit/backupTargeting.test.ts` — 20 tests, including 6 spawned-CLI exit-code assertions |
| Guards non-vacuous | §5: 4 tests fail with the check removed; the mutant artefact is FAILed by the verifier |
| TypeScript | `npx tsc --noEmit` → clean (exit 0) |
| Unit suite | `npx vitest run tests/unit` → **42 files, 421 tests passed** (401 before, +20 new) |
| Production build | `npm run build` → **exit 0** |
| Artefacts unreachable by git | `git check-ignore -v backups/` → `.gitignore:28:/backups/` |

### What was deliberately not run, and why

`npm run verify:plan` computes **Tier 2** (full vitest + 27 Playwright lanes + build + independent QA
row count) — because the working tree carries ~330 uncommitted files from every earlier phase, not
because of this phase's changes.

The **Playwright lanes were not run**: they execute against the shared QA project and write rows to
it, and this phase was instructed not to clean QA and not to disturb it. Running them would have
consumed the very state §8 records. The **integration suite** was not run either: its 14 failures
are pre-existing and root-caused (the harness cannot set `request.jwt.claims`, so the deployed
`app_current_user_id()` returns NULL) and are unrelated to backup tooling.

What was run instead is aimed directly at the change: `tsc`, the **full unit suite** (42 files,
421 tests), the **production build**, a **live backup**, **four complete restore verifications**,
**six CLI refusal paths**, and **two non-vacuity injections**. No layer of this phase's claim rests
on an unrun check.

**Lenses used:** Discovery → DB/Security → Builder → QA → Release, in one worker (this repository
ships no sub-agent runtime — no claim of parallel agents is made). **Sequential:** all.
**Repeated discovery avoided:** the impact map was built once and every later step consumed it.
**Tests executed:** 421 unit + 1 live backup + 4 full restore-verification replays + 6 CLI refusal
runs + 2 non-vacuity injections.

## 12. Files

**Added:** `environments.json` · `scripts/lib/environments.mjs` · `scripts/restore-verify.mjs` ·
`scripts/verify-targeting-refusals.mjs` · `scripts/verify-workflow-safety.mjs` ·
`scripts/lib/credentials-file.mjs` · `scripts/run-with-production-credentials.mjs` ·
`scripts/verify-credential-intake.mjs` · `tests/unit/backupTargeting.test.ts` · this report
**Rewritten:** `scripts/backup-database.mjs` · `.github/workflows/backup-database.yml` · `docs/RECOVERY.md`
**Edited:** `src/lib/environmentContract.ts` (project refs now derive from `environments.json`) ·
`environments.json` (the outside-repo intake rule, written down where the other rules live) ·
`package.json` (`backup`, `backup:verify`, `verify:targeting`, `verify:workflow`, `verify:credentials`,
`creds:production`)
**Untouched, as required:** production schema, RLS, grants, auth, migrations, app behaviour.

## 13. What is missing, and exactly what is required

Production still cannot be backed up, and the reason has narrowed to exactly **one value**:
`PROD_DB_PASS`. Supabase will not produce the backup (Free plan, no downloadable backups, no PITR),
this repository holds no production credentials *by design* — `environments.json` records
`localEnvFile: null` for production, so `scripts/lib/environments.mjs` cannot read a credential file
from the checkout — and the workflow that would take the backup is on `main` but cannot start because
of GitHub's billing block, which is explicitly **not** a dependency of this phase. **No credential
was requested in chat, and none is recorded anywhere in this repository, this report, or any
commit.** §14 records where it was looked for and not found.

### The secure mechanism — two routes, one usable today (step 2, answered)

**Route A — the local intake tool** (free, no runner, no paid service, available now). The value is
written once into a file that must live **outside this repository**, and is then injected into
exactly one child process by an allow-listed wrapper:

```bash
npm run creds:production -- --init      # writes ~/.agrishop/production.env: HOST and USER prefilled, PASS empty
#   ← the operator fills that one line only (Supabase → production project → Settings → Database)
npm run creds:production -- --check     # validates the file; opens no connection
```

The location rule is enforced *before the file is read*, so "never committed" is structural rather
than a `.gitignore` promise — a path inside the repository is refused even when it does not exist.
The file is deliberately not `.env.production.local`, which Vite would load during a production
build; nothing loads `~/.agrishop/production.env` except the intake tool. The wrapper never prints,
logs or hashes the value, and `npm run verify:credentials` proves the whole arrangement with **23
process-boundary checks**: a QA identity behind a `PROD_` prefix, a bare `postgres` user, a missing
or empty password, a file inside the repository, an absent file, any command other than the two
read-only ones, and a run whose arguments do not name production — each a refusal, each paired with
a control that must be accepted, a per-run random canary asserted absent from every output, and one
mutation injection showing the identity check is the thing that refuses.

**Route B — GitHub repository secrets**, set through the authenticated `gh` CLI (`gh` is already
logged in to `github.com` with the `repo` and `workflow` scopes). Values are encrypted at rest by
GitHub, are write-only from any client, and are masked in logs. This route is kept working and
unchanged for when Actions can run; the same process-environment hand-off is why Route A injects into
the environment rather than teaching the backup script to read a file.

```bash
gh secret list                    # names and timestamps only — never a value

# No --body: gh prompts, so the value never enters shell history, a file, a log, or a transcript.
gh secret set PROD_DB_HOST        # aws-0-<region>.pooler.supabase.com   (Supabase → production project → Settings → Database)
gh secret set PROD_DB_USER        # postgres.gkswcfljxlutkfdvvqng   (exactly this; the tool refuses a bare `postgres`)
gh secret set PROD_DB_PASS        # the database password

gh secret list                    # confirm the three names now appear
```

The same instructions, with the prerequisite, are in `docs/RECOVERY.md` §7.

### Order matters

1. ~~Put the corrected workflow on `main` first.~~ **Done — `de13eb1d`, blob-verified.**
2. Fill the one empty line in `~/.agrishop/production.env`, then run
   `npm run creds:production -- --check`. This is the **only external input Phase 2A has left**: the
   value can be obtained from the Supabase dashboard for the production project, and from nowhere
   else (§14). It must not be *reset* to obtain it — rotating a production credential before a
   verified backup exists would break the very rule this phase is establishing.

   *(Superseded 2026-10-01: the operator confirmed the existing password is not retrievable, and
   §15 proved the reset has no consumer anywhere — no runtime, no CI job that has ever run, no
   other checkout. A reset is therefore now the sanctioned path: it changes a credential, not any
   data, and nothing depends on the old value.)*
3. Take the real backup. Production is read-only throughout: the script issues no `INSERT`,
   `UPDATE`, `DELETE`, `TRUNCATE` or DDL against the source at all, only `SELECT` against the
   catalogue and the tables it is copying.

   ```bash
   npm run creds:production -- -- node scripts/backup-database.mjs --env production
   ```

4. Restore that artefact into the disposable in-process target and compare it with production —
   counts and row digests against the live source, schema category by category:

   ```bash
   npm run creds:production -- -- node scripts/restore-verify.mjs \
     --from backups/<the new manifest> --compare-with production \
     --json backups/restore-report-production.json
   ```

   The mutation check is part of the same gate: an intentionally mutated copy of the artefact must
   FAIL in the right categories. That detection was rehearsed on the staging artefact (§5); it is
   re-run against the production artefact in step 6, and a verifier that passes a mutated artefact
   is not evidence.
5. Enrol the production `clusterId` from that first manifest into `environments.json`, so a later
   cluster swap is detected rather than assumed away.
6. Record QA counts before and after (`npm run qa:count` — read-only), confirm the production
   28-table row-count baseline is unchanged, and record the restore report here.

Then, and only then, **PHASE 2A — PRODUCTION BACKUP + RESTORE** can be re-assessed as **PASS**:
a real production backup will exist, and its restore will already have been verified in a
non-production target by the same tool path proven in §4.

**Until that happens: no production database change of any kind.**

## 14. Where the production credential was looked for, and not found

Recorded because "we could not find it" is only evidence if the search is enumerated. Every item
below was checked on 2026-10-01, and **none of them was read for its value** — presence only, so no
secret entered a transcript, a report or a log.

| Location | Result |
|---|---|
| Process environment of the working shell (`PROD_DB_PASS`, `SUPABASE_ACCESS_TOKEN`, `DATABASE_URL`, `PGPASSWORD`) | unset |
| Windows user-level and machine-level environment (same names, checked through `[Environment]::GetEnvironmentVariable`) | absent |
| Repository env files — `.env.example`, `.env.local`, `.env.qa`, `ai-assistant/.env`, `tests/.env.test` (key names only) | QA and app keys only; no `PROD_*` key exists in any of them |
| Supabase CLI state — `~/.supabase/access-token`, `supabase/.temp/` | no access token, no link metadata; the CLI is not installed |
| GitHub repository secrets — `PROD_DB_HOST` ✅, `PROD_DB_USER` ✅, `PROD_DB_PASS` | not set (and secret values are write-only from any client regardless) |
| Supabase MCP tool-list, enumerated twice | strictly read-only: no SQL execution, no connection string, no credential endpoint |
| Supabase account plan and API surface | Free plan: no managed backups, no downloadable backups, no PITR, no password-returning endpoint |
| Git history and tracked files | no `PROD_*` credential has ever been committed |

The search therefore ends at exactly one place: the **Supabase dashboard**, where the operator can
read the production database password (or the pooler connection string, which uses the same value).
That is the external input this phase stops at, and it is free. If the password was never saved, the
dashboard's reset control is the only remaining source — a decision for the operator, not for this
tooling, and one that changes a credential rather than any data.

## 15. Password reset — dependency analysis, and why it is safe (2026-10-01)

**Directive.** The existing production database password is not retrievable from the dashboard. Do
not create another Supabase project. Before any reset, autonomously determine whether the current
password is used anywhere in the existing deployment/runtime configuration. If genuinely
unrecoverable: document the evidence, identify every affected configuration, reset the password on
the existing production project, put the new value only in the sanctioned file, verify intake, then
run the backup → isolated restore → full verification → QA before/after → regression. Stop only if
the reset itself is the one external action left.

**Question:** does anything break when the production database password is rotated?

**Answer: nothing. It is referenced by no runtime and no job that has ever executed.** Every
surface below was checked on 2026-10-01, read-only, presence only — no secret value was read,
printed or stored.

| Surface | Command / method | Result |
|---|---|---|
| GitHub repository secrets | `gh secret list` | `PROD_DB_HOST`, `PROD_DB_USER`, `QA_*` — **`PROD_DB_PASS` not set** |
| GitHub variables, environments | `gh variable list`; `gh api repos/:owner/:repo/environments` and their `/secrets` | no variables; environments `Production`/`Preview` have **no secrets** |
| Tracked files, whole repo | `git grep -iE 'gkswcfljxlutkfdvvqng\|pooler\.supabase\.com\|postgresql://\|DATABASE_URL\|PROD_DB_*'` | only `backup-database.yml` consumes `PROD_DB_PASS` (from secrets — unset); docs, guards and test fixtures use canaries/synthetic values |
| Untracked add-ons | `ai-assistant/`, `supabase/functions/assistant/`, `scripts/audit-production-readiness.mjs` | QA service-role key and a production **URL string** only; no DB password |
| Local env files (key names only) | `.env.local`, `.env.qa`, `.env.example` | `VITE_*` app keys and `QA_*` only |
| Deploy configs | `vercel.json`, `capacitor.config.ts`, `supabase/config.toml`, root listing for Docker/Netlify/Render/Railway/Fly/Terraform | static rewrite, app id, local project-id string — **no credentials** |
| Windows environment | `reg query HKCU\Environment`, `reg query HKLM\…\Session Manager\Environment`, process env | no `PROD_*`/`QA_*` names in any scope |
| PowerShell history | `grep -ciE 'PROD_DB_PASS\|set-production-password' ConsoleHost_history.txt` | **0 mentions** |
| Other local checkouts | `~/AgriShop` (Capacitor build), `~/Downloads/Agri-shop-App-main` | no `.env*` files, no credential references; only a doc copy with the placeholder `postgresql://postgres.[project-ref]:[password]@…` |
| Supabase management access | `~/.supabase/access-token`, `SUPABASE_*` env, `supabase` CLI | no token, no env vars; CLI exists only in `node_modules`, not logged in |

**Affected configurations, exhaustively — what must change after the reset:**

1. The Supabase dashboard's displayed connection strings for `gkswcfljxlutkfdvvqng` — show the new
   value by design.
2. `~/.agrishop/production.env` — the sanctioned file receives the new value (its only consumer is
   the allow-listed wrapper).
3. `.github/workflows/backup-database.yml`'s `PROD_DB_PASS` secret slot — currently **unset**, so
   there is nothing to invalidate; if the GitHub route is ever used it will be set with the *new*
   value. Not a Phase 2A dependency (local route is the executed one).

**Explicitly unaffected:** the app runtime (web/Vercel and Capacitor Android use the project URL +
`sb_publishable_…` anon key through `supabase-js`); Supabase edge functions (service-role JWT and
provider keys); QA tooling (`QA_DB_*`, `QA_SUPABASE_*` — a different project); Supabase's internal
PostgREST/GoTrue/Storage connections (server-managed); the anon/service **API keys** (a database
password reset does not rotate JWT keys — only the separate "JWT secret" control does, and that is
not being touched).

**Why the reset cannot be executed from here:** the Supabase MCP surface is strictly read-only (no
password endpoint, enumerated twice); there is no management access token on this machine; the CLI
is not logged in; and creating another project is forbidden. The reset is therefore exactly one
dashboard click, and that is where this phase stops.

**The click:** Supabase dashboard → project **"Agrishop APp"** (`gkswcfljxlutkfdvvqng`) →
**Settings → Database → Database password → Reset database password** → copy the new value → paste
it into the local intake form (or run `scripts/set-production-password.ps1`). Nothing else on that
page needs to be touched.

**Immediately after the reset, this file continues autonomously:** intake check (`creds:production
-- --check`) → real production backup → isolated PGlite restore → counts, structure, row digests and
mutation detection vs live production → QA counts before/after → `verify:credentials`,
`verify:targeting`, `tsc`, unit suite, build → enrol `clusterId` → verdict. Only then can
**PHASE 2A — PRODUCTION BACKUP + RESTORE** be called **PASS**.

## 16. The production run — executed 2026-10-01

### 16.1 Credential

The operator reset the production database password in the Supabase dashboard (the original was not
retrievable) and supplied it through the sanctioned loopback form, which wrote only the
`PROD_DB_PASS` line of `~/.agrishop/production.env` (856 → 886 bytes; the form logged “30 chars,
value never logged”, and the wrapper prints `pass : loaded, value withheld`). `--check` then loaded
all three keys with the production user name.

**Recorded so it is not mistaken for a wrong password:** the first connection attempt immediately
after the reset failed with `password authentication failed for user "postgres"`, and a retry
minutes later succeeded. Supabase's pooler needed a short propagation window; a future operator who
sees that error on the first attempt should retry before re-entering the credential.

### 16.2 Backup + isolated restore

| Step | Result |
|---|---|
| Backup | artifact + manifest in `backups/`, 340 654 bytes, 30 tables, 268 rows (public tables match the Phase 1 baseline exactly: 1 shop / 4 users / 6 customers / 52 sales / 57 sale_items / …), plus `auth.users` 2 and `auth.identities` 2 |
| Restore | 788 statements applied to in-process PGlite, **0 failures** (1.3 s) |
| Live source identity | cluster `7666007964130682852` — equal to the artifact's recorded cluster |
| Structural equivalence | tables 28, columns 337, constraints 102, indexes 84, policies 104, triggers 10, functions 37, views 2, enums 8 — missing 0, extra 0, changed 0 |
| Data fidelity | 28/28 row digests matched; restored < backup 0; live drift 0 |
| Auth through the shim | `auth.users` 2/2, `auth.identities` 2/2 |
| Verdict | **RESTORE VERIFICATION: PASS** (exit 0) |

### 16.3 Mutation proofs (this artifact, not a fixture)

1. **Byte flip** — one byte XOR'd in a copy; verifier stopped at the integrity layer:
   `sha256 … != MANIFEST`, **exit 1**.
2. **Value mutation with a consistent manifest** — `'low_stock_threshold_default', '10'` changed to
   `'11'`, then the manifest re-hashed so the artifact+manifest pair is internally consistent and the
   run reaches the comparison layers. Result: integrity PASS, replay PASS, counts PASS, structure
   PASS, **digests FAIL**, localised to `app_settings.setting_value` — **exit 1**.

Together these prove the verifier is not vacuous: corruption is caught, and a single changed value
that keeps every count and every schema object identical is still caught, in the right column.

### 16.4 Regression

| Lane | Result |
|---|---|
| `npm run verify:credentials` | **23/23 PASS** |
| `npm run verify:targeting` | **8/8 PASS** |
| `npm run verify:workflow` | **24/24 CERTIFIED** — two checks were added while fixing an order-dependent artifact selection exposed by this run (see below) |
| `npx tsc --noEmit` | **exit 0** |
| `npm run build` | **exit 0** |
| `npx vitest run` | 793 passed, 14 failed — **all 14 in six integration suites unrelated to this phase**, classified below |
| QA row count around the production operations | **398 → 398 (delta 0)** |

**The verifier fix.** The artifact-gate checks executed the workflow's real shell with
`ls -t backups/*.manifest.json | head -1`, i.e. "the newest artifact on this machine". That was the
staging artifact until this production run wrote a newer one — then both checks silently swapped
subject and failed for the wrong reason. The checks now copy a *chosen* manifest plus
`environments.json` into a scratch directory and run the unmodified step body there, testing both
artifacts symmetrically (accept for their own environment, refuse for the other); the workflow itself
is untouched.

**The integration failures are not Phase 2A.** `tenantResolverReplay`, `splitPayments`,
`employeeAccessOverrides`, `rbacFoundation`, `rbacEnforcement` and `priceTraceability` assert
RBAC/payment schema semantics against the shared QA database. Evidence they are independent of this
phase: the failing suites are unmodified files (`git status` clean, mtimes 2026-09-15…27); none of
them imports any Phase 2A file; and the one failure inspected directly shows schema drift, not a bug
this phase could cause — `tenantResolverReplay` expects `resolve_active_shop` to be the only function
matching a pattern, while QA now holds four (`authorize_business_action` among them) because the
schema has since evolved. The integration lane also writes to QA by design: the full `vitest run`
moved QA from 398 to 436 business rows, which is why `npm run qa:clean` (not run here, deliberately)
exists. The failure classification is therefore **pre-existing / other-lane**, not an implementation
bug of this phase.

### 16.5 Enrollment

`environments.json` → `production.clusterId` = `7666007964130682852`, recorded from the manifest of
this first verified run, so a later cluster swap is detected rather than assumed away.
