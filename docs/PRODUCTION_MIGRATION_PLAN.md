# Production migration plan — reconciled against production itself

**Status: prepared and measured; the sanctioned apply path is BUILT (§7.1).** NOTHING HAS BEEN APPLIED —
no file in this plan has reached production. The approval gate is §8.

**Update 2026-10-16:** the owner chose §7(a) and the mode it describes is implemented and tested
(`scripts/migrate.mjs` + `scripts/lib/production-batch-gate.mjs`, 42 tests). Production is still
read-only to every automated path: the tool refuses `--env production` before it resolves a
credential, except for `apply` with a named batch and all four preconditions.

The report this answers: production's `supabase_migrations` holds **8 entries through 0016** while the
repository holds **198 migration files**, so "applying migrations" could damage data or break the app.
The measurement behind every claim here is `device-evidence/production-schema-reconciliation-2026-10-16.md`;
the standing decision is [SCHEMA_STRATEGY.md](../SCHEMA_STRATEGY.md) — never replay history, frozen
baselines, forward-only files.

## 1. What production actually is, and why "catch up the ledger" is not the plan

| | Production (measured) | Repository |
|---|---|---|
| Recorded history | **8 rows, latest `0016`** — identical at the 2026-10-01 and 2026-10-15T23:57Z captures | **198 files**, newest `0206` |
| Schema | 28 tables · 37 functions · 2 views · 47 indexes · 56 FKs · 9 checks · 9 uniques · 10 triggers · 104 policies · 8 enums | — |

**The ledger is not a record of what production has.** Production's schema is far ahead of anything
0009–0016 could create — 28 tables and 104 policies whose only possible origin is the project's own
out-of-band setup SQL. Replaying the directory to "catch the ledger up" is therefore not a repair; it
is the failure mode this repository already measured four ways (30 of 169 files fail on the production
schema). Two further facts follow, and they decide the whole plan:

* **Production's schema has not moved since the baseline was frozen** (identical structure counts at
  both captures), so the frozen production baseline is a faithful stand-in and this plan does not rest
  on a stale snapshot.
* **Files 0017–0176 are not replayed and are not re-issued.** Their intent is already realised in
  production's schema by that out-of-band work. What is verified is the *forward* range below.

## 2. What production can take unchanged — measured, and verified as a batch

Selection = every file after production's recorded position (0177 → 0206, 30 files), applied in order
onto the production schema in-process, data statements counted and skipped, no environment contacted:

```
--since 0177                     → FAIL: 30 files, 275 statements, 106 sql failures, 0 env-gap failures
--files <the 11 in the table>    → PASS: 11 files,  50 statements,   0 sql failures, 0 env-gap failures
```

**Batch 1 — verified PASS, ready to apply on approval, no new code required:**

`0179` · `0181` · `0190` · `0199` · `0200` · `0201` · `0202` · `0203` · `0204` · `0205` · `0206`

**The method this measurement forced.** `0193` passed inside the 30-file run and **failed** inside a
12-file batch — `column "tenant_id" does not exist` — because files 0180–0192 had run before it and
partially applied their statements before failing, leaving `audit_events.tenant_id` behind for 0193 to
consume. A file's individual PASS is therefore not evidence that a batch containing it will pass. **The
unit of verification is the batch, in the order it will be applied**, and it is verified immediately
before it is applied.

## 3. The differences, in four groups

| Group | What production lacks | Consequence |
|---|---|---|
| **D-1** | Functions the newer files grant on, alter or replace — `get_my_branches()`, `current_branch_id()`, `allowed_branch_scope()`, `current_branch_scope()`, `set_active_branch`, `set_marketplace_settings(...)`, `authorize_business_action`, `assign_employee_branch`, `create/archive_operating_branch`, `branch_responsible_person`, `grant/revoke/transfer_branch_responsibility`, `membership_in_active_shop`, `has_effective_permission`, `delete_branch`, `guard_employee_access_edit`, `audit_context_stamp`, `notification_branch_visible`, `get_my_shop_request`, `process_reminders` | a `CREATE OR REPLACE FUNCTION` on a missing function would succeed; the failures are the `GRANT`, `ALTER`, policy and constraint statements that reference them. Ordering + a creating step, not a rewrite |
| **D-2** | Relations, types and columns — `payments` is absent (production has `customer_payments`), `membership_roles` and type `membership_role` absent, `notifications` has no `shop_id` or `branch_id`, `audit_events` has no `tenant_id`, `s.latitude` absent | additive `if not exists` work that must precede its dependents (batch 2) |
| **D-3** | Production's `process_return` predates the `p_payload` rename, so `create or replace` is refused | one file (0198) needs a new forward file expressing the same intent idempotently — never a re-run |
| **D-4** | The files' own assertions firing against production's legacy permissive policies (`public_all_product_variants`, `public_all_cash_reconciliations`, `public_all_app_settings`; `record_customer_payment` body differs) | production-shaped, catalog-driven variants — the pattern already proven for 0177 (`SCHEMA_STRATEGY.md` §3, `corpus-d`) |

Each group's evidence, and the independent check that the same objects are genuinely absent from the
artifact, is in the reconciliation record §3.

## 4. The plan

**Batch 1 — apply on approval, verified twice: on the baseline and on a real engine.** The eleven files
listed in §2, ascending, exactly as verified. All are additive or behaviour-tightening; none removes
data or drops an object. Verified by replay onto the production baseline in PGlite **and** rehearsed on
the local Supabase CLI stack (§9.3) with the same result. Precondition: a fresh verified production
backup taken immediately before, which the backup path now provides (`38831480604`, artifact 37,
restore-verified).

**Batch 2 — the gap migration. BOTH HALVES ARE WRITTEN AND VERIFIED (§7.2, §7.3); neither has been
applied.** Two files that only ADD what D-1 and D-2 name:

* `0207` — the relations half: the six relations and the `user_active_shops` they need, extracted
  schema-only from the accepted staging baseline, catalog-guarded, with the ordering the DDL forced.
* `0208` — the functions-and-what-they-read half: 62 functions (the 46 client RPCs production lacks plus
  the 16 their bodies call), 7 relations those bodies read, and 28 additive columns — 26 of them from
  the ledger's own `add column if not exists`, and `notifications.shop_id`, which no tracked file writes,
  extracted schema-only from the same accepted baseline (§7.3).

Both are verified as **one batch** — `--files 0207,0208` → PASS, 235 statements, 0 sql failures — on
production's baseline and on staging's, and rehearsed on the real engine with the same numbers agreeing
with PGlite. Nothing is dropped, renamed, retyped or narrowed; every create is `if not exists` or
catalog-guarded, so a re-run invents no state. Then the files that depend on batch 2 are re-verified as
a batch, which is batch 3's job.

**Batch 3 — the gap-dependent files (predicted, not yet measured).** 0180, 0183–0189, 0191, 0192,
0194–0197 fail only for D-1/D-2 and should apply once batch 2 lands. **This is a prediction.** It is
tested by re-running the range after batch 2 exists; membership is not to be treated as settled until
that run is green. Split into sub-batches of ≤6 files so that one failure invalidates a small amount of
work rather than a whole push.

**Batch 4 — the files that need their own shape.** 0177, 0178, 0182 and 0198 are not waiting on
missing objects: 0177 needs the production-shaped variant already proven, 0178/0182 need catalog-driven
cleanups of whatever permissive policies actually exist, and 0198 needs an idempotent forward file for
the `process_return` rename. Each is verified individually before it joins a batch, and 0193 goes after
all of them because its only PASS so far was an accident of a predecessor.

**Ordering rule for anything that can be applied twice:** a batch is applied once, in its verified
order; a file whose ledger row exists is not re-applied.

## 5. Disposition of every file after production's recorded position

Machine-checked by `tests/unit/productionMigrationPlan.test.ts`: every file at or after `0177` must
appear here exactly once, so a newly added migration cannot exist without a production disposition.

| File | Disposition |
|---|---|
| `0177_a_definer_knows_where_it_looks.sql` | fails (D-1 ×2) — batch 4: production-shaped variant (pattern proven) |
| `0178_a_variant_belongs_to_a_shop.sql` | fails (D-4 ×1) — batch 4: catalog-driven cleanup variant |
| `0179_cost_price_is_the_owner_s_business.sql` | **batch 1 — verified PASS** |
| `0180_admin_is_not_a_boundary.sql` | fails (D-1/D-2 ×3 + D-4 ×1) — batch 3, then its D-4 cleanup in batch 4 |
| `0181_audit_rows_are_written_by_the_system_not_by_the_caller.sql` | **batch 1 — verified PASS** |
| `0182_settings_belong_to_their_shop.sql` | fails (D-4 ×1) — batch 4: catalog-driven cleanup variant |
| `0183_deleting_a_role_revokes_its_access.sql` | fails (D-1/D-2 ×1) — batch 3 |
| `0184_a_branch_decides_how_far_it_serves.sql` | fails (D-1/D-2 ×4) — batch 3 |
| `0185_a_product_can_be_listed_on_the_marketplace.sql` | fails (D-1/D-2 ×4) — batch 3 |
| `0186_the_branches_read_carries_its_marketplace_state.sql` | fails (D-1/D-2 ×4) — batch 3 |
| `0187_the_distance_belongs_to_the_farmer_not_the_branch.sql` | fails (D-1/D-2 ×8) — batch 3 |
| `0188_a_branch_is_not_its_tenant.sql` | fails (D-1/D-2 ×24) — batch 3 |
| `0189_access_changes_keep_the_person_and_history.sql` | fails (D-1/D-2 ×6) — batch 3 |
| `0190_invitation_starts_in_the_selected_branch.sql` | **batch 1 — verified PASS** |
| `0191_operating_branches_preserve_the_business.sql` | fails (D-1/D-2 ×8) — batch 3 |
| `0192_consequential_records_guard_before_retry.sql` | fails (D-1/D-2 ×1 + D-4 ×1) — batch 3, then its D-4 in batch 4 |
| `0193_activity_reads_the_action_history.sql` | batch-order sensitive (D-2): `audit_events.tenant_id`; passes only behind a predecessor's partial apply — batch 4 |
| `0194_access_edits_do_not_widen_the_editor.sql` | fails (D-1/D-2 ×6) — batch 3 |
| `0195_permissions_are_not_just_navigation.sql` | fails (D-1/D-2 ×3) — batch 3 |
| `0196_a_branch_has_a_responsible_person.sql` | fails (D-1/D-2 ×20) — batch 3 |
| `0197_a_notification_says_which_branch.sql` | fails (D-1/D-2 ×7) — batch 3 |
| `0198_a_sale_keeps_its_due_date_and_leaves_a_movement.sql` | fails (D-3 ×1) — batch 4: new idempotent forward file for the rename |
| `0199_uploads_and_live_updates_survive_a_restore.sql` | **batch 1 — verified PASS** |
| `0200_the_pre_login_lookup_returns_only_what_the_screen_shows.sql` | **batch 1 — verified PASS** |
| `0201_the_pre_login_lookup_answers_for_the_number_only.sql` | **batch 1 — verified PASS** |
| `0202_archiving_a_customer_needs_the_delete_permission.sql` | **batch 1 — verified PASS** |
| `0203_client_errors_are_write_only_and_environment_tagged.sql` | **batch 1 — verified PASS** |
| `0204_error_records_are_pruned_by_an_authorized_function_only.sql` | **batch 1 — verified PASS** |
| `0205_the_error_insert_policy_is_not_a_permissive_true.sql` | **batch 1 — verified PASS** |
| `0206_a_view_is_not_a_boundary.sql` | **batch 1 — verified PASS** |
| `0207_the_membership_model_exists_in_the_repository.sql` | **batch 2, relations half — verified PASS on production's baseline and staging's** (76 statements, 0 sql failures; real engine PASS, `AGREES`). Not a rewrite of any file above: it is the DDL for six relations that **no tracked file ever created** (`branches`, `roles`, `memberships`, `permissions`, `role_permissions`, `user_permissions`) plus the one they need to become reachable (`user_active_shops`), extracted schema-only from the accepted staging baseline under the owner decision in §7.2. Its closure pulls three enum types and eleven functions, ordered so each function follows the ones it calls. |
| `0208_the_functions_the_app_calls_and_the_tables_they_read.sql` | **batch 2, function half — verified PASS on production's baseline and staging's, as part of the batch `0207,0208`** (0208: 159 statements, 0 sql failures; batch: 235 statements, 0 sql failures; real engine PASS, `AGREES`). Carries the 62 functions the app's call surface needs and production lacks (46 client RPCs + 16 called by their bodies), the 7 relations those bodies read, and the 28 additive columns they read, each with the ledger's own EXECUTE contract. Generated by `scripts/dev/extract-missing-functions.mjs` from the ledger's last-wins definition per name, in computed dependency order; the one column the ledger never writes (`notifications.shop_id`) is extracted schema-only from the accepted staging baseline under §7.3. |

## 6. Backward-compatibility rules (binding on every batch)

1. **Additive only.** New columns are nullable or defaulted, added `if not exists`. No drops, no
   retypes, no renames, no narrowing of a column, no `alter … set not null` on existing data.
2. **No data statements.** These files are schema; the dump's own data statements are counted and never
   executed by the verifier, and none of the batches introduces one.
3. **Idempotent or catalog-guarded**, so a half-applied batch can be re-run without inventing a state.
4. **Access is never widened** by a migration: RLS changes must replace a permissive policy with a
   scoped one, never the reverse, and the file's own assertions must be able to fail (D-4 shows they can).
5. **One transaction per file**, file and ledger rows together — proven by the rollback test in
   `PHASE_2_MIGRATION_LEDGER.md` §8. A failed file changes nothing.
6. **Undone forward, never by rewriting history.** An applied change is corrected by a new file; the
   `reconcile` mode is for cosmetic edits only and requires a reason.
7. **Verification gate.** Every batch must produce `PASS` on the production baseline immediately before
   it is applied. `FAIL` and `UNVERIFIABLE` both mean "not applied"; `UNVERIFIABLE` is never a pass.

## 7. The one decision the owner must make: how production records what it applies

`scripts/migrate.mjs` refuses `--env production` **before connecting** — deliberately, because the
*directory* must never be replayed. That refusal is correct and this plan does not ask for it to be
removed. But it means there is no sanctioned way today for production to receive a verified batch *and*
record it, so the owner chooses:

* **(a) Recommended — a production apply mode with preconditions.** Extend the tool so
  `apply --env production` refuses unless (i) an explicit `--files` batch is named (never "everything"),
  (ii) a PASS verification report against the production baseline exists from a run minutes earlier,
  (iii) a verified backup of production exists from immediately before, and then writes the file and
  its ledger rows in one transaction. The replay refusal stays; only the verified-forward path is added.
* **(b) Manual apply under the release gate, then attestation.** Apply the verified files through the
  Supabase SQL editor and then adopt the ledger rows for exactly those files. Same end state, more
  human steps, and the atomicity of §6.5 becomes a procedure rather than a guarantee.

Either way production's ledger ends up recording exactly what ran: the historical 8 rows for 0009–0016,
plus one row per verified forward file. Nothing is written for 0017–0176, which were never executed here.

### 7.1 Decided and implemented, 2026-10-16 — option (a)

**The owner chose (a).** `migrate.mjs` still refuses production by default — `status`, `verify`,
`adopt`, `reconcile`, and `apply` with no named batch are all refused before a credential is read —
and exactly one path was added:

```bash
npm run verify:baseline -- --baseline production --files <the batch> --json backups/<batch>-verified.json
node scripts/run-with-production-credentials.mjs -- node scripts/backup-database.mjs --env production
node scripts/run-with-production-credentials.mjs -- node scripts/restore-verify.mjs \
     --from backups/<artifact>.manifest.json --compare-with production --json backups/restore-verification-production.json

node scripts/migrate.mjs apply --env production --files <the batch> \
     --verification backups/<batch>-verified.json \
     --backup backups/<artifact>.manifest.json \
     --restored backups/restore-verification-production.json --apply
```

The preconditions are enforced in `scripts/lib/production-batch-gate.mjs`, which is pure — no socket,
no credentials, no clock of its own — so the whole rule set is exercised in CI with nothing running,
and `migrate.mjs` runs it **before** `openLiveTarget()`. Each rule below has a test plus a
non-vacuity half in `tests/unit/productionBatchGate.test.ts` (42 tests):

| # | Rule | Refuses when |
|---|---|---|
| 1 | The batch is named, canonical, present, ascending, and every file sorts at or after `0017` | `--files` is absent, names a file twice, names a file the directory does not have, names a file without a 4-digit version, is given out of order, or names a pre-position file — the range whose intent production already holds from its out-of-band setup |
| 2 | A verification report for **this** batch, against **production's** baseline, whose artifact hash was verified, PASS, and taken ≤ 60 minutes ago | the report is missing/FAIL/UNVERIFIABLE, is against staging, did not verify its baseline hash, resolves to a different file list, carries SQL failures, is stale, is dated in the future — **or the file's mtime is newer than the report**, because a file edited after verification is not the verified file |
| 3 | A backup of production taken ≤ 60 minutes ago | the manifest is missing, is another environment's, records no sha256, is stale, or has no readable timestamp |
| 4 | That exact backup was restored into a throwaway database and passed every check | the restore report is missing, carries no verdict, has a failed check or a recorded failure, names no artifact hash, points at a **different** artifact than the backup named here, or is stale |

The ledger is read over the connection and the partition is deliberate: a version already recorded with a
**matching** hash is skipped (so a re-run resumes rather than double-applies), and one recorded with a
**different** hash, or with no hash at all, stops the run — an applied file is corrected by a new file,
never by editing the old one. The ledger rows for each applied file are written in the same transaction
as the file itself, and after the batch production's own ledger is read back: a file that ran without a
row fails the run.

**Two things this deliberately does not do.** It does not extend the credential intake: the allow-list in
`scripts/run-with-production-credentials.mjs` still hands the production password only to the backup and
the restore verifier, so running the apply path is a **deliberate owner act** — exporting the credentials
by hand — and no automated path in this repository can reach production on its own. And it does not
touch data: this mode applies schema files. Clearing rows is still the owner-run runbook
([§6 of the data policy](PRODUCTION_DATA_POLICY.md)), where the policy says it belongs.

### 7.2 Where batch 2's relation DDL comes from — decided 2026-10-16, measured first

Batch 2 was written as "one new file that only ADDS what D-1 and D-2 name", which presumes the repository
can supply those definitions. It cannot, and that was measured before anything was authored:

```
create table branches / roles / memberships / permissions / role_permissions / user_permissions
  → NONE (not in any tracked .sql)
COMPLETE_DATABASE_SETUP.sql (1080 lines)      → 0 mentions
ALL_MIGRATIONS_TO_RUN.sql   (2737 lines)      → 0 mentions
staging artifact                               → 1 create-table statement each
```

So the model that makes the signed-in app work was created out-of-band in an environment and recorded
nowhere — the same divergence `SCHEMA_STRATEGY.md` §1 measured from the other side. **The owner approved
extracting it from the accepted staging baseline, schema-only**, on the strength of
`PRODUCTION_DATA_POLICY.md` §1's own direction: *code and schema move forward; data never moves up*. Every
data statement in that dump is skipped — 268 of them, counted and never executed — so this is a schema
move with no row in it.

The extraction is the batch-2 file in §5's table, and what makes it a reviewed file rather than a copy is
the closure, the ordering and the idempotence, all three driven by measurement:

| Round | Statements | SQL failures on production's baseline | What the failures named |
|---|---|---|---|
| 1 | 55 | 16 | `type membership_role` absent — cascading to 14 statements about `memberships` |
| 2 | 68 | 4 → 2 | functions emitted before the functions their bodies call; `user_active_shops` absent |
| 3 | **76** | **0 — PASS** | — |
| 4 | 76 | **0 — PASS**, on production's baseline **and** on staging's | 23 failures on staging's baseline: every constraint, policy and trigger already existed there. That round is what made the file safe to apply to more than one environment |

Round 4 is the one that decides whether a file may be applied twice or anywhere else: the statements are
now **catalog-guarded** (`pg_constraint` / `pg_policies` / `pg_trigger` checked first), so the file is a
real change where the objects are missing and a no-op where they already exist. `SCHEMA_STRATEGY.md` §6.3
requires exactly that of a forward file — "idempotent or catalog-guarded, so a half-applied batch can be
re-run without inventing a state" — and a `pg_dump` is not written that way, which is why a straight copy
of the dump failed on any environment already past it.

**Full detail and the standing evidence:** `device-evidence/production-gap-measured-2026-10-16.md`.

### 7.3 Where batch 2's function half comes from — the ledger, with one measured exception

The function half has the opposite problem to the relations: the repository *does* define these
functions (0104–0196), 454 `CREATE FUNCTION` statements across 199 files, 185 distinct names. What it
did not have is a rule for choosing among them and for ordering the result, and 62 functions plus 28
columns copied by hand would be an unreviewable file. `scripts/dev/extract-missing-functions.mjs` is
that rule, and it refuses rather than guesses:

* **Which names.** `--baseline production` fixes the target: the app's client RPCs (extracted from `src/`
  the way the app writes them, `supabase.rpc(…)` and `scopedRpc(…)`) that the target's own frozen schema
  does not have — 46 of 65. Then the closure: what those bodies call (16 more functions), what relations
  they read (7 absent), what columns they read (28 absent). A name the app calls that no migration
  defines is a **refusal**, not a silent omission: that is a ledger gap, and it is a different defect.
* **Which definition.** The **last** `CREATE [OR REPLACE] FUNCTION` per name in filename order — the
  definition the application is developed against — with the file it came from written above it, so
  every one of the 62 can be traced back to a reviewed migration.
* **What order.** Computed by dependency, callee first, because a SQL-language body is validated at
  creation time. A dependency cycle is a **refusal**; a function that calls itself is recursion and is
  not a cycle. This is not a formality: the first generation of the file failed on
  `current_branch_id()` and `mint_barcode(text, uuid)`, both of which the scan missed because their calls
  are written `public.`-qualified.
* **Which ACL.** The ledger's own EXECUTE contract, per function: `authenticated` always, `anon` only
  where the ledger leaves it executable, otherwise `revoke … from public, anon` — because PostgreSQL
  grants EXECUTE to PUBLIC on a new function until something revokes it. Access the ledger granted is not
  taken away here, and access it revoked is not handed back.
* **What it will not emit.** A `NOT NULL` column with no default (it would need a value invented for
  every existing row: a data change, §6.2). A column the ledger never writes is handled by the one
  exception below, or refused.
* **The one extracted column.** `notifications.shop_id` is named by D-2, production lacks it, and **no
  tracked file writes it** — the ledger only reads it (0147, 0197), so it was created out of band exactly
  as the relations were. It is taken schema-only from the accepted staging baseline under §7.2's owner
  decision, with its source named in the comment above the statement and no row moved.

**The measurement the rule produced, end to end** — and the two generations that failed before it:

| Generation | Statements on production's baseline | Failures | What the failures named |
|---|---|---|---|
| 1 | 112 | 6 | `public.branch_responsibility`; `current_branch_id()`; `mint_barcode(text, uuid)` — qualified calls and unread relations |
| 2 | — | 2 | `s.marketplace_enabled`; 0193's multi-column `ALTER` with no terminator |
| 3 | **235 (batch, both files)** | **0 — PASS** | — |

**Full detail and the post-state measurement:** `device-evidence/production-gap-measured-2026-10-16.md`
§3c, and `tests/unit/forwardFilesAdditionality.test.ts`, which enforces §6's rules on both files.

## 8. Approval gate and preconditions

Nothing in this plan is applied, and nothing should be until every line below is true:

- [x] The owner approved this plan, and decision §7(a) — recorded in §7.1, with the mode implemented
      and tested. The four per-batch boxes below are what the gate checks on every run.
- [x] `SCHEMA_STRATEGY.md`'s §D decision stands unchanged: production moves only by verified new files —
      and this plan is an instance of it: nothing is replayed, both files are new, and neither has run
      anywhere but QA.
- [ ] A fresh production backup exists, restore-verified, from immediately before the batch. **Not yet
      done, and it is the one box that must be closed per apply — the gate refuses a backup older than
      60 minutes or one that has not been restore-verified.**
- [x] The batch's own `verify:baseline --baseline production --files …` run reports **PASS**, from a run
      made after the last edit to any file in that batch — `--files 0207,0208` → PASS, 235 statements,
      0 sql failures (`backups/baseline-prod-batch2-verified.json`), re-run after the last regeneration
      of `0208`.
- [ ] `scripts/release-gate.mjs --owner-approved` passes, and the release gate's other refusals
      (schema-strategy, monitoring) are satisfied or explicitly waived by the owner.
- [x] A production-shaped rehearsal target has been used at least once for the batch — the real
      PostgreSQL 17 Supabase engine, `PASS` and `AGREES` with PGlite (§9.3), plus the batch applied to
      QA through the ledger (`PHASE_2_MIGRATION_LEDGER.md` §14).

**The QA application is a rehearsal of the record, not of the outcome.** On QA both files are no-ops —
the objects exist there — so the part it exercises is the one production cannot rehearse twice: the
file and its ledger row landing in one transaction on a live project, with `verify` reading the hash
back afterwards (200 rows ↔ 200 files, PASS). The outcome production will see is the one the rehearsed
engine showed: 46 missing client RPCs → 0, none unreachable by `authenticated` (§9.3).

## 9. What this plan does not claim

1. **It does not make `supabase/migrations` replayable**, and deliberately does not try to.
2. **It does not prove semantics.** Applying a file says nothing about what it does to behaviour; RBAC
   and RLS claims still need their own evidence.
3. **PGlite is not Supabase — but batch 1 and batch 2 have both been rehearsed on a real Supabase engine.**
   The measurement: `scripts/dev/rehearse-on-local-engine.mjs` loaded a baseline artifact into a
   scratch database on the local Supabase CLI stack — **Postgres 17.6, the production server's own
   version**, with `pgcrypto`/`pg_sodium`/`pg_net` present and the platform's `auth`/`storage` schemas
   copied schema-only — then applied the selection. Batch 1: **PASS, 11 files, 50 statements, 0
   failures**. Batch 2 on production's baseline and on staging's: **PASS, 2 files, 235 statements, 0
   failures** each, agreeing with PGlite (`AGREES`). It counted and **skipped every data statement** (268
   for production, 2267 for staging): no environment's rows are loaded anywhere. The post-state was then
   asked of the engine rather than inferred from the file — after batch 2, **0 of the app's 65 client
   RPCs are missing and none is unreachable by `authenticated`**, where 46 were missing before
   (`device-evidence/production-gap-measured-2026-10-16.md` §3c).
   **What still differs from hosted, and is therefore not claimed:** the platform *behaviour* around the
   schema — Supavisor pooling, the real default-privilege configuration, the storage and auth services,
   and the hosted `postgres` role's authority. The rehearsal proves the DDL against a real PostgreSQL 17
   with Supabase's extensions and schemas; it does not prove the hosted platform's execution of it.
4. **Batch 3 membership is predicted**, not measured (§4).
5. **Production's ledger is only known to capture time**: the dump excludes `supabase_migrations`, so
   8/`0016` is as of **2026-10-15T23:57Z**.
6. **No PITR**: the recovery objective is the daily verified backup (docs/RECOVERY.md §9).

## 10. Evidence

* `device-evidence/production-schema-reconciliation-2026-10-16.md` — both sides measured, the full
  pending-sequence result, the batch-order trap, and the independent object checks.
* `backups/baseline-prod-forward-0177.{log,json}` — the 30-file measurement (gitignored).
* `backups/baseline-prod-batch1.{log,json}` — the 12-file attempt that exposed the 0193 trap.
* `backups/baseline-prod-batch1-verified.{log,json}` — batch 1's PASS, 11 files, 50 statements.
* `supabase/migrations/0207_…sql`, `supabase/migrations/0208_…sql` — batch 2's two files, and the
  extraction by hand.
* `scripts/dev/extract-missing-functions.mjs` — batch 2's function rule (§7.3), re-runnable, refusing on
  a cycle or an unwritten client RPC.
* `backups/baseline-prod-batch2-verified.json`, `backups/baseline-staging-batch2-verified.json` — the
  batch's PASS on both baselines (gitignored).
* `backups/rehearsal-batch2-production.json`, `backups/rehearsal-batch2-staging.json` — the same batch on
  the real engine, with the PGlite comparison (gitignored).
* `supabase/baseline/production-baseline.json` — the artifact the verification runs against.
* `scripts/dev/rehearse-on-local-engine.mjs` — the real-engine rehearsal (§9.3); `npm run rehearse:engine`.
* `backups/rehearsal-prod-batch1-real-engine.{log,json}` — the rehearsal's own report (gitignored).
* `tests/unit/productionMigrationPlan.test.ts` — the guard over this plan and that harness.
* `tests/unit/forwardFilesAdditionality.test.ts` — §6's rules as a test over both batch-2 files.
