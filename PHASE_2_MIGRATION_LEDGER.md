# Phase 2 — the migration ledger: applied-migration record, replay/safety verification

**Date:** 1 October 2026 · **Verdict: ✅ PASS** (staging + local replay target) · **Production:
untouched, and deliberately not a target.**

This is the task both Phase 1 documents converged on
(`PHASE_1_PRODUCTION_SAFETY_GATES.md` §G item 2, `PHASE_1_GATE_CLOSURE.md` "Phase 2 readiness" item
5, `PRODUCTION_READINESS_AUDIT.md` B5): *make the migration system real — a ledger that records
every applied file, a replay check in CI, and the two odd filenames normalised.*

**Constraints honoured.** Phase 2A (`PHASE_2A_BACKUP_RESTORE.md`) and the RBAC fix (migration `0175`)
were not reworked: the Phase 2A tooling is byte-identical, and `0175` is untouched. No new Supabase
project or environment was created. Production was not contacted — the tool refuses it by policy
before it opens a connection. QA/staging was returned to the canonical clean baseline afterwards.

---

## 1. What was wrong, from primary sources

| Fact | Measurement (before) |
|---|---|
| Migration files in the repository | **167** |
| Rows in `supabase_migrations.schema_migrations` on staging | **3** (`0009`, `0010`, `0011`) |
| Files recorded with a hash | **0** — and the table had no way to store one |
| Way to apply a migration | `scripts/deploy-migrations.mjs` — `client.query(file)`, **recording nothing** |
| Non-canonical filenames | `0042b_security_rls_fix.sql`, `20260903_credit_limit_requests__reminder_groups.sql` |

The consequence is exactly the audit's B5: after any deploy the database could not say what had been
applied to it. The second filename made a naive replay wrong as well — `20260903` sorts **after**
every `0NNN` file, so a directory listing would have applied it last, long after `0062` re-creates
the same table.

## 2. The two filenames, normalised

**`0042b_security_rls_fix.sql` → merged into `0042`.**
The file is the direct follow-up to `0042`: it *undoes* the anon-SELECT block that `0042`'s second
body introduced (its own header says so, and `8d82a499` — "customer creation broken by 0042b RLS" —
is the incident). It is now the third body of
`0042_security_rls_hardening__security_rls_hardening_deploy__security_rls_fix.sql`, in application
order, following the convention `914d0c93` established for collisions. A suffix is not a version: it
cannot be produced by `supabase migration new`, it is not a timestamp, and it sorts between `0042`
and `0043` only by accident.

**`20260903_credit_limit_requests__reminder_groups.sql` → `0060_…`.**
Provenance: added 2026-09-04 (`ba0e2144`) when the sequence's highest number was `0034`; merged from
two colliding twins in `914d0c93`; and `0062`'s own header says *"Migration 20260903 was never
deployed"*. `0060` is the only free slot between `0035` and `0062`, and it is order-neutral by
inspection: **no file between `0035` and `0059` references `credit_limit_requests` or
`reminder_configs.group_id`** (grep), and the first file that needs the table is `0062`
(`deploy_credit_limit_requests`). Nothing to touch depends on the old position; nothing that
depends on the new one breaks.

Both retired names are recorded in `LEGACY_VERSION_ALIASES` (`scripts/lib/migrations.mjs`), so a
database that *did* record `0042b` or `20260903` — an old preview branch, say — is reported as
`reconciled old version names`, not as a mismatch. Neither live ledger has such a row.

## 3. The tool

`scripts/migrate.mjs` (+ `scripts/lib/migrations.mjs`, `scripts/lib/sql-statements.mjs`).
`scripts/deploy-migrations.mjs` — the unrecorded path — is now a refusal that prints the new commands,
so the bypass cannot be used by habit.

| Mode | Does | Writes? |
|---|---|---|
| `status` | directory vs ledger as a table | never |
| `verify` | the CI check: fails on any difference class below | never |
| `adopt` | records the *existing* directory against a database already at that state (`source = 'adopted'`), with per-file object evidence | dry run unless `--apply` |
| `apply` | applies pending files in canonical order; **each file and its ledger rows commit in one transaction** | dry run unless `--apply` |

**Ledger schema.** `supabase_migrations.schema_migrations` (CLI-compatible: `version`, `name`,
`statements`) plus `supabase_migrations.schema_migration_files` (`version`, `filename`, `sha256`,
`bytes`, `source`, `applied_at`, `applied_by`). The second table is additive; the CLI's table keeps
its own shape so `supabase migration list` remains meaningful.

**Difference classes `verify` fails on:** a file with no ledger row (`pending`), a recorded version
with no file (`ledger-only`), a file whose sha256 differs from the one recorded when it was applied
(`changed after it was applied`), a recorded version with no hash (`recorded without a hash`), a
non-canonical or duplicate version, and a pending file whose version sorts before the newest recorded
one (`ORDER HAZARD`).

**Refusals, all fail-closed:** production (`--env production`, before connecting, for reads *and*
writes — production's schema does not match this directory and what it needs is §D's decision);
no target at all; `--apply` while the directory breaks its grammar;
an out-of-order apply; and an apply while any recorded row lacks a hash.

## 4. The grammar, guarded

`tests/unit/migrationReplayability.test.ts` gained: one canonical four-digit version per file,
filename order equals version order, no file under a retired version name, every alias target
present, and *the directory can be recorded exactly as it stands* (no pending, no drift).
`tests/unit/migrationLedger.test.ts` (new) holds the pure logic to fixtures: each of the three
grammar failures, each difference class **and** the exact-agreement case (a check that only ever
fires is as useless as one that never does), the order hazard in both directions, adoption evidence
parsing, and the statement splitter on dollar-quoted bodies and semicolons inside strings.
Unit lane: **43 files / 443 tests passed** (`backups/unit-after-ledger.log`), up from 42/421.

## 5. CI

`.github/workflows/build-apk.yml`, test job, after the QA reachability check:

```yaml
- name: Verify the migration ledger matches the directory
  run: node scripts/migrate.mjs verify --env staging
```

Read-only. It fails the job if the directory and the ledger disagree — the check that would have
caught a 3-row ledger against a 167-file directory on the day it happened.

## 6. Evidence — staging (live)

| # | Check | Result | Artefact |
|---|---|---|---|
| Q1 | `status` before adoption | 167 files, ledger 3 rows, **164 pending + 3 without a hash** | `backups/proof-Q1-status-before.log/.json` |
| Q2 | `verify` before adoption | **FAIL, exit 1, 167 problems** — the tool reproduces the B5 defect | `backups/proof-Q2-verify-before.log/.json` |
| Q3a | `adopt` dry run | 167 of 167 need a row or a hash; **nothing written** | `backups/proof-Q3a-adopt-dry.log` |
| Q3b | `adopt --apply --attest 0175` | **167 recorded**; object evidence 139 confirmed, 2 with unconfirmed objects, 26 with no declarable objects | `backups/proof-Q3b-adopt-apply.log/.json` |
| Q4 | `verify` after | **PASS, exit 0** — "every file recorded, every record has a file, every hash matches" | `backups/proof-Q4-verify-after.log/.json` |
| Q5 | `apply --apply` again | **"Nothing to apply", exit 0** — re-applying a recorded file is a no-op | `backups/proof-Q5-noop.log/.json` |
| Q6a | `verify` with `0175` removed from a scratch dir | **FAIL** — `ledger-only 0175` | `backups/proof-Q6a-missing.log/.json` |
| Q6b | `verify` with a new `0176` in a scratch dir | **FAIL** — `pending 0176` | `backups/proof-Q6b-extra.log/.json` |
| Q6c | `verify` with `0174` edited after adoption | **FAIL** — `changed after it was applied 0174` | `backups/proof-Q6c-changed.log/.json` |
| Q6d | `verify` / `apply` with a `0008` in a scratch dir | verify **FAIL** (`ORDER HAZARD: 0008 sorts before 0175`); apply **REFUSED, exit 2**, nothing applied | `backups/proof-Q6d-hazard.log`, `backups/proof-Q6d2-apply-refusal.log` |
| Q7 | `status --env production` | **REFUSED, exit 2**, before any connection | `backups/proof-Q7-production-refusal.log` |
| Q0/Q6 | `qa:count` around every read-only mode | **392 → 392** (unchanged) | `backups/proof-Q0-count-before.log`, `backups/proof-Q6-count-after.log` |

**Independent read-back** (not the tool's own claim), read-only against staging after adoption:
`167` rows in `schema_migrations`, `167` in `schema_migration_files`, `167/167` sha256 matching
`^[0-9a-f]{64}$`, all `source = 'adopted'`, `0009` … `0175`, and **zero** rows whose CLI `name`
differs from the file name. `statements` recorded for `0175`: 1.

## 7. Evidence — the local replay target (throwaway Postgres, PGlite)

| # | Check | Result | Artefact |
|---|---|---|---|
| L1 | `status`, 3-file corpus | 3 pending, ledger absent | `backups/proof-L1-status.json` |
| L2 | `apply --apply` | 3 applied, each recorded in one transaction | `backups/proof-L2-apply.json` |
| L4–L5 | apply, then `verify` against the same on-disk PGlite state | **apply 3/3, verify PASS** | `backups/proof-L4-apply.log`, `backups/proof-L5-verify.log/.json` |
| L6 | `apply --apply` again | **"Nothing to apply"** — replay is idempotent | `backups/proof-L6-noop.log/.json` |
| L7 | `verify` with one applied file edited | **FAIL** — `changed after it was applied 0001` | `backups/proof-L7-changed.log/.json` |
| L8 | `apply` with a `0000` pending while `0001–0003` are recorded | **REFUSED, exit 2** | `backups/proof-L8-order.log/.json` |
| L9 | `apply` on a directory with a duplicate version | **FAIL, exit 1**, nothing applied | `backups/proof-L9-duplicate.log` |
| L3 | **atomicity**: file 1 valid, file 2 valid-then-failing, in one run | file 1 recorded; file 2 **rolled back** — "after rollback: ledger row = absent, declared objects present = 0/1" (the object it created in statement 1 is gone) | `backups/proof-L3-rollback.log/.json` |

L3 is the proof that "applied" and "recorded" cannot disagree: the ledger row and the file's effects
are the same transaction, read back from the same process after the rollback.

## 8. What is deliberately NOT claimed

1. **A from-scratch replay is still impossible, and this task did not fake one.** The directory is a
   patch set on top of a provisioned database — no file creates `users`, `products`, `customers`,
   `shops` or `sales`; `0009`'s first statement is `ALTER TABLE users …`. `migrationReplayability.test.ts`
   already documents that (and guards it: if a base table ever appears, that test fails so the
   strategy is re-decided rather than inherited). The "replay check" this phase ships is therefore
   the ledger/order/hash verification, the atomic ordered `apply`, and CI running `verify` —
   **not** a claim that the directory provisions an empty Postgres.
2. **Measured, and not used as a gate:** loading the accepted production artifact into PGlite
   replays cleanly (788 statements, 0 failures — the Phase 2A result), but applying the *directory*
   forward onto it fails in **29 of 168 files / 70 statements** (`backups/exp-replay-prod.mjs`
   output). Some failures are PGlite environment gaps (`storage` schema, `pgcrypto`) and some are
   real lineage divergence — production's schema was built by hand and the ledger's `0016` is not
   where it actually is. That is a finding *for* the schema-strategy decision, and it is why
   production is not a target of this tool. It is not evidence that the directory is broken.
3. **Two adopted files carry an unconfirmed caveat** (recorded, not silently passed): `0015`
   declares `product_variants_public`, which does not exist in staging (the audit's B3), and `0019`
   declares `reject_shop_request`, `shops.onboarding_completed` and `shops.onboarding_step`, none of
   which exist. Adoption records what the directory contains; the object evidence says plainly that
   these were not confirmed.
4. **Adoption is not proof of history.** It records the existing 167 files with their hashes,
   `source = 'adopted'`, and requires `--attest 0175`. What becomes real from that moment is drift
   detection: any edit, addition or deletion of a migration file is now detectable, and every file
   applied from here is recorded by the same transaction that applied it.
5. **Browser E2E lanes were not run** for this change (Playwright browsers are not installed locally
   and no dev server is running): **UNKNOWN**, recorded as UNKNOWN, not converted to PASS. The
   affected contracts are covered by the integration lane, which is real-browser-free by design.

## 9. Regression (all after the changes above)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 (`backups/tsc-after-ledger.log`) |
| `npm run build` | exit 0, built in 3.79s (`backups/build-after-ledger.log`) |
| Unit lane | **43 files / 443 tests passed** (`backups/unit-after-ledger.log`) |
| Integration lane | **33 files / 393 tests passed, 0 failed** (`backups/integration-after-fixes.log`) |
| `npm run verify:workflow` | **24/24 CERTIFIED** (`backups/verify-workflow-after-ledger.log`) |
| `npm run verify:targeting` | 8/8 cases pass (`backups/verify-targeting-after-ledger.log`) |
| `npm run verify:credentials` | 23/23 checks pass (`backups/verify-credentials-after-ledger.log`) |
| `npm run preflight` | OK — fixtures 4/4, business rows 0 (`backups/preflight-after-ledger.log`) |
| `npm run migrate:verify` | **PASS** (`backups/npm-migrate-verify.log`) |
| `npm run qa:clean` | 448 → **0 business rows**, "✅ CLEAN" (`backups/qa-clean-run.log`) |

### The three stale integration tests (fixed here, per `PHASE_2_INTEGRATION_TRIAGE.md` §6)

| Suite | Was | Fix | Now |
|---|---|---|---|
| `splitPayments` | 8 failures — `record_customer_payment` called over raw SQL with a payload `actorId`; 0112 removed that trust | call the RPC through the real JWT path (`execRpcAsUser`), with the fixture admin `getAuthClient()` self-heals | **12/12 pass** |
| `priceTraceability` | whole file skipped — fixture sent `baseUnit: 'piece'`, which 0158/0161 reject | fixture sends `kg`, the current contract | **7/7 pass** |
| `tenantResolverReplay` | 1 failure — pinned the exact list of functions containing `ORDER BY m.created_at ASC` | assert the *property*: the shape must belong to `resolve_active_shop`, and a caller-scoped function containing it must ask the chain first | **6/6 pass** |

No business rule was changed for any of the three. The third was proved non-vacuous by injection:
a temporary `zz_proof_bad_resolver` on QA made it fail with the intended message
(`backups/FIX2-tenantResolverReplay-injected.log`); it was dropped and the suite re-ran green. That
injection also *found a real hole* — the discovery query used a case-sensitive `LIKE`, so a
lower-case reintroduction of the pattern would have been invisible; it is now `ILIKE`.

## 10. Final state of QA

Canonical clean baseline, verified independently of the cleaner's own output: **0 business rows**,
**4 fixture accounts** (`Shop Owner`, `Sales Employee`, `QA Admin`, `QA Employee`), `users` 4,
`shops` 2, `auth.users` 3, `auth.identities` 5, `sales`+`customers`+`products`+`customer_payments`+
`audit_events` = 0, and the ledger intact at **167 + 167** rows. No proof function left behind.

## 11. Files

**Added:** `scripts/migrate.mjs`, `scripts/lib/migrations.mjs`, `scripts/lib/sql-statements.mjs`,
`tests/unit/migrationLedger.test.ts`, this report.
**Changed:** `supabase/migrations/0042_…__security_rls_fix.sql` (merged; replaces
`0042_…deploy.sql` and `0042b_security_rls_fix.sql`), `supabase/migrations/0060_…` (renumbered;
replaces `20260903_…`), `scripts/deploy-migrations.mjs` (retired → refusal), `package.json`
(`migrate`, `migrate:status`, `migrate:verify`), `.github/workflows/build-apk.yml` (CI step),
`tests/unit/migrationReplayability.test.ts`, `tests/integration/splitPayments.test.ts`,
`tests/integration/priceTraceability.test.ts`, `tests/integration/tenantResolverReplay.test.ts`,
`docs/RECOVERY.md`, `PRODUCTION_READINESS_AUDIT.md`, `PHASE_2_INTEGRATION_TRIAGE.md`.
**Untouched:** everything Phase 2A, `supabase/migrations/0175_a_denial_still_denies.sql`, production.

## 12. Verdict

**PASS** for the task as scoped: the ledger is real (167/167 recorded with hashes, adopted, and
independently read back), the replay/safety check exists and is non-vacuous in **both** applicable
environments (staging: FAIL before → PASS after, plus four detection proofs read-only; local
Postgres: apply, idempotent re-run, atomic rollback, and three refusals), CI runs it, the grammar is
enforced and guarded, the three stale tests are fixed without touching a business rule, and the
regression is green with QA back at its canonical baseline. Production was never contacted.

**Next (per `PRODUCTION_READINESS_AUDIT.md` §D, in order):** the database security fixes as
migrations after `0175`, each now recorded by the ledger — the first two are in §13 below, three
remain (create `product_variants_public` and tighten `product_variants_select`; scope
`audit_events_insert` to the actor's shop; scope `user_permissions_insert` to the target's shop) —
and deleting the 25 unmanaged harnesses while lowering the ratchet in
`tests/unit/productionReachGuard.test.ts`.

---

## 13. The ledger's first forward applications — audit §C items 5 and 6

With the ledger real, the next unblocked task runs through it instead of through `run_sql`, and the
record is written by the transaction that applies the file.

**`0176_no_anonymous_writes.sql`** (audit §C item 5). Measured before: **34 of 54** public tables
granted `anon` INSERT/UPDATE/DELETE and `anon` held CREATE on the schema. `anon` is the key that
ships inside the app bundle, so each of those was a write path resting on RLS alone. After: **0**
tables, `anon` CREATE false, and `authenticated`'s 105 write-grant rows **unchanged** (the app writes
as the signed-in user). SELECT was deliberately not touched.

**`0177_a_definer_knows_where_it_looks.sql`** (audit §C item 6). Measured before: exactly three
SECURITY DEFINER functions had no pinned `search_path` — `get_authenticated_user_id()`,
`get_my_shop_request(text)`, `process_reminders()`. Each body was read first (saved as
`backups/def-*.sql`): their references are `public` objects or fully qualified (`auth.uid()`,
`auth.users`), so `public` is the whole path they need. After: **0** unpinned definer functions, and
all three still execute (`get_my_shop_request('923001234567')` → `{found:false}`,
`get_authenticated_user_id()` → null without a JWT, `process_reminders()` → void on a clean QA).

| Evidence | Result | Artefact |
|---|---|---|
| Ledger `apply` of both files | 2 applied, each recorded in the same transaction as `source = 'applied'` | `backups/proof-Q8-apply-0176-0177.log/.json` |
| Privilege matrix before / after | anon write grants **34 → 0**; anon CREATE **true → false**; unpinned definer functions **3 → 0**; authenticated writes 105 → 105 | `backups/grant-before-0176.log`, `backups/grant-after-0176.log` |
| Anon boundary, through PostgREST with the anon key | INSERT/UPDATE/DELETE all refused `42501 permission denied`; the pre-login read (`shop_requests`) still works; a read never granted (`shops`) still refused; **`insert_shop_request` as anon still succeeds** (SECURITY DEFINER), proof row removed | `backups/anon-boundary-proof.log` |
| Regression after both | unit **43 files / 449 tests**, integration **33 files / 393 tests**, 0 failures; `tsc` and `build` exit 0 | `backups/unit-final.log`, `backups/integration-after-0176-0177.log`, `backups/tsc-final.log`, `backups/build-final.log` |
| Ledger `verify` | **PASS**, 169 files ↔ 169 rows | `backups/verify-final.log` |

### The `changed after it was applied` state, and `reconcile`

Applying `0176` and then editing it (a comment needed to keep the replay guard's split-identifier
heuristic from false-positiving on a bare `loop` line) produced the ledger's first real
`changed after it was applied` — **by accident, and it was correct**: `verify` failed, exit 1, until
the file was accounted for (`backups/proof-Q10-verify-after-edit.log`).

That state needed a way out that is not "edit the ledger", so `scripts/migrate.mjs reconcile` was
added: it re-records the hash of an applied file **only** when the file's statements normalise to
exactly what the ledger recorded (comments and whitespace aside), it requires `--reason`, and it
records that the re-recording happened (`reconciled_at`, `reconcile_note`).

| Evidence | Result | Artefact |
|---|---|---|
| Cosmetic edit, dry run | "ignoring comments and whitespace: identical", nothing written | `backups/proof-Q11-reconcile-dry.log` |
| Cosmetic edit, `--apply` | new hash + reason recorded; `verify` **PASS** again | `backups/proof-Q11b-reconcile-apply.log`, `backups/proof-Q12-verify-reconciled.log` |
| **Semantic** edit (a scratch copy of `0177` whose pinned `search_path` was changed), `--apply` | **REFUSED**, exit 1: "differs from what was applied by more than comments and whitespace … write the change as a new migration"; `verify` on the real directory stayed PASS, so nothing was written | `backups/proof-Q13-reconcile-refusal.log/.json`, `backups/proof-Q14-verify-after-refusal.log` |
| Independent read-back of the ledger | 169 rows (2 `applied`, 167 `adopted`), 169 hashed, 1 reconciled, with its note | read-only query, recorded in this section |

Unit coverage for the new decision: `classifyReconciliation` accepts comment-only and re-wrapped
edits, and refuses a changed statement, a removed statement, and a file with nothing recorded to
compare against (`tests/unit/migrationLedger.test.ts`).

**Still open from the audit's security group:** `product_variants_public` (with the tightened
`product_variants_select`), `audit_events_insert`, and `user_permissions_insert`. They are policy
changes with real product behaviour behind them (the employee catalogue, the audit trail, admin
permission editing), so they get their own change set and their own verification rather than being
appended to this one.

---

## 14. Batch 2 of the production gap, through the same ledger — 2026-10-17

`docs/PRODUCTION_MIGRATION_PLAN.md` §4 batch 2 is two files: `0207` (the relations half, extracted
schema-only from the accepted staging baseline) and `0208` (the function half — the 46 client RPCs
production lacks, the 16 functions their bodies call, the 7 relations and 28 columns those bodies
read). Both were verified against production's own frozen baseline *and* staging's before either was
recorded anywhere (`PASS, 2 files, 235 statements, 0 sql failures` on each), and rehearsed on the real
Supabase engine (`PASS`, agreeing with PGlite). This section is the ledger half of that record.

```
$ node scripts/migrate.mjs apply --env staging          # dry run
  Pending: 2 file(s) … Nothing was applied. Re-run with --apply to apply them.
$ node scripts/migrate.mjs apply --env staging --apply
  ✓ 0207 … (76 statement(s), recorded)
  ✓ 0208 … (159 statement(s), recorded)
$ npm run migrate:verify
  Ledger: 200 row(s) in schema_migrations (+ file hashes)
  Directory and ledger agree exactly: every file recorded, every record has a file, every hash matches.
  VERIFY: PASS
```

The ledger moved **198 → 200 rows**, each recorded by the same transaction that applied the file, and
the dry run is quoted because it is what makes the recorded run meaningful: the tool refused to write
until asked. On QA these two files are **no-ops with an effect on the record only** — every object they
carry already exists there, which is why staging's own baseline replay passed with 0 failures before
the apply and why nothing in QA's schema changed when it ran. What the apply buys is the thing a QA
environment is for: the *recorded* path production will take (file + ledger row, one transaction) is
exercised on a live project before it is used on the one that matters, and its hashes are now pinned
in a ledger that `verify` reads back on every run.

| Evidence | Result | Artefact |
|---|---|---|
| Batch verification, production's baseline | **PASS** — 2 files, 235 statements, 0 sql failures, 268 data statements counted and skipped | `backups/baseline-prod-batch2-verified.json` |
| Batch verification, staging's baseline | **PASS** — same counts, 2267 data statements counted and skipped | `backups/baseline-staging-batch2-verified.json` |
| Real-engine rehearsal, both baselines | **PASS** — 235 statements, 0 failures, `vs PGlite: AGREES` | `backups/rehearsal-batch2-{production,staging}.json` |
| Post-state, asked of the rehearsed engine | client RPCs missing **46 → 0**; unreachable by `authenticated` **0**. The `anon` column this row used to carry (**5** discrepancies) was withdrawn on 2026-10-17: neither baseline artifact contains a `GRANT` or a `REVOKE`, so a scratch database measures PostgreSQL's PUBLIC default rather than any environment. Asked where ACLs exist — live QA, 23 names — **1 of 23** is executable by `anon` (`delete_role`, which the ledger's contract also leaves to PUBLIC), and `authenticated` can execute all 23. Production's privileges remain **unmeasured** | `device-evidence/production-gap-measured-2026-10-16.md` §3c |
| Ledger `apply` on QA | 2 applied and recorded in one transaction each; 198 → 200 rows | quoted above |
| Ledger `verify` on QA | **PASS** — 200 files ↔ 200 rows, every hash matches | quoted above |
| QA's live schema after the apply | functions **62 of 62**, relations **7 of 7**, columns **28 of 28**; the 46 client RPCs `authenticated` cannot execute: **0**; both ledger rows present | read-only `run_sql` over the HTTP API, recorded in §14 above |
| Regression after the apply | unit **75 files / 976 tests**; integration **12 files / 159 tests** targeted at tenant and branch isolation, RBAC, membership and permissions (two of the files re-run after the apply); browser **27 tests** in real Chrome (branch responsibility EN+UR, branch flow corrections EN+UR, branch removal, role-in-use deletion, session refresh, RTL/LTR, retry-after-timeout) — 0 failures, `tsc` and `build` exit 0 | `npm run test:unit`, the targeted suite runs, the Playwright runs |

**Production was not contacted.** Its ledger still reads `8 / 0016`, no file in this batch has been
applied there, and the apply path remains an owner act (`docs/PRODUCTION_MIGRATION_PLAN.md` §7.1).

---

## 15. The ACL closure the re-issue made necessary — `0215` — 2026-10-17

**What failed, and where.** After `0209`–`0214` were applied to hosted QA, the repository's own
live-schema guard failed:

```
FAIL  tests/integration/rbacInvariants.test.ts > Invariant B — no tenant write RPC is executable by anon
AssertionError: expected [ …(9) ] to deeply equal []
+ [ "approve_credit_limit_request_v2", "archive_company", "create_company", "create_role",
+   "delete_my_account", "delete_product_barcode", "delete_role",
+   "reject_credit_limit_request_v2", "update_role" ]
```

§14's row above is not wrong: at that measurement — before the re-issue — **1 of 23** app-called
functions was `anon`-executable (`delete_role`). `0214`'s ACL pass then re-applied *every* ledger ACL
statement after the last create, which re-established the eight `anon` grants `0208` had reproduced from
staging's catalog. Reproducing an environment and enforcing least privilege are different rules, and only
the second one is a security property.

**The correction is a new file, not an edit.** `0215_a_write_rpc_is_not_for_an_unauthenticated_caller.sql`
(1 statement) revokes `PUBLIC, anon` EXECUTE from every function on the write surface — the same regex
and the same pre-session allow-list as the live guard — grants `authenticated`/`service_role` back,
closes trigger functions to every API role, and raises if anything on the surface is still reachable.
`0208` and `0214` are applied and stay byte-identical.

```text
$ node scripts/verify-forward-on-baseline.mjs --baseline production --files <batch 1+2 + 0209–0215>
  SUMMARY PASS: 20 files, 446 statements, 0 sql failures, 0 env-gap failures
$ node scripts/verify-forward-on-baseline.mjs --baseline staging --files <0207–0215>
  SUMMARY PASS: 9 files, 396 statements, 0 sql failures, 0 env-gap failures
$ node scripts/migrate.mjs apply --env staging --apply
  Pending: 1 file(s)
  ✓ 0215_a_write_rpc_is_not_for_an_unauthenticated_caller.sql (1 statement(s), recorded)
$ node scripts/migrate.mjs verify --env staging
  Ledger: 207 row(s) in schema_migrations (+ file hashes)
  Directory and ledger agree exactly: every file recorded, every record has a file, every hash matches.
  VERIFY: PASS
```

**Post-state, measured on QA by privilege, not by reading the file** (`has_function_privilege`, read
only):

| Question | Answer |
|---|---|
| Functions on the write surface | **51** |
| Of those, executable by `anon` | **0** (was 9) |
| The nine, individually | `anon` false, `authenticated` true — all nine |
| `insert_shop_request` / `lookup_user_by_phone` (pre-session) | still executable by `anon` |
| Trigger functions executable by `anon` or `authenticated` | **0** |
| Real RPCs on the surface executable by `authenticated` | **49 of 51**; the two it cannot call are trigger functions, by design |
| `rbacInvariants.test.ts` after the apply | **8/8 PASS**, Invariant B included |

**Production is unchanged.** Its ledger still reads `8 / 0016`; the closure reaches it only if the batch
is applied there, and the pre-apply measurement that would confirm the starting state is
`device-evidence/production-acls-measured-2026-10-17.md` (all 37 functions `anon`-executable today).

### 15a. The second closure — `0216`, the people table — 2026-10-17

`0215` closes functions. The read-only measurement of production also found `anon` holding
INSERT/UPDATE/DELETE on four **tables** (`audit_events`, `customer_payments`, `stock_adjustments`,
`users`). Three of those the batch already closes — `0212` re-applies `0195`'s
`REVOKE INSERT, UPDATE, DELETE, TRUNCATE` on the money tables, `0213` replaces `audit_events`' legacy
always-true policy and installs `audit_events_no_client_writes … with check (false)` — but nothing in the
range names `public.users`, and hosted QA measures `anon` false there only because its grants were built
by the migrations while production's were made out of band. A privilege a migration never granted cannot
be closed by one that does not name it.

`0216_an_unauthenticated_caller_cannot_write_the_people_table.sql` (1 statement) revokes
INSERT/UPDATE/DELETE/TRUNCATE on `public.users` from `anon`, leaves `authenticated` untouched (the app
edits profile rows directly — `src/lib/auth.ts`, the settings screens, `stores/employeesStore.ts` — so
narrowing that role is a product change, not a hardening), and compares the before/after readings of both
roles rather than hard-coding them, so it applies on a schema with no grants at all.

```text
$ node scripts/verify-forward-on-baseline.mjs --baseline production --files <batch 1+2 + 0209–0216>
  SUMMARY PASS: 21 files, 447 statements, 0 sql failures, 0 env-gap failures
$ node scripts/verify-forward-on-baseline.mjs --baseline staging --files <0207–0216>
  SUMMARY PASS: 10 files, 397 statements, 0 sql failures, 0 env-gap failures
$ node scripts/migrate.mjs apply --env staging --apply
  ✓ 0216_an_unauthenticated_caller_cannot_write_the_people_table.sql (1 statement(s), recorded)
$ node scripts/migrate.mjs verify --env staging
  Ledger: 208 row(s) in schema_migrations (+ file hashes)
  Directory and ledger agree exactly: every file recorded, every record has a file, every hash matches.
  VERIFY: PASS
```

**Still open, and deliberately not guessed at:** production's `users` table carries an always-true policy
and `authenticated` holds INSERT/UPDATE/DELETE there, so which ROWS a signed-in principal may edit is an
owner decision (plan §9.9). `0216` removes the half that has no product meaning.

### 15b. The widening `0215` introduced, and `0217` — 2026-10-17

`0215` closed `anon` and, in the same statement, granted `authenticated` EXECUTE on every function on
the write surface — a widening, which §6 forbids. It was found the same way as 15's defect, by the
repository's own guards running against QA:

```
FAIL tests/integration/saleIdempotency.test.ts
     4. the unchecked implementation is not reachable from an authenticated client
FAIL tests/integration/tenantResolverReplay.test.ts > the chain is internal
     anon and authenticated cannot execute the resolvers → [ 'create_shop_internal' ]
```

`0217_a_retired_function_is_not_for_the_client.sql` (1 statement) revokes `PUBLIC, anon, authenticated`
from the ledger's fifteen server-only functions, each inside an existence test, and raises if any is
still reachable. Its list is read from the ledger by `tests/unit/writeRpcAnonGuard.test.ts` in both
directions, so a newly retired function cannot be missed and a stale name cannot sit in the file.

`0215` itself keeps its recorded effect and its file; the only edit to it after the apply was white —
`LOOP` moved onto the preceding line so the repository's identifier-split guard can read the file. That
edit was recorded through `migrate reconcile`, which first proved it: *"Compared with the recorded
statements, ignoring comments and whitespace: identical"*, and stored the reason alongside the new hash.

```text
$ node scripts/migrate.mjs reconcile --env staging --version 0215 --reason "whitespace only: …" --apply
  Reconciled 0215: the new hash is recorded, with the reason.
$ node scripts/migrate.mjs verify --env staging
  Ledger: 209 row(s) in schema_migrations (+ file hashes)
  Directory and ledger agree exactly: every file recorded, every record has a file, every hash matches.
  VERIFY: PASS
$ node scripts/verify-forward-on-baseline.mjs --baseline production --files <batch 1+2 + 0209–0217>
  SUMMARY PASS: 22 files, 448 statements, 0 sql failures, 0 env-gap failures
$ node scripts/verify-forward-on-baseline.mjs --baseline staging --files <0207–0217>
  SUMMARY PASS: 11 files, 398 statements, 0 sql failures, 0 env-gap failures
```

**The lesson, again the same one:** a guard that asks one question answers one question. `0215`'s own
assertion asked "can `anon` reach the surface?", and the answer was correct while the file was still
wrong. What caught it was a *different* guard asking about `authenticated`, which is why the two live
integration guards are part of the acceptance test for this batch rather than a formality.

---

## 16. The Own-shop closures — `0218`, `0219` — 2026-10-17

Two policies, both decided by the owner rather than discovered: a permission override may only be
written for a person who belongs to the caller's shop, and a `users` row may only be read or written
inside the caller's shop. Both are applied to hosted QA and recorded; **production is untouched**.

| File | What it changes | Verified |
|---|---|---|
| `0218_permission_overrides_stay_in_their_shop.sql` | all three `user_permissions` policies now require a `memberships` row for the target in `current_shop_id()`; self-reads unchanged | 2 statements, 0 failures on both baselines; QA applied |
| `0219_the_people_table_is_its_own_shop.sql` | drops any policy on `public.users` whose expression is exactly `true`, installs the shop-scoped `users_select`/`users_insert`/`users_update` (plus self), asserts none survives | 2 statements, 0 failures on both baselines; QA applied |

```text
$ node scripts/verify-forward-on-baseline.mjs --baseline production --files <24-file batch>
  SUMMARY PASS: 24 files, 452 statements, 0 sql failures, 0 env-gap failures
$ node scripts/migrate.mjs apply --env staging --apply
  ✓ 0218 (2 statements, recorded)   ✓ 0219 (2 statements, recorded)
$ node scripts/migrate.mjs verify --env staging
  Ledger: 211 row(s)          VERIFY: PASS
```

**Behaviour on hosted QA, measured inside rolled-back transactions** (`set local role authenticated`,
JWT claims set to the owner of shop `1e5f7e4b…`, who is read-only relative to the other shop):

| Probe | Result |
|---|---|
| `user_permissions` insert for a member of **another** shop | **blocked** — `42501` row-level security |
| `user_permissions` insert for a member of the **own** shop | allowed, 1 row (rolled back) |
| `users` update of a row in another shop | 0 rows affected |
| `users` update of a row in the own shop | 1 row (rolled back) |
| `users` select of rows outside the active shop | 0 rows |
| always-true permissive policies left on `users` | 0 |

**One reconciliation, recorded rather than hidden.** `0219` was applied, then one line was rejoined
(`loop` + its `execute` on one line) so the replay guard does not read a bare keyword line as a split
identifier. `migrate.mjs reconcile` compared the statements ignoring comments and whitespace, reported
**identical**, and re-recorded the hash with that reason. The applied behaviour never changed.

---

## 17. QA's forward batch finishes — `0222`–`0231`, and two recorded divergences — 2026-10-18

QA's ledger stopped at `0221` while the repository carried ten more files. The batch was applied
through the tool, not by hand, and it exposed the two places where one directory genuinely cannot
describe two lineages. Both are now recorded in the ledger, with their reasons, rather than resolved
by editing an applied file.

```text
$ node scripts/migrate.mjs apply --env staging --apply
  ✓ 0222 (2 statements, recorded)   ✓ 0223 (2 statements, recorded)
  ✗ 0224 failed and was rolled back: column "outstanding_payable" does not exist
      after rollback: ledger row = absent, declared objects present = 4/4
```

`0224` is a **production-lineage repair**: it backfills `purchases.outstanding_payable` and
`purchase_items.cost_price`, legacy columns QA never had, and it adds `sale_submissions` plus the
three write RPCs the app calls. Measured on QA before deciding anything: `sale_submissions` exists,
and `create_sale` / `create_purchase` / `adjust_stock` all carry the `payload` parameter and the
`guard_operational_request(...)` call — the effect `0224` exists to produce is already there. The
remaining seven files were verified statement-by-statement inside a rolled-back transaction first
(all `OK`), then applied:

```text
✓ 0225   ✓ 0226   ✓ 0227   ✓ 0228   ✓ 0229   ✓ 0230   ✓ 0231
```

### The divergence record

`reconcile` covers a file whose statements are the same once normalised. These two cases are not
that, so `migrate.mjs diverge` records the difference itself — the version, one of two kinds, **both
exact hashes**, and a reason of at least 40 characters:

| Version | Kind on QA | Why | Recorded / on-disk |
|---|---|---|---|
| `0220` | `superseded` | QA applied the narrower staging variant on 2026-10-17; the repository now carries the bytes production recorded. The seeding is identical — the diff is the post-condition assertions: QA's asserts about the rows the file created, production's about every membership. QA legitimately held multi-shop memberships, so the wider assertion cannot run there. | `9817e2aa5a92…` / `270c81c1315c…` |
| `0224` | `not-applicable` | A production-lineage repair whose effect QA already holds and whose backfills reference columns QA never had. It was never run here, so it has no ledger row — which is exactly what this kind records. | *(none)* / `19a099b91438…` |

Neither record is an ignore list. Both hashes are stored, so the version stops being explained the
moment either side changes, and `verify` reports a stale record as a problem of its own. Every run
prints the divergences with their reasons:

```text
$ node scripts/migrate.mjs verify --env staging
  DIVERGED — recorded in the ledger, with a reason (2):
    0220 superseded (0220_the_rows_the_membership_model_needs.sql)
      QA applied the narrower staging variant …
    0224 not-applicable (0224_the_three_write_rpcs_a_caller_could_not_call.sql)
      0224 is a production-lineage repair …
  Directory and ledger agree exactly: every file recorded, every record has a file, every hash matches.
  VERIFY: PASS
```

**The record was proved non-vacuous against the real ledger**, not only in unit tests: appending one
comment line to `0220` made `verify` fail again with `changed after it was applied: 1` and
`divergence records that no longer describe this pair of files: 1` (exit 1); restoring the file
returned `VERIFY: PASS`. `tests/unit/migrationDivergenceGuard.test.ts` holds the same property for
both kinds, and for re-recording the ledger side.

### What QA holds after the batch

| Object | Check |
|---|---|
| `users.pin_failed_count`, `users.pin_locked_until` (`0231`) | present |
| `return_items.qty` mirror (`0227`) | skipped by its own guard — QA has only `qty_to_return` |
| `business_settings` / `customer_crops` / `reminder_configs` repairs (`0228`) | skipped by their own guards — QA carries the post-`0093` shape |
| retired mirror helpers (`0226`, `0229`) | absent, as intended |
| storage policies (`0230`) | `images public read` / SELECT, `images auth write` / INSERT |
| `anon` EXECUTE on `create_sale` (`0225`) | false |
| `anon` write grants in `public` | 0 (excluding `sale_submissions`, which `0225` narrows) |
| row counts after the batch | sales 2 · products 5 · memberships 14 · branches 7 — DDL only |

Production's ledger and database were **not touched** by any of this: no reconcile, no divergence
record, no apply.

### The batch found a live regression: `0232` restores the public door — 2026-10-18

The first CI run on the batch went green on the ledger step and red on the integration suites, in
three files at once, all with the same cause:

```text
view read failed: permission denied for view marketplace_listings   (42501)
```

`0223` narrowed `anon` to nothing across `public` — including `marketplace_listings`, whose `SELECT`
grant to `anon` is the ledger's own ACL (`0185` statement 13, re-issued by `0210` and re-applied at
the end of `0214`). The view is public **on purpose**: the farmer's own radius and the owner's
`marketplace_enabled` flag are the boundary, and `tenantBoundarySweep` says so in as many words
("`marketplace_listings` is readable by ANON on purpose"). `0223` is applied here and on production,
so the correction is a new file, not an edit:

| File | What it does | Verified |
|---|---|---|
| `0232_the_curated_view_is_the_public_door_again.sql` | restores `grant select on public.marketplace_listings to anon`; asserts anon can read it, holds no privilege on any other relation in `public`, and holds no write on the view | 2 statements; `anon` reads the view (`42501` gone) and `products`, `product_variants`, `shops`, `inventory_movements`, `sales` stay refused 5/5 |

`tests/integration/securityAudit.test.ts` needed the same treatment for a different reason: its
storage check required at least four `public_all_*` policies — it recorded the demo-era state as the
expected one, which is the hole `0230` measured and closed. It now asserts the property that must
hold instead: no anon/public write policy, no client `UPDATE`/`DELETE` policy, and exactly
`images public read/SELECT` + `images auth write/INSERT`.

The full integration lane was then run against QA at this revision: **43 files, 519 tests, exit 0**.
