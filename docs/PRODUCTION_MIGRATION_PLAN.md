# Production migration plan — reconciled against production itself

**Status: prepared and measured; NOTHING HAS BEEN APPLIED.** Production remains read-only to this
workstream. The approval gate is §8, and it is not satisfied.

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

**Batch 2 — the gap migration (to author, then verify; it does not exist yet).** One new file that only
ADDS what D-1 and D-2 name, in a backward-compatible shape: `add column if not exists` for
`notifications.shop_id`, `notifications.branch_id`, `audit_events.tenant_id` (nullable, no backfill, no
rewrite of existing rows); the `membership_role` type and `membership_roles` if the membership model is
still the direction; and the missing functions created with `create or replace` plus their explicit
`grant execute` — nothing dropped, renamed, retyped or narrowed. Rules: no data statements, no
`drop …`, idempotent throughout. It must be verified against the production baseline *before* it is
proposed to anyone as a candidate, and then the files that depend on it are re-verified as a batch.

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

## 8. Approval gate and preconditions

Nothing in this plan is applied, and nothing should be until every line below is true:

- [ ] The owner approves this plan, and specifically decision §7 (a) or (b).
- [ ] `SCHEMA_STRATEGY.md`'s §D decision stands unchanged: production moves only by verified new files.
- [ ] A fresh production backup exists, restore-verified, from immediately before the batch.
- [ ] The batch's own `verify:baseline --baseline production --files …` run reports **PASS**, from a run
      made after the last edit to any file in that batch.
- [ ] `scripts/release-gate.mjs --owner-approved` passes, and the release gate's other refusals
      (schema-strategy, monitoring) are satisfied or explicitly waived by the owner.
- [ ] A production-shaped rehearsal target has been used at least once for the batch (see §9.3).

## 9. What this plan does not claim

1. **It does not make `supabase/migrations` replayable**, and deliberately does not try to.
2. **It does not prove semantics.** Applying a file says nothing about what it does to behaviour; RBAC
   and RLS claims still need their own evidence.
3. **PGlite is not Supabase — but batch 1 has now been rehearsed on a real Supabase engine.** The
   measurement: `scripts/dev/rehearse-on-local-engine.mjs` (new) loaded this baseline artifact into a
   scratch database on the local Supabase CLI stack — **Postgres 17.6, the production server's own
   version**, with `pgcrypto`/`pg_sodium`/`pg_net` present and the platform's `auth`/`storage` schemas
   copied schema-only — then applied batch 1. Result: **PASS, 11 files, 50 statements, 0 failures**, the
   same numbers PGlite produced (`AGREES`). It counted and **skipped every one of the 268 data
   statements**: production's rows are not loaded anywhere. The post-state on the engine shows the work
   done (`public.client_error_events` exists with its policy, 29 tables, 108 policies).
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
* `supabase/baseline/production-baseline.json` — the artifact the verification runs against.
* `scripts/dev/rehearse-on-local-engine.mjs` — the real-engine rehearsal (§9.3); `npm run rehearse:engine`.
* `backups/rehearsal-prod-batch1-real-engine.{log,json}` — the rehearsal's own report (gitignored).
* `tests/unit/productionMigrationPlan.test.ts` — the guard over this plan and that harness.
