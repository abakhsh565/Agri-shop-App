# The production apply path — built, gated, and tested; nothing applied, 2026-10-16

**Decisions this answers.** The owner was asked two questions and answered both: **Plan A** (empty
production, keep the schema) for the demo data, and **"build the verified apply path"** for the schema
gap — option **(a)** of `docs/PRODUCTION_MIGRATION_PLAN.md` §7. This record covers the second one.

**Status: BUILT and TESTED. `NOTHING HAS BEEN APPLIED`** — no migration has reached production, and the
data is untouched. Production was **read** twice in this pass, both through the read-only tools the
repository already sanctions: one fresh backup and one restore verification.

---

## 1. What was added

| File | What it is |
|---|---|
| `scripts/lib/production-batch-gate.mjs` (new) | The four preconditions as a **pure** function: no socket, no credentials, no clock of its own (`now` is a parameter). `productionBatchGate()` returns the problems, the batch it would apply and the context behind them; `describeGate()` renders it. |
| `scripts/migrate.mjs` (extended) | `apply --env production` with a named batch, gated. The blanket refusal is **kept**: `status`, `verify`, `adopt`, `reconcile`, and `apply` without `--files` are still refused before a credential is read. It runs the gate **before** `openLiveTarget()`. |
| `tests/unit/productionBatchGate.test.ts` (new) | 42 tests — every rule and its non-vacuity half. |
| `tests/unit/productionMigrationPlan.test.ts` (updated) | The premise "the tool refuses production" is now asserted **by running the tool**, not by matching source text, plus a check that the gate is called before the connection is opened. |
| `docs/PRODUCTION_MIGRATION_PLAN.md` §7.1 (updated) | The decision recorded, the preconditions tabulated, and the two things it deliberately does not do. |

## 2. The shape, in one block

```bash
# 1. verify the batch on PRODUCTION'S OWN baseline (local; no environment contacted)
npm run verify:baseline -- --baseline production --files <the batch> --json backups/<batch>-verified.json

# 2. a fresh backup of production — read-only, through the tool that refuses anything else
node scripts/run-with-production-credentials.mjs -- node scripts/backup-database.mjs --env production

# 3. prove that backup restores
node scripts/run-with-production-credentials.mjs -- node scripts/restore-verify.mjs \
     --from backups/<artifact>.manifest.json --compare-with production \
     --json backups/restore-verification-production.json

# 4. apply the named batch (dry run without --apply)
node scripts/migrate.mjs apply --env production --files <the batch> \
     --verification backups/<batch>-verified.json \
     --backup backups/<artifact>.manifest.json \
     --restored backups/restore-verification-production.json --apply
```

## 3. The four preconditions, and what each one refuses

| # | Rule | Refused when |
|---|---|---|
| 1 | The batch is named, canonical, present, ascending, and every file sorts at or after `0017` | `--files` absent; a file named twice; a file the directory does not have; a name without a 4-digit version; names out of order; a pre-position file (0017–0176's intent already lives in production's own schema) |
| 2 | A PASS verification report for **this** batch, against **production's** baseline, whose artifact sha256 was verified, ≤ 60 minutes old | missing / `FAIL` / `UNVERIFIABLE`; against staging; baseline hash not verified; resolved list differs from the batch; SQL failures recorded; stale; future-dated; **or a batch file whose mtime is newer than the report** |
| 3 | A backup of production taken ≤ 60 minutes ago | missing manifest; another environment's; no sha256; stale; unreadable timestamp |
| 4 | That **exact** backup was restored into a throwaway database and passed | missing report; no verdict; a failed check; a recorded failure; no artifact hash; a **different** artifact than the backup named here; stale |

The ledger is read over the connection, and the partition is deliberate: a version already recorded
with a **matching** hash is skipped (a re-run resumes rather than double-applies), while one recorded
with a **different** hash — or with no hash at all — stops the run. Each applied file and its ledger
rows commit in **one transaction**, and production's ledger is read back afterwards: a file that ran
without a row fails the run.

## 4. Evidence — the refusals, by running the tool

`this suite has no production credentials in its environment`, which is also what proves the refusals
happen **before** a connection rather than after one:

```
$ node scripts/migrate.mjs status --env production                      → exit 2
[MIGRATE REFUSED] production is not a target of this tool. Its schema does not yet match this
directory (the ledger says 0016; the membership model is absent) … This refusal is deliberate and is
not a bug.

$ node scripts/migrate.mjs apply --env production                       → exit 2  (no batch named)
[MIGRATE REFUSED] production is not a target of this tool. …

$ node scripts/migrate.mjs apply --env production --files 0179_cost_price_is_the_owner_s_business.sql
                                                                        → exit 2  (named, unverified)
  Gate — production batch "0179_cost_price_is_the_owner_s_business.sql"
    ✗ no verification report given (`--verification <report.json>`) …
    ✗ no backup manifest given (`--backup <artifact>.manifest.json`) …
    ✗ no restore-verification report given (`--restored <report.json>`) …
[MIGRATE REFUSED] the production gate did not pass, so nothing was read from production and nothing
was written.
```

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **clean, exit 0** |
| The gate's rule set | `npx vitest run tests/unit/productionBatchGate.test.ts` | **42 passed** |
| The plan's premises, by execution | `npx vitest run tests/unit/productionMigrationPlan.test.ts` | **17 passed** |
| The whole unit suite | `npx vitest run tests/unit` | **74 files / 966 tests passed** |
| Non-vacuity — the plan's "nothing applied" claim | replaced `NOTHING HAS BEEN APPLIED` with `EVERYTHING WAS APPLIED` in the doc | **1 test failed**, naming the claim; restored, green again |
| Non-vacuity — the gate | each rule tested with the rest of the set valid | see §3: every row has a passing half and a failing half |

## 5. Production, read twice in this pass (both sanctioned, both read-only)

| Step | Command | Result |
|---|---|---|
| Fresh backup | `creds:production -- node scripts/backup-database.mjs --env production` | `backup-production-gkswcfljxlutkfdvvqng-2026-10-16T14-58-47.sql` — 30 tables, **249 rows**, 56 FKs, 104 policies, 326 KB, sha256 `a8c27e92…`, cluster `7666007964130682852`, ledger `8 / 0016` |
| Restore verification | `creds:production -- node scripts/restore-verify.mjs --from …manifest.json --compare-with production` | **PASS** — integrity, replay, counts, structure, digests, auth |
| Demo-data audit of that artifact | `npm run audit:production-data` | **exit 1** — 23 rows keyed by demo identities, 4 accounts on fixture phone numbers, plus 79 rows scoped to the demo tenant (52 sales, 6 customers, …) |
| Cleanup runbook against that artifact | `npm run verify:cleanup-runbook` | **PASS** — Plan A takes all 30 tables to 0, refuses a database with a second shop, names all 20 row-holding tables, and rolls back |

**One measured change since the frozen baseline:** production holds **249 rows today, not 268**, and
`customer_payments` is **1, not 20**. The baseline's *structure* is still faithful (28 tables / 104
policies at both captures); its *data* count is not, which is why the fresh artifact — not the October
1st one — is what §5's audits were run against.

## 6. What this does NOT claim

1. **It has not been used on production.** Batch 1 is verified twice (PGlite and the real-engine
   rehearsal); the batch 2–4 work in §4 of the plan is not authored yet. Nothing is applied by this
   record.
2. **The credential intake was deliberately not extended.** `scripts/run-with-production-credentials.mjs`
   still hands the production password only to the backup and the restore verifier, so running the
   apply path requires a deliberate owner act. No automated path in this repository — CI, script or
   test — can reach production on its own; that was true before this change and it is true after it.
3. **The positive path's write mechanics are not new code.** They are `applyOne()`, the same
   file-plus-its-ledger-rows transaction `apply --env staging` uses, whose atomicity is proven by the
   rollback test in `PHASE_2_MIGRATION_LEDGER.md` §8. What is new here is the gate, and it is tested
   exhaustively. A first apply against a live Postgres happens in §4's batches, with the backup as the
   undo.
4. **Clearing rows is still owner-run**, by policy (`PRODUCTION_DATA_POLICY.md` §4: nothing scripted
   may delete a production record). The schema path was buildable; the data path is a runbook on
   purpose.

## 7. What remains

1. **Author batch 2** (the additive gap migration: `notifications.shop_id`/`branch_id`,
   `audit_events.tenant_id`, the missing functions) and verify it on the production baseline **and**
   the real engine.
2. **Re-verify batch 3 as a batch** (its membership is predicted, not measured), then author batch 4's
   four production-shaped files (`0177`, `0178`, `0182`, `0198`).
3. **Apply batch 1, then 2, 3, 4** through the path above, each with its own verification report and
   fresh backup.
4. **Plan A + the storage clear** (owner-run), then: `npm run audit:production-data` → exit **0**, and
   the first-run test — register → create the shop → add a product → make one sale.
