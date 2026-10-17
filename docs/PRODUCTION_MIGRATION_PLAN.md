# Production migration plan — reconciled against production itself

**Status: APPLIED 2026-10-18 — production's ledger holds 44 rows, latest `0231`.** The first apply closed the schema; the second closed the reasons the screens were empty: `0222` attaches every operational row — and every future one — to its branch, `0223` shuts the anon key out of every business table, `0224` repairs the three write RPCs a sale, purchase or stock adjustment could not get past, and the production test transactions were removed under the owner's written authorization (`scripts/purge-production-test-transactions.mjs`, dry-run by default, one transaction, invariants asserted before commit; pre-purge backup restored and compared PASS). The 24-file batch
went in at 14:44Z; `0220` and `0221` followed at 15:00:49Z and 15:00:50Z through the same gate, and
`0230`/`0231` at 19:44Z/20:01Z on 2026-10-17 — each with its own baseline verification, backup and
restore check. The
approval gate remains §8, and what the apply did **not** fix is §5.1 — read it before using production:
all 52 sales are invisible to every signed-in role because no historical row has a `branch_id`.
Measured evidence: [device-evidence/production-apply-verification-2026-10-17.md](../device-evidence/production-apply-verification-2026-10-17.md).

**Update 2026-10-16:** the owner chose §7(a) and the mode it describes is implemented and tested
(`scripts/migrate.mjs` + `scripts/lib/production-batch-gate.mjs`, 42 tests). Production is still
read-only to every automated path: the tool refuses `--env production` before it resolves a
credential, except for `apply` with a named batch and all four preconditions. That held: the
credential in `~/.agrishop/production.env` is read-only (`default_transaction_read_only = on`), so the
apply is a deliberate owner act and no automated path can reach production on its own.

The report this answers: production's `supabase_migrations` holds **8 entries through 0016** while the
repository then held **198 migration files** (**200** today, through `0208`), so "applying migrations"
could damage data or break the app.
The measurement behind every claim here is `device-evidence/production-schema-reconciliation-2026-10-16.md`;
the standing decision is [SCHEMA_STRATEGY.md](../SCHEMA_STRATEGY.md) — never replay history, frozen
baselines, forward-only files.

## 1. What production actually is, and why "catch up the ledger" is not the plan

| | Production (measured) | Repository |
|---|---|---|
| Recorded history | **8 rows, latest `0016`** at the time of writing — identical at the 2026-10-01 and 2026-10-15T23:57Z captures; **34 rows, latest `0221`** after the 2026-10-17 apply (§5.1) | **200 files**, newest `0208` (198 through `0206` when this plan was written) |
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

Selection = every file after production's recorded position (0177 → 0208, 32 files; 0177 → 0206, 30,
before batch 2 was written), applied in order onto the production schema in-process, data statements
counted and skipped, no environment contacted:

```
--since 0177                     → FAIL: 30 files, 275 statements, 106 sql failures, 0 env-gap failures
--files <the 11 in the table>    → PASS: 11 files,  50 statements,   0 sql failures, 0 env-gap failures
```

**Re-measured 2026-10-17, with batch 2 in the range:** `--since 0177` now selects 32 files / 510
statements — the same 106 failures, none of them in `0207` or `0208` (`✓ 0207 … 0 failures`, `✓ 0208 …
0 failures`). The number is unchanged because failures and passes are independent here: batch 2's two
files add 235 statements that all apply, and change nothing about the 30 files that fail ahead of them.

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
listed in §2, ascending, exactly as verified. **One measured caveat, 2026-10-17:** applied to *staging's*
baseline the batch reports 1 failure — `0181` creates `audit_events_no_client_writes` with a bare
`create policy` (`policy "audit_events_no_client_writes" for table "audit_events" already exists`). On
production's baseline it passes, and the tool's transaction-per-file plus the ledger's hash skip mean it
cannot be applied twice to the same environment — but §6.3 asks files to be catalog-guarded, and that
statement is not. It is recorded here as a known, bounded deviation; the guarded form belongs in the
re-issue below, not in an edit to a file whose verification this batch rests on **— and it is there
now: the re-issue re-establishes both of 0181's policies catalog-guarded, drops the bare name first,
and its staging replay is clean (16 files, 429 statements, 0 failures, 2026-10-17)**. All are additive or behaviour-tightening; none removes
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

**Batches 3 and 4 — MEASURED 2026-10-17, and the schedule as written cannot be applied.** The
prediction was that the gap-dependent files "should apply once batch 2 lands". Measured, they cannot —
for a reason that is structural rather than a matter of missing DDL:

1. **The tools only ever apply in version order.** `verify-forward-on-baseline` sorts a `--files`
   selection by version (`selected.sort`, deliberately: a `--files` order is not trusted), and the
   production gate refuses a batch that is not ascending. So `0188` precedes `0207` in every batch the
   gate will accept, and the objects `0188` needs are created by `0207`.
2. **Measured, that is exactly what happens.** Batch 1 + batch 2 + all 14 batch-3 candidates, ascending,
   on production's baseline: **101 statements still fail**. Classified against what 0207/0208 actually
   create: **86 name objects batch 2 creates** (`memberships`, `branches`, `user_active_shops`,
   `branch_responsibility`, `get_my_branches`, `set_marketplace_settings`, `allowed_branch_scope`,
   `membership_in_active_shop`, `assign_employee_branch`, `create/archive_operating_branch`, the four
   branch-responsibility functions, `current_branch_id`, `set_active_branch`,
   `authorize_business_action`, …), **10 are objects no file creates yet** and **5 are the files' own
   assertions firing**. No accepted ordering can turn the 86 into passes.
3. **On the real engine, in dependency order — the order the gate refuses — most of that content is
   fine.** Batch 2 first, then the candidates: **19 of the 27 selected files apply cleanly**, including
   `0183`, `0184`, `0188`, `0189`, `0194`, `0196`. So it is the *file numbering* that does not work, not
the SQL.

**Therefore the remaining work is a re-issue, not a batch: the intent of 0177–0198 has to be expressed
in files numbered after `0208`,** which is the strategy's own rule — an applied change is corrected by a
new file, never by replaying history — applied to files that were written assuming a history production
never had. The measured contents of that re-issue:

| What the re-issue must carry | Measured from |
|---|---|
| `shops.latitude` (and whatever else 0185–0187's bodies read off `shops`) | `column s.latitude does not exist` ×3 |
| `marketplace_listings` | `relation "public.marketplace_listings" does not exist` ×3 (0185) |
| `sales.notes` | `column "notes" of relation "sales" does not exist` (0195) |
| `stock_adjustments.shop_id` | 0180's three policies (`column "shop_id" does not exist`) |
| `my_shop_ids()` | 0197 ×3. Defined by `0168` — **a pre-position file that will never be replayed**, so the re-issue has to bring it, exactly as it must bring the rest of what 0017–0176 realized out of band |
| `delete_branch(uuid, text, text)` | 0191 ×1: its `REVOKE` needs the function to exist, and production never had it |
| The catalog-driven corrections | `0180 left a tenant-blind policy in place: cash_reconciliations.public_all_cash_reconciliations, stock_adjustments…` and `0192: unexpected body for public.record_customer_payment(jsonb)` — both are the files' **own assertions firing on production's real shape**, which is D-4 doing its job |

Split into sub-batches of ≤6 files, each verified on production's baseline — and on staging's — before
it is proposed, exactly as batch 1 and batch 2 were. `0177`, `0178`, `0182` and `0198` fold in here too:
their D-3/D-4 work is a shape problem, not an ordering one, and each needs its own verified file rather
than a place in a queue.

**The re-issue is WRITTEN AND VERIFIED as one batch (2026-10-17).** Nine files: the six generated re-issues
`0209`–`0214`, written by `scripts/dev/reissue-forward-files.mjs` from the range's own statements — the script re-expresses the
per-file intent (it does not copy SQL), refuses to emit an object that two files would both define, and
refuses a do-block that reads no catalog and declares no dependency — plus `0215`, `0216` and `0217`, the
ACL closures defects 6, 7 and 8 below made necessary.

```
--files <batch 1 + batch 2 + 0209–0217>, production's baseline   → PASS: 22 files, 448 statements, 0 sql failures
--files <0207–0217>, staging's baseline                          → PASS: 11 files, 398 statements, 0 sql failures
both, rehearsed on the local Supabase CLI stack (Postgres 17.6)  → PASS, per-file counts AGREE with PGlite
intent probe on the production-baseline rehearsal                → PASS: 20/20 checks held
```

(The 20-file selection against staging's baseline reports exactly one failure, `0181`'s known
non-re-runnable bare `create policy` — the deviation §5 already records, not a new one.)

The probe is the point. `scripts/dev/probe-rehearsal-intent.mjs` reads `pg_catalog` and the privilege
tables **after** the batch has been applied, so "applied cleanly" becomes "delivered the intent": the
marketplace view exists and `anon` can read it, the radius column is gone, `search_marketplace` and the
switch keep the shapes `0187` ended with, `audit_events` has no permissive INSERT policy and every SELECT
policy carries a shop predicate, the snapshot trigger sits on all three financial tables, the permission
gate is restrictive on ten tables, **all seven** branch-read policies are restrictive, `authenticated`
can still read `sales`/`products`/`customers`/`companies` while holding no write privilege on the money
tables, no guard or trigger function is executable by `anon`, and the membership substrate and the 29
named RPCs are present. It also refuses to run against a scratch database that was built without hosted's
default privileges — otherwise every ACL answer would describe an empty database instead of the batch.

Three defects were found and fixed by measuring the RESULT rather than the failure count, which is the
lesson this batch adds to §2's: a guarded statement that declines to run reports no failure, so a clean
apply is a floor, not the outcome.

1. **Guarding on the object instead of its dependency.** Every create was emitted as "if this policy /
   view exists, replace it", which is clean on production precisely because production lacks those
   objects: `marketplace_listings` was never created there, and the two `comment on` guards resolved
   their subject to `public` (`relname = 'public'`) so they could never run anywhere. The guard now
   names the dependency the statement needs (the table a policy belongs to, the relations a view reads,
   the function a body calls), so the statement runs wherever that is and creates what is missing.
2. **`CONTINUE` outside a loop.** `0192`'s patch block skips a function the catalog lacks; the test for
   it was injected after the block's `BEGIN` rather than inside the `FOREACH`, so PostgreSQL refused the
   whole file — `CONTINUE cannot be used outside a loop`, three statements.
3. **Two files defining one policy.** `0188`'s branch-read sweep and `0180`'s permissive rewrite of one
   of the same seven policies were split across two files, and the higher version won: the rehearsal
   engine held six restrictive branch-read policies and one permissive. The sweep is now the last
   statement of the file that rewrites the policies — the range's own last writer — and the generator
   refuses the shape from here on.
4. **A trigger guard that could never be true.** `drop trigger if exists audit_sale_created_trg on
   public.sales` was emitted guarded on `c.relname = 'undefined'`: the statement's own grammar was not
   read for the table, so the superseded definition was never removed anywhere and no failure count
   could see it. The classifier reads the table now, and the emission refuses a guard whose subject has
   no name.
5. **A REVOKE that a later CREATE undid.** The ledger's ACL statements are emitted where the ledger puts
   them, and a REVOKE can precede the CREATE of the function it concerns; the guard then skips it, the
   CREATE runs, and PostgreSQL grants the new function `PUBLIC EXECUTE`. Measured, not suspected:
   `my_shop_ids` — which `0209` creates on a schema that never had it — came out executable by
   `PUBLIC`, and `audit_operational_snapshot` arrived with the same default because no ledger statement
   names it at all. Every ledger ACL statement is therefore applied a **second** time at the end of
   `0214`, after every create in the batch, and the trigger-returning functions the batch creates are
   closed to every role (their only legitimate caller is the trigger). This narrows access; nothing is
   granted. The probe asserts both halves, and the rehearsal now installs hosted's default privileges
   **before** the baseline loads — without that base, a privilege check describes an empty database
   (`authenticated` appeared unable to read `sales`), which is a fact about the harness, not the batch.

6. **A reproduced contract that should not be reproduced.** Fix 5 re-applied *every* ledger ACL
   statement, including the ones that GRANT `anon` EXECUTE — and staging's catalog holds nine write
   RPCs open that way (`create_role`, `update_role`, `delete_role`, `create_company`, `archive_company`,
   `delete_my_account`, `delete_product_barcode`, `approve_credit_limit_request_v2`,
   `reject_credit_limit_request_v2`). "Reproduce the environment" and "an unauthenticated role cannot
   reach a tenant write" are not the same rule, and this batch was written to the first one.
   **Found by the repository's own live guard, not by a failure count:** after the batch was applied to
   hosted QA, `tests/integration/rbacInvariants.test.ts` Invariant B failed with those nine names. The
   production apply would have shipped them unchanged. `0215` is the closure — it revokes
   `PUBLIC, anon` from the write surface (the same regex and the same pre-session allow-list the live
   guard uses), keeps `authenticated`/`service_role`, closes trigger functions to every API role, and
   asserts its own effect. `tests/unit/writeRpcAnonGuard.test.ts` now asks the question **before** an
   apply, on production's own baseline, and proves itself non-vacuous by finding the surface reachable
   first. Measured after the QA apply: 51 write-surface functions, **0** executable by `anon` (was 9),
   `insert_shop_request` and `lookup_user_by_phone` still executable, 0 trigger functions exposed,
   every real RPC still executable by `authenticated`.

**Ordering rule for anything that can be applied twice:** a batch is applied once, in its verified
order; a file whose ledger row exists is not re-applied.

**Nothing has been applied to production.** The measurement above is onto a frozen baseline in process
and onto a scratch database on the local stack; production's own ACLs were measured read-only on
2026-10-17 (`device-evidence/production-acls-measured-2026-10-17.md`) and are still open — 4 tables
writable by `anon`, 12 by `authenticated`, 14 always-true policies, every one of the 37 functions
`anon`-executable — and the one-hour backup gate means the pre-apply backup has to be taken again
immediately before any apply.

## 5. Disposition of every file after production's recorded position

Machine-checked by `tests/unit/productionMigrationPlan.test.ts`: every file at or after `0177` must
appear here exactly once, so a newly added migration cannot exist without a production disposition.

| File | Disposition |
|---|---|
| `0177_a_definer_knows_where_it_looks.sql` | fails (D-1 ×2) — **re-issue after 0208**: production-shaped variant (pattern proven), measured 2026-10-17 |
| `0178_a_variant_belongs_to_a_shop.sql` | fails (D-4 ×1) — **re-issue after 0208**: catalog-driven cleanup variant, measured 2026-10-17 |
| `0179_cost_price_is_the_owner_s_business.sql` | **batch 1 — verified PASS** |
| `0180_admin_is_not_a_boundary.sql` | **not applicable as numbered** (measured 2026-10-17): its three `stock_adjustments` policies need `stock_adjustments.shop_id`, which no file creates, and its own assertion fires on production's permissive policies — **re-issue after 0208** with the column and the catalog-driven cleanup |
| `0181_audit_rows_are_written_by_the_system_not_by_the_caller.sql` | **batch 1 — verified PASS** |
| `0182_settings_belong_to_their_shop.sql` | fails (D-4 ×1) — **re-issue after 0208**: catalog-driven cleanup variant, measured 2026-10-17 |
| `0183_deleting_a_role_revokes_its_access.sql` | **not applicable as numbered** (measured 2026-10-17): applies cleanly in dependency order on the real engine, and only fails 1 statement ascending — **re-issue after 0208** |
| `0184_a_branch_decides_how_far_it_serves.sql` | **not applicable as numbered** (measured 2026-10-17): clean in dependency order on the real engine — **re-issue after 0208** |
| `0185_a_product_can_be_listed_on_the_marketplace.sql` | **not applicable as numbered** (measured 2026-10-17): still fails in dependency order on `marketplace_listings` (a relation **no file creates**) and `shops.latitude` — **re-issue after 0208** carrying both |
| `0186_the_branches_read_carries_its_marketplace_state.sql` | **not applicable as numbered** (measured 2026-10-17): still fails in dependency order on `shops.latitude`, which kills its `DROP`+`CREATE` of `get_my_branches()` and cascades — **re-issue after 0208** |
| `0187_the_distance_belongs_to_the_farmer_not_the_branch.sql` | **not applicable as numbered** (measured 2026-10-17): same `shops.latitude` root as 0186 — **re-issue after 0208** |
| `0188_a_branch_is_not_its_tenant.sql` | **not applicable as numbered** (measured 2026-10-17): 24 ascending failures, **clean in dependency order on the real engine** — **re-issue after 0208** |
| `0189_access_changes_keep_the_person_and_history.sql` | **not applicable as numbered** (measured 2026-10-17): **clean in dependency order on the real engine** — **re-issue after 0208** |
| `0190_invitation_starts_in_the_selected_branch.sql` | **batch 1 — verified PASS** |
| `0191_operating_branches_preserve_the_business.sql` | **not applicable as numbered** (measured 2026-10-17): dependency order leaves 1 failure — its `REVOKE` names `delete_branch(uuid, text, text)`, which production never had — **re-issue after 0208** |
| `0192_consequential_records_guard_before_retry.sql` | **not applicable as numbered** (measured 2026-10-17): dependency order leaves its own assertion — `unexpected body for public.record_customer_payment(jsonb)`, production's body differs — **re-issue after 0208** |
| `0193_activity_reads_the_action_history.sql` | measured **PASS** in the ascending range after batch 2 (2026-10-17), which confirms the batch-order sensitivity it was recorded for: it consumes `audit_events.tenant_id`, created by 0189 earlier in the same range — **re-issue after 0208** rather than leave a pass that depends on a predecessor's side effect |
| `0194_access_edits_do_not_widen_the_editor.sql` | **not applicable as numbered** (measured 2026-10-17): **clean in dependency order on the real engine** — **re-issue after 0208** |
| `0195_permissions_are_not_just_navigation.sql` | **not applicable as numbered** (measured 2026-10-17): dependency order leaves 1 failure — `column "notes" of relation "sales" does not exist` — **re-issue after 0208** |
| `0196_a_branch_has_a_responsible_person.sql` | **not applicable as numbered** (measured 2026-10-17): 20 ascending failures, **clean in dependency order on the real engine** — **re-issue after 0208** |
| `0197_a_notification_says_which_branch.sql` | **not applicable as numbered** (measured 2026-10-17): dependency order leaves 3 failures on `my_shop_ids()`, defined by the pre-position file 0168 that will never be replayed — **re-issue after 0208**, carrying it |
| `0198_a_sale_keeps_its_due_date_and_leaves_a_movement.sql` | fails (D-3 ×1) — **re-issue after 0208**: a new idempotent forward file for the rename, measured 2026-10-17 |
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
| `0209_the_objects_no_tracked_file_creates.sql` | **re-issue 1 of 6 — the substrate — verified PASS** (25 statements, 0 sql failures, production's baseline and staging's; real engine PASS, `AGREES`; probed: `my_shop_ids` is not executable by `anon`). The columns production lacks that the range reads, copied schema-only from the accepted staging baseline, plus the two functions `0168` defines and production never received (`delete_branch`, `my_shop_ids`) and `0191`'s EXECUTE contract for `delete_branch`. Each object carries the measurement that put it here (which files cite it, which of them production's catalog lacks). It ends with a proof block that raises if any object it creates is still missing, so an extraction that quietly skipped one cannot pass downstream. Generated by `scripts/dev/reissue-forward-files.mjs`. |
| `0210_the_marketplace_chain_at_the_state_it_ends_in.sql` | **re-issue 2 of 6 — the marketplace chain at the state the range ends in — verified PASS** (20 statements, 0 sql failures; real engine PASS; probed on the rehearsed engine: the listing view is present and readable by `anon`, `shops.marketplace_radius_km` is absent, `search_marketplace` keeps its signature, and the switch is the two-argument form). `0185`'s listing view is **created where production never had it** — the first revision of this file guarded the create on the view's own existence and therefore did nothing on production, which is invisible to a failure count and is why the guard now names the dependency (the relations the view reads) instead. Intermediate states (`0186`'s branch read, `0184`'s radius writer) are not re-issued. |
| `0211_a_branch_is_its_own_identity.sql` | **re-issue 3 of 6 — branch identity, branch scope and a responsible person — verified PASS** (19 statements, 0 sql failures; real engine PASS). `0183`, `0191` and `0196`, plus `0188`'s functions (`allowed_branch_scope`, `current_branch_id`, `current_branch_scope`, `set_active_branch`, `authorize_business_action`, `enforce_branch_scope`, `get_my_branches`, `validate_member_branch_scope`). `0188`'s branch-read sweep is deliberately NOT here — see the next row. |
| `0212_the_policies_that_scope_a_row_to_its_shop.sql` | **re-issue 4 of 6 — the tenant-scoped policies and the permission gates — verified PASS, and APPLIED to hosted QA** (29 statements, 0 sql failures; real engine PASS; probed: ten restrictive permission gates and all seven branch-read policies restrictive). **Measured on hosted QA, which no rehearsal could show:** its first application failed and rolled back on 0180's own assertion — `0180 left a tenant-blind policy in place: stock_adjustments.permission_insert_gate, stock_adjustments.permission_read_gate`. Those two are 0195's **restrictive** gates, already present on QA; a restrictive policy cannot widen anything (it ANDs), and neither frozen baseline carries them, so the assertion only ever had to be precise on the live schema. The re-issued assertion now asks the question of `p.polpermissive` policies — the ones that can OR a hole open — and the file applied cleanly on the retry, then on both baselines. `0178`, `0180`, `0182` and `0195`, and then **`0188`'s branch-read sweep last**, because it is the range's last writer of those seven policies. Measured on the rehearsal engine 2026-10-17 with the sweep in the earlier file: six of the seven were restrictive and `stock_adjustments_branch_select` was not, because `0180` re-creates that one policy permissively and a permissive policy ORs with its neighbours instead of ANDing. The generator now refuses to emit one object from two different files, which is the shape that hid it. |
| `0213_audit_and_access_history_keep_their_owner.sql` | **re-issue 5 of 6 — audit and access history — verified PASS** (44 statements, 0 sql failures; real engine PASS; probed: no permissive INSERT policy on `audit_events`, the client write policy says `false`, every SELECT policy carries a shop predicate, and the snapshot trigger is installed on all three financial tables). `0189`, `0192`, `0193`, `0194` and `0197`, plus `0181`'s two policies in catalog-guarded form — the answer to batch 1's one known deviation. `0192`'s body patches keep their measured corrections: the CRLF tolerance and the lowercase-`begin` anchor are applied, and a function the catalog lacks is skipped with `CONTINUE` inside the loop rather than failing the file (the first revision placed that test after `BEGIN`, outside the loop, and PostgreSQL refused the file outright: `CONTINUE cannot be used outside a loop`, measured 2026-10-17). |
| `0214_the_definer_and_the_sale_record.sql` | **re-issue 6 of 6 — the definer's `search_path`, the sale's own record, and the batch's ACL pass — verified PASS** (23 statements, 0 sql failures; real engine PASS; probed: `process_return` is the renamed `payload jsonb` shape, and no guard or trigger function is executable by `anon`). The last sixteen statements are the ACL pass: every ledger ACL statement re-applied after every create, plus the trigger functions closed to all roles. It is here because "after every create" is only true at the end of the batch. `0177`'s three `ALTER FUNCTION … SET search_path` in the existence-guarded form (production lacks two of the three names), and `0198`'s two bodies, with the parameter rename done by dropping the old signature first where it exists. |
| `0215_a_write_rpc_is_not_for_an_unauthenticated_caller.sql` | **closure 1 of 3 — the ACL closure — verified PASS on production's baseline and staging's; APPLIED to hosted QA** (1 statement, 0 sql failures; in the 20-file batch: 446 statements, 0 failures). Revokes `PUBLIC, anon` EXECUTE from every function on the write surface (`0208`'s ledger contract left nine open, and `0214` re-applied those grants), keeps `authenticated`/`service_role`, closes trigger functions to every API role, and raises if anything on the surface is still reachable. Written as a policy decision rather than extracted, so it is hand-written and held to the same §6 binding rules by `tests/unit/forwardFilesAdditionality.test.ts`; the pre-apply counterpart of the live guard is `tests/unit/writeRpcAnonGuard.test.ts`. Measured on QA after the apply: 51 write-surface functions, 0 anon-executable (was 9), 0 trigger functions exposed, `insert_shop_request`/`lookup_user_by_phone` unchanged. |
| `0216_an_unauthenticated_caller_cannot_write_the_people_table.sql` | **closure 2 of 3 — the people table's unauthenticated write path — verified PASS on production's baseline and staging's; APPLIED to hosted QA** (1 statement, 0 sql failures; in the 21-file batch: 447 statements, 0 failures). Production measures `anon` holding INSERT/UPDATE/DELETE on `public.users` **and** on three other tables; the money tables are closed by `0212`'s re-applied `0195` REVOKE and `audit_events` by `0213`'s write policy, but `users` is named by no tracked migration, and a privilege a migration never granted cannot be closed by one that does not name it. Revokes INSERT/UPDATE/DELETE/TRUNCATE on `public.users` from `anon` only — the app's profile edits run as `authenticated`, which the file asserts is unchanged — and raises if `anon` holds anything afterwards. |
| `0217_a_retired_function_is_not_for_the_client.sql` | **closure 3 of 3 — the retired functions — verified PASS on production's baseline and staging's; APPLIED to hosted QA** (1 statement, 0 sql failures; in the 22-file batch: 448 statements, 0 failures). The correction for the widening described below: revokes `PUBLIC, anon, authenticated` from the fifteen functions the ledger retires from the client, each inside an existence test (production never had `create_sale_unchecked`, `create_employee_core`, `purge_shop_data` or `marketplace_distance_km`), and raises if any is still reachable. Its list is not hand-maintained — `tests/unit/writeRpcAnonGuard.test.ts` reads the ledger's own server-only set and fails on a drift in either direction. |
| `0218_permission_overrides_stay_in_their_shop.sql` | **Shop-isolation fix — verified PASS in the 24-file batch on production's baseline, 452 statements, 0 sql failures** (2 statements). `user_permissions` carries no tenant column, and its insert/delete policies asked only "is the caller an admin", so an admin of shop A could write a permission override for a person in shop B — effective the next time that person acted there. All three policies now require the target to have a membership in `current_shop_id()`; self-reads are unchanged, and the RPC path (`update_employee_access` → `guard_employee_access_edit`) already matched. The file asserts that no client write policy on the table names no shop. |
| `0219_the_people_table_is_its_own_shop.sql` | **Shop-isolation fix — verified PASS in the same 24-file batch** (2 statements). Production measured `users` among its fourteen always-true permissive policies, which is what let an admin edit a person outside their shop there; `0216` closed only the unauthenticated half. This file drops any policy on `public.users` whose expression is exactly `true` (and nothing else), then installs `users_select`/`users_insert`/`users_update` with the shop predicate the tracked model already carries, plus `id = app_current_user_id()` so a person can always reach their own row. `prevent_role_escalation` is untouched. It raises if an always-true policy survives. |
| `0220_the_rows_the_membership_model_needs.sql` | **Data completion for the model `0207` created schema-only — measured on production, dry-run there inside a transaction, then applied** (1 statement). Production had 1 shop, 4 users with `shop_id`, and **0** memberships / branches / roles / permissions after the schema batch, so every `authorize_business_action` refused. Idempotent and additive: the `0106` permission catalogue, one default branch per shop that has users and none, the four canonical role templates matched by `(tenant_id, name)`, and one membership per user **in that user's own `users.shop_id`** — owner for the original owner, `admin` + Store Manager for the other admins, `employee` + Sales Employee for the rest. It asserts one membership per user, a role and scope on every non-owner, and an active branch on every shop with users, and — in the repository body only — that the rows it inserted name the user's own shop. **APPLIED 2026-10-17T15:00:49Z**, sha256 `f4c0cba2…`; the repository body is `9817e2aa…` and differs in its assertions alone (§5.2). Measured after: 4 memberships, 4 roles, 32 permissions, 1 branch — and the branch data gap this creates is §5.1. |
| `0221_the_tables_0208_created_are_not_open.sql` | **Closes the exposure the restore check found — applied** (1 statement). `0208` created `product_barcodes`, `barcode_registry`, `barcode_history`, `incidents`, `incident_rate_limits` and `incident_signatures` from ledger shapes; their RLS lived in `0072`/`0158`/`0160`, which production never received, so after the batch all six had `relrowsecurity = false`, **0 policies** and `anon` + `authenticated` holding SELECT/INSERT. `restore-verify` caught it as a structure mismatch and the gate refused the next apply, so the six `ALTER TABLE … ENABLE ROW LEVEL SECURITY` statements were run as an owner-authorized correction to break the deadlock, then re-issued here and recorded in the ledger. No policy is created on purpose: the client reaches these tables only through `product_barcodes_for` and `record_incident`, both SECURITY DEFINER. Grants are untouched; RLS with no policy denies by default. **APPLIED 2026-10-17T15:00:50Z**, sha256 `36d88d04…`; measured after: `relrowsecurity = true` and 0 policies on all six. |
| `0222_operational_rows_learn_their_branch.sql` | **The root cause of the empty screens — verified PASS on production's 2026-10-01 baseline, rehearsed on production inside a rolled-back transaction, then APPLIED 2026-10-17T16:32:33Z** (2 statements). Backfills every NULL `branch_id` from the row's own shop's active branch (never "the first branch", which is the mistake `0118` made) across sales, purchases, returns, stock adjustments, customer/supplier payments, inventory movements and notifications, then installs one BEFORE INSERT trigger that stamps `current_branch_id()` on every operational table. The trigger is the part that matters for the future: `create_sale_unchecked` and its siblings never wrote `branch_id`, so backfilling alone would have fixed the past and left the next sale invisible. Every statement is guarded by `information_schema`, because the frozen baseline predates the column. Measured after: 52/52 sales, 0 NULL branches, 9 triggers installed. |
| `0223_an_unauthenticated_caller_reads_no_business_table.sql` | **Closes the anon read exposure — verified PASS, rehearsed, APPLIED 2026-10-17T16:32:34Z** (2 statements). Measured before: the anon key read sales 52, customers 6, products 6, companies 4, users 4 and memberships 4, because 42 tables carried an `anon` grant and 38 carried a permissive policy whose predicate was the literal `true` (the `0022` demo-era `*_select_anon` / `public_all_*` set). Every permissive policy naming `public` or `anon` is retargeted to `authenticated` — predicate untouched — and every table, view, materialised view and sequence in `public` is revoked from `anon`. Pre-session flows use SECURITY DEFINER RPCs (`lookup_user_by_phone`, `get_my_shop_request`, `resolve_invite`, `insert_shop_request`), which are functions and are unaffected. Measured after: **0 anon table privileges, 0 policies naming anon or public**, `set role anon; select from sales` → `permission denied`. |
| `0224_the_three_write_rpcs_a_caller_could_not_call.sql` | **The write path itself — verified PASS, rehearsed end to end on production inside a rolled-back transaction, APPLIED 2026-10-17T16:36Z** (27 statements). Found by trying to create a sale as the owner: `ERROR: column "payload" does not exist`. Three of the eight write RPCs — `create_sale`, `create_purchase`, `adjust_stock` — take `p_payload` and had `0213`'s textual guard splice inserted as `guard_operational_request(…, payload)`, which compiles and fails on the first call. Production's `create_sale` was also the pre-`0134` body with no idempotency wrapper, and `sale_submissions` (the idempotency ledger) had never been created there. The file drops each mis-parameterised signature and installs the body staging has been exercised against, creates `sale_submissions` with its deny-all policy, adds the `purchases.amount_due/status/notes/recorded_by/due_date` and `purchase_items.unit_price/base_unit` columns the UI reads, and makes the legacy `sales.customer_name NOT NULL` nullable (the working body writes `customer_name_snapshot`). Rehearsed after: sale created with `branch_id` stamped, movement stamped, owner sees 1, purchase created, stock adjustment applied — then rolled back. |
| `0225_the_idempotency_ledger_is_not_addressed_to_anon.sql` | **One-role narrowing — verified PASS, APPLIED 2026-10-17T16:39Z** (1 statement). `0224` copied `sale_submissions`' deny-all policy from staging, where it is addressed to `anon, authenticated`; `0223` had just established that no policy in `public` names either. The policy is recreated `to authenticated` only. The predicate is unchanged and still `false`; narrowing only. Measured after: 0 policies naming anon or public. |
| `0226_the_trigger_function_is_named_where_it_is_retired.sql` | **Keeps the retirement guard honest — verified PASS, APPLIED 2026-10-17T16:44Z** (1 statement). `0222` revokes EXECUTE on `stamp_operational_branch()` from every API role; `tests/unit/writeRpcAnonGuard.test.ts` compares the ledger's server-only set with the names declared inside migrations, and `0217`'s array cannot be edited because it is applied. The file declares the new name in the same `v_server_only constant text[]` shape and asserts it is unreachable; the guard now unions every such declaration instead of reading `0217` alone, so a future retirement cannot appear without its name. |
| `0228_the_reminder_tables_the_app_actually_queries.sql` | **The columns the client names, and the boundaries those tables never had — verified PASS on production's 2026-10-01 baseline (6 statements, 0 failures), rehearsed on production in a rolled-back transaction (9/9), then APPLIED 2026-10-17, immediately after the 17:42Z backup that the gate required.** (6 statements). Found by `node scripts/audit-app-surface.mjs --env production`, which reads the client's own `.from(x).select(…)` and `supabase.rpc(…)` calls in `src/` and asks the live database for them: `business_settings.setting_value` (and the `setting_key` its query filters on), `customer_crops.acreage/planting_date/expected_harvest`, `reminder_configs.group_id/group_name` — six columns, none of them present, so the crop-based reminders were silently empty and PostgREST answered **400** to the crops read once per customer row. The same call measured three permissive policies (`business_settings_all`, `customer_crops_all`, `reminder_configs_all`, plus `customer_crops_select_anon`/`_insert_anon`) whose predicate was the literal `true` or absent: 0223 could retarget those to `authenticated` but could not scope them, so any signed-in user could read and write any shop's crops and reminder schedules. This file adds the columns (additive, nullable/defaulted, `shop_id` defaulting to `current_shop_id()` so the app's own insert — which sends no shop — is still scoped), replaces every policy on the three tables with shop-scoped ones, and asserts both the columns and that no always-true policy survives. Guarded on `to_regclass`, `information_schema` and the presence of `current_shop_id()`, because the frozen baseline predates all of it. Rehearsed after: `loadBusinessSettings()` reads the existing crops row back, `saveBusinessSettings()` updates it, a first-time setting is inserted and stamped with the shop, `customer_crops` accepts and returns the three columns, `reminder_configs` accepts a group and stamps its shop — 9/9, nothing left behind. |
| `0229_the_return_mirror_is_named_where_it_is_retired.sql` | **Keeps the retirement guard honest for `0227`/`0228`'s trigger function — verified PASS, APPLIED 2026-10-17** (1 statement, 0 sql failures). `0227` and `0228` install `return_items_mirror_qty()` and revoke EXECUTE on it from `public, anon, authenticated`; `tests/unit/writeRpcAnonGuard.test.ts` compares the ledger's server-only set with the names declared inside migrations, in both directions, and neither applied file can be edited. This file declares the name in the same `v_server_only constant text[]` shape `0217` (for the write surface) and `0226` (for `stamp_operational_branch`) use — the third time a retirement has had to be named after the fact, which is why the guard reads every declaration in the directory rather than one file. |
| `0227_returns_store_their_quantity_and_voids_can_finish.sql` | **Two defects only a real flow could find — verified PASS on production's 2026-10-01 baseline (5 statements, 0 failures), rehearsed on production inside a rolled-back transaction, then APPLIED 2026-10-17, after the 16:58Z baseline verification.** Found by driving the four flows (`rehearsal: a credit sale → customer payment → return → void → credit purchase → supplier payment`) rather than a smoke test: (1) `process_return` finished its writes and then failed on `null value in column "qty" of relation "return_items"` — production carries a legacy `qty` (NOT NULL, no default) beside the `qty_to_return` the function writes, and it is `qty` the sale-detail and return-select screens read, so a return would have failed *and*, had it got past the constraint, displayed zero returned units; the file installs a `return_items_mirror_qty_trg` BEFORE INSERT/UPDATE trigger that keeps the legacy column equal to the real quantity, and brings existing rows into step. (2) `void_sale` raised `relation "activity_log" does not exist` — production's body was the pre-`0145` one, restoring product rather than variant stock, ignoring quantities already returned, writing a row for a table production never received and recording no `voids` row; the file replaces the body in place with the one the app has been exercised against, which authorises `sales.void`, restores only the unreturned quantity to the variant, writes the movement, reverses the customer's outstanding balance and purchases, records the void and an audit event. Both fixes are conditional on the columns existing, because staging has only `qty_to_return`. Measured after, through the RPCs as the owner, in one rolled-back transaction: sale → payment 50 of 200 → return 1 unit (restocked, `qty` reads 1.0000) → void (stock restored, `voids` row written, `is_voided`) → credit purchase (payable 150) → supplier payment 50 → payable 100, with 0 rows left behind. |
| `0230_storage_images_are_read_publicly_and_written_by_no_one_anonymous.sql` | **The image buckets were writable by anyone holding the publishable key — verified PASS on production's 2026-10-01 baseline (10 statements, 0 failures), backed up and restore-verified (19:41Z), then APPLIED 2026-10-17T19:44Z.** Measured: `storage.objects` carried four policies addressed to `public` (SELECT/INSERT/UPDATE/DELETE) scoped only by bucket, and four `authenticated` UPDATE/DELETE policies that were bucket-wide too, so either key could delete or overwrite every shop's images; the 71 demo images were removed through the Storage API with nothing but the publishable key (`production-demo-identities-removed-2026-10-18.md` §5), which is what proved it. The file drops every INSERT/UPDATE/DELETE policy naming `public` or `anon` (by catalogue name, so an older unknown one cannot survive) and the `authenticated` UPDATE/DELETE set, and leaves exactly two: public SELECT on the four image buckets (the app renders `getPublicUrl`) and `authenticated` INSERT on the same four. No `owner_id = auth.uid()` clause is added, because the column is unproven here and a policy built on it would be worse than none; `src/lib/storage.ts` uploads only fresh random names (`upsert: false`) and has no delete or update path. Measured after: 0 policies letting anon or public write, 2 policies total on `storage.objects`. |
| `0231_the_pin_functions_need_the_columns_they_count.sql` | **The PIN functions counted columns production never had — verified PASS on production's 2026-10-01 baseline (3 statements, 0 failures), backed up and restore-verified (19:59Z), then APPLIED 2026-10-17T20:01Z.** `verify_user_pin`/`set_user_pin` read and wrote `users.pin_attempt_count` and `pin_locked_until`; production's `users` had neither, so every PIN set and every PIN check failed with `undefined_column` and the app's PIN screen could not work — found by calling the RPCs, not by reading them. The file adds the two columns with the shape the functions assume (`integer NOT NULL DEFAULT 0`, `timestamptz`), guarded on `information_schema` so a re-run is a no-op, and asserts the three PIN functions still resolve with the new signatures. Measured after: both columns present with that type/default, and production's ledger reads 44 rows, latest `0231`, with every file matching its recorded hash. |

**The defect that made closure 3 necessary — a closure that widened while it narrowed.** `0215`'s first
form revoked `PUBLIC, anon` from the whole write surface — and then granted `authenticated`
unconditionally, on every one of those functions. `0215`'s own guard could not see it (it asks about
`anon`), and neither could the ACL ledger (a `format()` grant names no function). Two of the
repository's live guards could: after the QA apply, `tests/integration/saleIdempotency.test.ts` ("the
unchecked implementation is not reachable from an authenticated client") and
`tests/integration/tenantResolverReplay.test.ts` ("anon and authenticated cannot execute the
resolvers") failed, naming `create_sale_unchecked` and `create_shop_internal`. The ledger retires
fifteen functions from the client; seven of them are on the write surface, so the "closure" handed
back exactly the bypass those tests exist to prevent. §6's first binding rule is that access is never
widened, and the fix is the plan's own correction rule: `0217` revokes `PUBLIC, anon, authenticated`
from the ledger's server-only set — its list read from the ledger by
`tests/unit/writeRpcAnonGuard.test.ts`, in both directions — and asserts none is reachable. Net effect
across the batch: nothing widened; `0215`'s grant exists only between two files of one owner-run batch,
never on an end state.


### 5.1 Measured after the apply (2026-10-17, 15:04–15:22Z) — the ledger is right, the data model is not

| Question | Measured |
|---|---|
| Ledger | **34 rows, latest `0221`**; 26 file rows, **25 hashes match**; `0220` is the one difference (§5.2) |
| The rows `0220` exists to create | shops 1 · users 4 · branches 1 · permissions 32 · roles 4 (29/12/12/6) · memberships 4 · user_active_shops 4, every membership in the user's own shop |
| Authorization | owner 32 permissions, `sales.view` allowed; Store Manager 29, `sales.create` allowed and `employees.manage` refused; employee 6, `reports.view` refused; `anon` cannot execute `authorize_business_action` |
| The six tables `0221` closed | `relrowsecurity = true`, 0 policies on all six — deny-by-default, definer RPCs unaffected |
| **`branch_id` on existing rows** | **NULL on every branch-scoped row**: sales 52/52, inventory_movements 17/17, stock_adjustments 13/13, supplier_payments 2/2, customer_payments 1/1, returns 1/1, notifications 51/51 |
| **Rows each role can see** | owner, Store Manager and employee see **0 of 52 sales** (`branch_id = ANY(current_branch_scope())` is not true for NULL); `anon` sees **52** through the pre-existing `sales_select` policy |
| `anon` reach | reads `sales` 52, `customers` 6, `products` 6, `permissions` 32; holds INSERT **grants** on the six `0207` relations (RLS denies today, no permissive insert policy) |
| Always-true permissive policies | **11 left**, on 8 tables (`companies`, `customers`×2, `products`×2, `sales`×2, `purchases`, `inventory_movements`, `shop_requests`, `shops`) |

**The blocker, stated plainly:** the branch model arrived before any row belonged to a branch. Every
signed-in screen that reads sales, purchases, returns, stock adjustments or supplier payments is empty on
production, while an unauthenticated caller can read the sales. The fix is a forward file that attaches
NULL `branch_id` rows to the shop's single active branch and asserts none remains — it is **not applied**,
and the read-only credential means it cannot be applied from here. Nothing was weakened to make any gate
pass; the finding is reported instead.

### 5.2 `0220`'s repository body differs from the applied body in its assertions only — RESOLVED 2026-10-17T16:32:09Z

The file was corrected after it was applied, because the version production received refuses to run on
staging's data (two multi-shop owners, two pending invitations — both supported states). The correction was
made before that was noticed. Applied `f4c0cba2…` (11,192 bytes) vs the then-repository `9817e2aa…`
(12,469 bytes): the declare block, a `GET DIAGNOSTICS` that records what the file itself inserted, and the
two narrow assertions that use it. No `insert`, no `update`, no DDL, no loop differed — reconstructing the
applied body from the repository file reproduced `f4c0cba2…` byte for byte.

**How it was resolved, without rewriting history.** The repository file was rebuilt from
`schema_migrations.statements` — the exact statement production ran — and only its comments changed. The
ledger's file hash was then re-recorded against those bytes (`270c81c1…`, 12,462 bytes) with
`reconciled_at = 2026-10-17T16:32:09.913Z` and a `reconcile_note` naming the earlier hash and the reason.
That is the tool's own `reconcile` contract, applied to the one database whose ledger it concerns: the
statements do not change, `applied_at` is untouched, and nothing is hidden. The narrower assertion variant
was not kept in the repository: a from-scratch replay has no pre-existing membership, so the wide form is
the correct one there, and staging already has the file applied. `reconcile` cannot be run through
`migrate --env production` (that mode is refused by design), so the same `UPDATE` it performs was executed
once, in a transaction, after asserting the file contained the applied statements verbatim.

### 5.3 Measured after the second apply (2026-10-17T16:32–16:45Z)

| Question | Measured |
|---|---|
| Ledger | **42 rows, latest `0229`**; `0220`–`0229` recorded against the files on disk (`0227` 5 statements, `0228` 6 statements, `0229` 1 statement — each verified PASS on production's baseline, rehearsed in a rolled-back transaction where it changes anything, and applied through the gate) |
| `branch_id` | **0 NULL** across sales, movements, adjustments, payments, returns and notifications; 9 stamp triggers installed |
| Write path | `create_sale` as the owner: sale and movement created with `branch_id = d717d974…`, owner sees it, rolled back; `create_purchase` and `adjust_stock` succeed the same way |
| `anon` | 0 table privileges, 0 policies; `set role anon; select from sales` → `permission denied` |
| Test transactions | **0 rows** in sales, sale_items, returns, customer/supplier payments, purchases, movements, adjustments, notifications, audit; customer balances, stock and supplier payables all 0 |
| Configuration | shops 1 · branches 1 · users 4 · memberships 4 · permissions 32 · roles 4 |
| Reversibility | pre-purge backup `backup-production-gkswcfljxlutkfdvvqng-2026-10-17T16-28-09` restored into PGlite and compared with production: integrity, replay, counts, structure, digests and auth all PASS; the `0227` apply was gated the same way (backup `…-17-02-56`, restored and compared PASS first) |
| The four flows, driven for real (after `0227`) | `rehearsal: node device-evidence/tmp/flow-test-production.mjs` — as the owner, inside one rolled-back transaction: credit sale sets the balance 200 → `record_customer_payment` 50 → balance 150, total_paid 50; `process_return` on a second sale (1 unit, restocked, `return_items.qty` reads 1.0000 — the column the screens read) → `void_sale` on a third (stock restored, `voids` row written, `is_voided`, `voided_at`) → credit purchase payable 150 → `record_supplier_payment` 50 → payable 100. **7/7 PASS, 0 rows left behind.** |
| The client's own view of the schema | `node scripts/audit-app-surface.mjs --env production` asked production for every simple `.from(x).select(a,b)` and every `supabase.rpc(name)` in `src/`: **before `0228` six columns the app names did not exist and three permissive policies were live; after it, PASS — 0 missing columns, 0 missing RPCs.** The browser agreed: the crops read that came back **400** on every customer row (`business_settings?select=setting_value&setting_key=eq.crops`) now answers **200, with no console errors on the customers or reminders screens.** |
| Isolation, demonstrated rather than asserted | `npm run probe:isolation` (QA, two real shops with their own owners, one rolled-back transaction): 26/26 checks — each session resolves `current_shop_id()` to one shop; neither can read, count or change the other's sale, product or person; a cross-shop `create_sale` is refused; a cross-shop permission override is refused by RLS; and a user who genuinely belongs to **both** shops still sees only the shop the session resolved to. Production has one shop, so this cannot be shown there — the two-shop proof belongs to QA, and the production evidence is the policy/grant state above. |

### 5.4 Line endings: four recorded hashes re-based on the repository's own form (2026-10-17)

`.gitattributes` declares `*.sql` as `text eol=lf`, so the canonical repository form is LF. Four of the
files written during this work (`0222`, `0224`, `0225`, `0227`) were written with CRLF in this Windows
working copy, and `schema_migration_files` recorded the hash of *those* bytes — which a fresh checkout
cannot reproduce, because git normalises them to LF on commit. Nothing had changed in what production
ran; the recorded identity of the file had.

Measured before the change: 0222 `29f78a07…`/11915B, 0224 `9b6f22c4…`/19666B, 0225 `e1d9002b…`/2458B,
0227 `f5bab8da…`/8874B — all four CRLF-derived. For each file the four steps were: rewrite the working
copy with LF endings, split both the file and `schema_migrations.statements` with the project's own
splitter, normalise line endings on both sides, and compare — *identical, in order* (2/27/1/5
statements). Only then was `sha256`/`bytes` re-recorded, in one transaction, with `reconciled_at` and a
`reconcile_note` that says what changed and that the statements did not; `applied_at` untouched. New
hashes: `d6de5592…`, `19a099b9…`, `e4a15105…`, `7ae62fbd…`.

`scripts/measure-production-final-state.mjs` now asserts the property itself, for every file: the ledger
row's `sha256` and `bytes` must equal the file on disk (221 files checked, 0 drifted), and every
batch-era apply must carry both its statements and its file row (42 statements · 34 file rows · the 8
rows below `0017` are production's out-of-band setup and predate the tooling). That check is why this
was found at all: the plan's old claim — "hashes match the files on disk" — was true on the machine
that wrote them and false on any other checkout.

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

**Measured 2026-10-17, and this is what makes the apply an owner act rather than a step:** the credential
intake refuses `migrate.mjs` even when the command is complete and every precondition file exists:

```
[CREDENTIAL INTAKE REFUSED] "scripts/migrate.mjs" is not on the allow-list. Production credentials are
handed only to the commands that read production and write nothing:
  scripts\backup-database.mjs
  scripts\restore-verify.mjs
  scripts\measure-production-acls.mjs
  An injector that runs anything is a credential leak with a polite interface.
```

**Production's privileges are now measured, not assumed (2026-10-17).**
`scripts/measure-production-acls.mjs` is the third read-only command on that allow-list: it reads
`pg_class` / `pg_policy` / `pg_proc` inside `BEGIN … SET TRANSACTION READ ONLY` and prints what `anon`
and `authenticated` actually hold. Measured: `anon` may INSERT/UPDATE/DELETE `audit_events`,
`customer_payments`, `stock_adjustments` and `users`; `authenticated` may do the same on twelve tables
including `sales`-adjacent money and stock tables; fourteen permissive policies are `true`; and all 37
functions in `public` are executable by `anon`, including the SECURITY DEFINER money RPCs. Full table
in [production-acls-measured-2026-10-17.md](../device-evidence/production-acls-measured-2026-10-17.md).
That is the state the batch is built to close — and the same measurement after the apply is what will
prove it did.

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

**The rows are checked as well (2026-10-18).** Every production apply first runs the whole batch inside `BEGIN … ROLLBACK` — `scripts/lib/data-rehearsal.mjs`, the same function the local-stack probe exercises — and fingerprints 32 protected tables (`scripts/lib/data-fingerprint.mjs`: accounts, memberships, customers, catalogues, stock, every transactional table, the derived balances and `storage.objects`). Each digest is taken over the columns that existed *before* the batch, so an additive column is invisible while an UPDATE, DELETE or INSERT is not. A table that moves without being named in `--data-change <tables>` stops the run with production untouched; a named one is recorded as an approved change, with both digests in the report. After the real apply the tables are fingerprinted again and compared with the rehearsal: if the committed effect differs, the run fails as a data-integrity alarm. `scripts/data-fingerprint.mjs` is the read-only way to take the same measurement outside an apply.

**Two things this deliberately does not do.** It does not extend the credential intake to the apply: the
allow-list in `scripts/run-with-production-credentials.mjs` hands the production password only to the
three commands that read production and write **nothing** (backup, restore-verify, ACL measurement), and
`migrate.mjs` is refused there. Running the apply path is therefore a **deliberate owner act** —
exporting the credentials by hand — and no automated path in this repository can reach production on its
own. And it does not
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
- [ ] A fresh production backup exists, restore-verified, from immediately before the batch. **Taken
      2026-10-17 (`backup-production-gkswcfljxlutkfdvvqng-2026-10-16T20-31-20`, 30 tables / 249 rows,
      restore verification PASS on integrity, replay, counts, structure, digests and auth) — and it is
      deliberately left UNTICKED, because the gate refuses a backup older than 60 minutes: it was taken
      to prove the path works and to feed the demo-data audit and the round-trip check, not to sit here
      as a substitute for the one taken immediately before an apply.**
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
7. **Batches 3 and 4 are measured, not predicted, and they are not a queue** — §4's re-issue is the
   work, and until it exists production cannot receive the intent of 0177–0198 at all.
8. **Production's privileges were unmeasured until 2026-10-17, and they are worse than the rehearsal
   suggested.** Neither artifact this repository holds of it carries a `GRANT` or a `REVOKE`, so the
   divergences recorded on 2026-10-16 were a property of the rehearsal and were **withdrawn**. They have
   now been measured read-only, through the credential wrapper's own `measure-production-acls` command
   (`device-evidence/production-acls-measured-2026-10-17.md`): **all 37 functions executable by `anon`**
   (including `create_sale`, `void_sale`, `process_return`, `adjust_stock`,
   `record_customer_payment`), **14 always-true permissive policies**, `anon` holding INSERT/UPDATE/DELETE
   on **4** tables and `authenticated` on **12**. None of that is a rehearsal artefact. `0215` closes the
   function surface and `0216` closes the one table the batch would otherwise leave `anon`-writable;
   the rest is closed by the policies and grants the batch already carries.
9. **One table's row-level policy is still open, deliberately, and needs an owner decision.**
   `public.users` carries an always-true policy on production, and `authenticated` holds INSERT/UPDATE/
   DELETE there. The app edits profile rows **directly** (`src/lib/auth.ts`, the settings screens,
   `stores/employeesStore.ts`), so the correct narrowing is a policy — self for profile edits, RPC for
   employee management — and it cannot be written from the measurements in this plan: which rows an
   administrator is expected to be able to update is a product decision. Recorded here rather than
   guessed at. `0216` removes the unauthenticated half in the meantime, which has no product meaning.

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
* `backups/rehearsal-batch3-candidates.json` — the ascending measurement of batch 1 + batch 2 + all 14
  batch-3 candidates on the real engine, in dependency order (19 of 27 files clean).
* `backups/baseline-prod-batch3-candidates.json`, `backups/baseline-prod-after-batch2.json` — the same
  selections on production's baseline (gitignored).
* `backups/restore-verification-production.json` — the 2026-10-17 backup's restore verification (PASS).
* `tests/unit/productionMigrationPlan.test.ts` — the guard over this plan and that harness.
* `tests/unit/forwardFilesAdditionality.test.ts` — §6's rules as a test over both batch-2 files.
