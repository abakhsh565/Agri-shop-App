# Production migration plan — reconciled against production itself

**Status: APPLIED 2026-10-18 — production's ledger holds 45 rows, latest `0232`.** The first apply closed the schema; the second closed the reasons the screens were empty: `0222` attaches every operational row — and every future one — to its branch, `0223` shuts the anon key out of every business table, `0224` repairs the three write RPCs a sale, purchase or stock adjustment could not get past, and the production test transactions were removed under the owner's written authorization (`scripts/purge-production-test-transactions.mjs`, dry-run by default, one transaction, invariants asserted before commit; pre-purge backup restored and compared PASS). The 24-file batch
went in at 14:44Z; `0220` and `0221` followed at 15:00:49Z and 15:00:50Z through the same gate, and
`0230`/`0231` at 19:44Z/20:01Z on 2026-10-17 — and `0232` at 23:26Z on 2026-10-17 — each with its
own baseline verification, backup and restore check. The
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
| `0232_the_curated_view_is_the_public_door_again.sql` | **A correction to `0223`, and it applies to production too — pending: needs a gated batch of one file.** `0223` revoked every privilege from `anon` across `public`, which took `marketplace_listings` with it. That grant is not an accident of the demo era: `0185` statement 13 grants `SELECT` to `anon, authenticated`, `0210` and `0214` re-issue it as the ledger's own ACL ("applied after every create"), and the view is the farmer-marketplace read contract — a public catalogue whose boundary is the owner's `marketplace_enabled` flag plus the farmer's own radius (`0186`, `0187`), which `tests/integration/tenantBoundarySweep.test.ts` states in as many words. Production carries `0223`, so **production's own public door is closed by this too**; that is a live product defect, not only a QA one. The file restores the single `grant select on public.marketplace_listings to anon` inside a `to_regclass` guard, and asserts the properties that make it safe: `anon` can read the view, holds no privilege on any other relation in `public`, and holds no `INSERT`/`UPDATE`/`DELETE` on the view. Guarded and additive, so a re-run on an environment that already has it changes nothing. **APPLIED to hosted QA 2026-10-18** (2 statements, recorded); measured there: `set role anon; select from marketplace_listings` succeeds and `products`, `product_variants`, `shops`, `inventory_movements`, `sales` stay refused 5/5. **APPLIED to production 2026-10-17T23:26Z through §7(a)'s gated path**, as a named batch of one file: the frozen 2026-10-01 baseline predates the objects this file depends on (`0210` created the view), so the file was verified against a fresh read-only capture of production taken at 23:16:38Z — PASS, 2 statements, 0 failures, artifact hash verified — and that same artifact was restored into a throwaway database and compared table by table (PASS: integrity, replay, 44/44 tables, row digests). The gate then refused nothing: verification 2.9 min old, backup 5.1 min old, restore all checks PASS, one file to apply. The batch was rehearsed against production inside a transaction that was rolled back — 32 tables fingerprinted, 0 unexpected row changes — and then recorded with its statements and its file row in the same transaction. Measured after: `anon` holds `SELECT` on `marketplace_listings` and no other privilege anywhere in `public` (ACL: `SELECT 1 · INSERT 0 · UPDATE 0 · DELETE 0` over 23 measured relations), `set role anon; select from public.marketplace_listings` succeeds while `public.sales` stays `permission denied`, and production's ledger reads 45 rows, latest `0232`, with all 224 files matching their recorded hashes. Evidence: [production-0232-marketplace-door-2026-10-18.md](../device-evidence/production-0232-marketplace-door-2026-10-18.md). |
| `0233_a_role_is_granted_per_branch.sql` | **The role a person holds is now stated per branch — APPLIED to hosted staging 2026-10-25; production pending, needs a gated batch of one file.** Adds `membership_branch_roles` (one explicit role per membership and branch, with a tenant/branch foreign-key check), backfills it from each membership's current role and scope, and changes the effective-permission resolution to read the role of the branch the account is actually working in. The owner's write path is `set_employee_branch_roles(uuid, jsonb)`, which validates every branch against the employee's scope and the editor's own authority before writing, audits the before/after map and leaves a membership's default role intact for branches with no explicit row. The same file adds `get_employee_performance(uuid)` so the owner's employee sheet can aggregate one person across their branches without reading another branch's rows. Additive and idempotent; the table, backfill, RPCs and assertions were applied through the staging ledger and replayed by `tests/unit/branchIdentityBoundary.test.ts`. Production verification is still required because the frozen baseline predates the membership model; do not apply from this line alone. |
| `0234_a_branch_holds_its_own_stock_and_receivables.sql` | **Each branch now reports its own stock value and its own receivables — APPLIED to hosted staging 2026-10-25; production pending, needs a gated batch of one file.** The Settings overview's inventory and credit figures were business-wide, so an owner working in a second branch read them as that branch's; the employee figure had already become per-branch (`0233`). This file changes no table and no write path: it replaces `get_my_branches()` with three additional columns (`inventory_value`, `inventory_cost_incomplete`, `credit_outstanding`) derived from the branch stamps `0222` already puts on every operational row — stock from `inventory_movements.branch_id` net per variant, valued at today's cost and never below zero per shelf; receivables from `sales.branch_id`/`amount_due` less `customer_payments.branch_id`. Whatever the branches cannot explain (stock that predates the ledger, a payment taken against another branch's bill, a manual balance change) is carried by the main branch, so the branch figures always add up to the business totals instead of becoming a second set of books. Both columns are permission-gated exactly like the existing employee and sales figures (`inventory.view`, `customers.view`); a caller without them gets NULL, which the card prints as `—`. Adds three read indexes (`inventory_movements(branch_id, variant_id)`, `customer_payments(branch_id)`, `sales(branch_id) where not is_voided`) and asserts the function reports the three columns. Read-only and idempotent — no data is rewritten, so a re-run or a replay changes nothing. Verified on staging by the `dashboardScope` lane (7/7, including a new test that switches branch through the app's own action and reads the card against the second branch's ledger) and by the full unit suite. |
| `0236_a_branch_reports_only_its_own_figures.sql` | **Each branch reports only its own three figures — supersedes the remainder rule in `0234`/`0235`; APPLIED to hosted staging 2026-10-25; production pending, needs a gated batch after `0234` and `0235`.** The owner's requirement is stricter than "the branches add up": a main branch holding no stock, no sale and no assigned staff was reading "3 employees, 40,000 credit" because `0234`/`0235` pushed everything the ledgers could not attribute onto it. This file replaces `get_my_branches()` so nothing is pushed anywhere: inventory is the branch's own ledger net at today's cost, receivables are what it billed less what was collected at it (never negative), and employees are the active people the roster ties to it — explicit `branch_scope`, an explicit `membership_branch_roles` row, a NULL scope (0233: all branches), or ownership. Suspended accounts are excluded. A pre-stamping row with `branch_id IS NULL` is attributed only when the shop has exactly one active branch; in a multi-branch shop it belongs to no branch rather than being guessed onto one. No table, trigger, write path or index is touched, all three permission gates are unchanged, and the shape assertion is preserved. Read-only and idempotent. Verified against the development database and the staging shop, by the `dashboardScope` lane (whose expectation helpers were rewritten to the strict rule) and by the full unit suite. **Superseded by `0237` for the employee and legacy-stock rules; apply both, in order.** |
| `0237_the_branch_card_counts_staff_and_keeps_legacy_stock.sql` | **Correction to `0236`: staff are non-owner members, and ledger-less stock stays visible — APPLIED to hosted staging 2026-10-25; production pending, needs a gated batch after `0234`–`0236`.** Two defects found by reading the development card against its own data. (1) `0236` counted owners at every branch; a two-owner shop read two extra employees on every branch, and a QA shop with six owner memberships read "8 employees" on a branch holding one worker. The count now excludes `role = 'owner'` and requires an explicit `branch_scope` entry or an explicit `membership_branch_roles` row, so a member scoped nowhere counts nowhere. (2) `0236`'s strict ledger left a variant with `stock_qty` but no movements reporting 0 on every branch while the product screen listed units on hand. Such a variant has never been branch-stamped, so its whole quantity is valued on the shop's default branch; once any movement exists, only the ledger counts, and nothing is copied to another branch. Receivables remain strictly `amount_due` billed at the branch less payments collected there. No table, trigger, write path or index is touched; permission gates and the shape assertion are unchanged. Read-only and idempotent. Verified on the development database (Main Branch 0 / 1 / 0; Default Shop - Main 49,294,000 / 2 / 944,500) and on the staging shop (Default Shop - Main 30,000 / 2 / 10,000; Malik agro 0 / 1 / 0). |
| `0235_a_branch_counts_the_people_who_work_there.sql` | **A branch now counts the people who work there — APPLIED to hosted staging 2026-10-25; production pending, needs a gated batch of one file.** The Settings card answered "1 employee" in a shop whose Employees screen listed several, because `employee_count` counted only members whose branch scope named that branch — so anyone invited without a scope counted nowhere. This file changes no table, trigger or write path: it replaces `get_my_branches()` so the count comes from the same population the Employees screen reads (active memberships of the shop, owners included) and is split the way stock and receivables already are — whoever the roster assigns to a branch counts there, and whoever it assigns nowhere sits on the main branch. A deactivated account is not counted; a person scoped to two branches counts at both, because the card answers "how many people work here", not "how many does the business employ". Every other column, including the `inventory.view`/`customers.view` gated figures from `0234` and the `employees.view` gate on this one, is unchanged, and the file asserts that `get_my_branches()` still reports all three branch-figure columns. Read-only and idempotent. Applied through the staging ledger (8 statements, recorded) and replayed by `tests/unit/migrationReplayability.test.ts`. Production verification is still required before any batch that includes it. |
| `0238_the_product_shelf_is_the_branch_shelf.sql` | **Branch-scoped product stock — added with the branch-isolation work; production pending, needs a gated batch after `0237`.** The shelf a product is sold from is its branch, so stock and availability are read and written per branch instead of from the business-wide row. Additive and replayable; verify against the production baseline before scheduling it. |
| `0239_a_branch_only_moves_its_own_stock.sql` | **Stock movements carry their branch — added with the branch-isolation work; production pending, needs a gated batch after `0238`.** A movement states the branch it happened in, so a receipt, sale or adjustment cannot silently change another shelf. Additive and replayable; verify against the production baseline before scheduling it. |
| `0240_a_product_belongs_to_the_branches_that_stock_it.sql` | **A product can be stocked by more than one branch — added with the branch-isolation work; production pending, needs a gated batch after `0238`/`0239`.** The product-to-branch association is explicit rather than inferred from the business, which is what lets a second branch list and sell its own shelf. Additive and replayable; verify against the production baseline before scheduling it. |
| `0241_the_branch_boundary_holds_at_the_database.sql` | **The branch boundary is enforced by RLS, not only by the screens — development verified; production pending, needs a gated batch after `0238`–`0240`.** Makes the branch permission gates RESTRICTIVE and adds explicit customer/company branch associations, so a permissive gate cannot OR its way past the branch filter. Requires the tables and columns added by the preceding branch files; verify against the production baseline before scheduling it. |
| `0242_the_other_branch_surfaces_close.sql` | **The remaining branch surfaces close — development verified; production pending, needs a gated batch after `0241`.** Continues the same boundary work across the remaining read and write surfaces. Verify against the production baseline before scheduling it. |
| `0243_an_access_request_reaches_who_can_act.sql` | **An employee can ask an owner/manager to add them — development and local SQL verified; production pending, needs a gated batch after `0233`.** Adds `employee_access_requests` (RLS on, no policies, every client grant revoked), an anon-callable `request_employee_access` that only records a request and a generic notification, and authenticated `list`/`get`/`mark added`/`dismiss` RPCs gated by `employees.manage`. It never creates a membership; the owner still uses `create_employee`. Its manager lookup uses `membership_branch_roles`, so `0233` must already be present. |
| `0244_the_card_and_the_team_agree.sql` | **The branch card and the team screen count the same people — development verified; production pending, needs a gated batch after `0237`.** Restores the main-branch fallback for people the roster has not placed explicitly, and keeps stock from an archived branch visible on its default branch. Read-only and idempotent; verify against the production baseline before scheduling it. |
| `0245_an_employee_can_set_the_pin_for_their_own_device.sql` | **An employee can set the PIN that opens their own device — development verified end to end; production pending, needs a gated batch after `0242` and `0231`.** `0242`'s `guard_user_privileged_columns` protected `users.pin_hash` alongside role, shop and ownership, so every non-admin `set_user_pin` raised `NOT_AUTHORIZED: those account fields belong to the owner`; a first sign-in or a reinstalled phone verified the OTP, reached the PIN screen, chose and confirmed a PIN, and was sent back with a storage error, leaving `pin_hash` NULL. This file rewrites `set_user_pin` to mark its own single-row write with the transaction-local `app.pin_write` setting and changes the trigger to accept a `pin_hash` change only while that marker is set — so the column stays closed to every direct update and the digit rule stays enforced, while the credential's one authorized writer works. Two function bodies only: no table, column or grant change, and the caller can only write their own row. Verified on development through the real browser flow (phone `03007654321`: `/login/otp` → `/login/pin-set` → `/employee/dashboard`, `pin_hash` written and `updated_at` advanced in the same second) and by `tests/unit/employeeRecovery.test.ts`, `pinSurfaceParity` and `migrationReplayability`. |
| `0246_a_product_keeps_only_the_barcode_it_was_given.sql` | **A product carries a barcode only when one was entered — development verified; production pending, needs a gated batch after `0239`.** Stops the add-product path from inventing a code, so a product without a barcode is stored with none and the paper barcode generator is what creates one on request. Column-level default only; no table, grant or policy change. |
| `0247_the_business_profile_reads_its_signup_record.sql` | **The business profile can read the record its owner gave at signup — development verified; production pending, needs a gated batch after `0042` (`shop_requests`).** One SECURITY DEFINER, STABLE read (`get_business_profile`) that answers only for `current_shop_id()`, only to an active owner/admin, and never returns the identity documents in `shop_requests`. Read-only: it adds no table, column or write. |
| `0248_the_business_keeps_its_own_record.sql` | **The business keeps — and can correct — its own record — development verified; production pending, needs a gated batch after `0247`.** Adds six nullable, constrained columns to `shops` (`email`, `whatsapp_phone`, `logo_url`, `shop_type`, `city`, `registration_number`), copies the linked signup answers into them ONCE where the shop's own column is still NULL, extends `get_business_profile` to return them, and adds `update_business_profile(jsonb)` — an owner/admin-only patch that writes `shops` for `current_shop_id()` and nothing else. The backfill reads `shop_requests`, so `0247` must already be present; verify against the production baseline before scheduling it. |
| `0250_the_business_can_complete_its_papers.sql` | **The business can add the papers its signup form never received — development verified; production pending, needs a gated batch after `0249`.** Adds three nullable text columns to `shops` (`licence_url`, `cnic_front_url`, `cnic_back_url`), creates the PRIVATE `business-documents` storage bucket with exactly two policies (signed-in read and insert, each scoped to the caller's own `current_shop_id()` path prefix — no update, no delete), teaches `update_business_profile` three new patch keys that refuse any path outside the caller's own folder, and makes `get_business_profile` prefer the business's own picture over the approval record. Storage DDL and two function bodies; no grant is widened. Replay it on a branch first: it asserts the bucket is private and both policies exist, and fails loudly if either is missing. |
| `0251_a_credit_limit_is_a_permission_the_owner_grants.sql` | **Lending is its own switch, and the owner's approved amount wins — development verified on the local database (SQL probe + suite); production pending, needs a gated batch after `0154`, `0060`–`0069`, `0112`.** Adds the `customers.credit_limit` permission and grants it to every role that already holds `customers.edit` (so Sales Manager and Store Manager keep exactly the authority they had, and Sales Employee/Inventory Clerk gain nothing), points `set_customer_credit_limit` at the new code, adds a nullable `credit_limit_requests.approved_limit`, and adds `approve_credit_limit_request_v3(p_request_id, p_reviewed_by, p_approved_limit)` so the approving owner may grant a different figure than the employee asked for. The request row keeps both numbers and the audit event records both. `approve_credit_limit_request_v2` stays callable with its 3-argument signature and now also records `approved_limit`; the new write RPC is granted to `authenticated` only, with `PUBLIC`/`anon` revoked. Idempotent, forward-only, and it asserts the permission, the role grants, the rewritten direct-set body and the new function before it commits. |
| `0252_the_sale_gate_reads_the_shelf_number.sql` | **The write gate and the shelf read one rule, so a sale is never refused on a number the screen does not show — development verified on the local database (the reported sale's own RPC completed inside a rolled-back transaction, 502 → 501; the shelf and the gate agree for every pack); production pending, needs the gated batch carrying `0238`–`0244` and `0246`.** `branch_variant_qty` becomes the single "what does this branch hold" answer — the branch's own ledger net plus the unclaimed remainder on the main branch that `0244` already gave the product screens — and gains a third argument so the BEFORE INSERT guard can ask for the pre-movement number after the caller has already decremented `stock_qty`. `get_branch_variant_stock` is re-stated as the clamped form of that same function and `guard_branch_stock_movement` asks it directly, dropping its own opening-stock special case. The 2-argument overload is dropped on purpose. Without it a pack whose movements sit in an archived branch reads 502 on every screen and −1 at the gate, and the sale fails as INSUFFICIENT_STOCK ("check the quantity"). Idempotent, forward-only, and it asserts the shared rule, the absent overload, the attached trigger and the shelf/gate equality for the session's branch before it commits. |
| `0253_the_reports_read_their_period_per_branch.sql` | **The reports read their period per branch, at the database — development verified on the local database (both functions exist and the Sales, Profit and Cash position screens read them; `tsc` and the unit guards green); production pending, needs a gated batch after `0233`/`0234`, whose branch-stamped sales and payment ledgers it reads.** Two read-only `SECURITY DEFINER` functions: `get_branch_period_report(p_from, p_to)` returns gross sales, refunds, net sales, known COGS, the count of sale lines with no recorded cost, and profit for one PK window per readable branch; `get_branch_cash(p_from, p_to)` returns cash taken on that window's sales, customer money received and supplier money paid per readable branch, with a column the caller may not read left NULL rather than zero. Branch scope is the caller's membership scope (an owner reads every active branch), sales permission gates the report, and EXECUTE is granted to `authenticated` only with `PUBLIC`/`anon` revoked. No table, column, policy or write; each function asserts its own return columns and the migration asserts anon cannot execute either. Before the Sales report drew lifetime totals under a "this month" strip, and Profit had no branch split because no read carried a period cost per branch. |
| `0254_recorded_money_has_its_own_ledger.sql` | **Recorded income, expense and drawings have their own ledger — development verified on the local database (migration applied, the table and both functions exist, the write refuses a non-owner and a future day, and the period read returns the three totals); production pending, needs a gated batch after `0188`/`0107`, whose branch and role helpers it reads.** Adds `finance_entries` (shop, branch, kind income/expense/drawing, amount, day, category, method, optional counterparty/note, who recorded it), RLS on with no policy and every client grant revoked, `record_finance_entry` (owner of the active shop only; refuses a non-positive amount, a future day and a branch that is not this tenant's) and `get_finance_totals(p_from, p_to)` (gated on `payments.view`, scoped to the session's branch). A drawing is not an expense and neither is a sale, so the three are kept apart. Idempotent and forward-only, and it asserts its own columns, checks, grants and anon refusal before it commits. |
| `0255_repeating_money_posts_itself_and_says_who_wrote_it.sql` | **A recorded amount can repeat, and every ledger row names who wrote it — applied to the local development database (the cadence table, the partial unique index and all four functions exist; `tsc`, the unit guards and the client's calendar test pass); production pending, needs a gated batch after `0254`, whose ledger it extends.** Adds `finance_recurrences` (kind, amount, category, method, counterparty, note, `repeat_every`, `repeat_unit` day/week/month, `starts_on`, `next_on`, optional `ends_on`), the nullable `finance_entries.recurrence_id`, and a partial unique index on `(recurrence_id, occurred_on)` so a rule can post a day exactly once. `record_finance_entry` gains `p_repeat_every`/`p_repeat_unit` — the old eight-argument signature is dropped first so one named-argument call cannot be ambiguous — and `post_due_finance_entries()` writes every due occurrence then advances each rule; `get_finance_recurrences()` reads the active ones, `stop_finance_recurrence(id)` ends one, and `get_finance_entries` is re-created (dropped first: its return shape changes) to carry the writer's name and the cadence. A rule is not money: only the rows it posts reach `get_finance_totals`. Owner-only writes, `payments.view` reads, all client grants revoked on both tables. Idempotent and forward-only. |
| `0256_a_payment_reminder_is_the_owners_diary.sql` | **The owner's payment diary, one payment at a time — applied to the local development database (the table, its index and all three functions exist; `tsc`, the unit guards and the calendar test pass); production pending, needs a gated batch after `0254`/`0188`, whose membership and branch helpers it reads.** Adds `payment_reminders` (title, optional person and amount, `due_on`, `due_time`, optional `repeat_every`/`repeat_unit`, owner, branch), RLS on with no policy and every client grant revoked, `save_payment_reminder` (creates or edits; owner only; validates the name, amount, date and cadence), `delete_payment_reminder(id)` (owner only) and `get_payment_reminders()` (gated on `payments.view`, scoped to the session's branch). Deliberately separate from `reminder_configs`: that one schedules chasing a customer and feeds the message engine, while this is a note to the owner and may name no customer — sharing the table would have let a private note become a customer message. No scheduler is implied or installed; the screen derives the next occurrence from the stored day and cadence. Idempotent and forward-only. |
| `0257_a_payment_reminder_knows_who_it_is_about.sql` | **A payment reminder knows who it is about, and whether it is still owed — applied to the local development database (the five columns, three checks, two indexes and all four functions exist; both malformed party rows were refused and a well-formed customer reminder was accepted and removed; `tsc` green); production pending, needs a gated batch after `0256`, whose table it extends.** Adds `kind` (customer/supplier/general), `customer_id`, `company_id`, `notes` (≤280) and `status` (upcoming/completed/cancelled) to `payment_reminders`, with a check that the kind and the party links agree, and keeps `is_active` mirrored to `status = 'upcoming'` so the earlier reads cannot see a done reminder as open. The eight-argument `save_payment_reminder` is dropped first (an overload would leave two callable shapes) and re-created with the kind, the party links and the note — it refuses a customer or supplier from another business, and stores the record's own name as the printed label. Adds `set_payment_reminder_status(id, status)` (owner only; records the owner's decision and moves no money) and re-creates `get_payment_reminders(p_include_closed)` (the old zero-argument signature is dropped first) carrying the kind, status, note and both party names, still gated on `payments.view` and scoped to the session branch. Idempotent and forward-only. |
| `0258_a_delivery_advance_is_a_payment.sql` | **The advance paid on a delivery is recorded as a supplier payment — applied to the local development database (column, foreign key and unique index exist; four existing advances backfilled with their bills' methods and timestamps; every supplier's payable unchanged before/after, measured per branch and per company; a 10,000 bill paid 2,000 showed 2,000 in the payment history and 8,000 outstanding, a 0-paid bill showed none and the full residual, a 5,000-paid 2,000 bill was clamped to 2,000, a replayed idempotency key produced one bill and one advance, and a later `record_supplier_payment` still reduced the branch balance; re-running the file inserted nothing; `tsc` and the affected unit guards green); production pending, needs a gated batch after `0224`/`0242`, whose functions it replaces.** The report that opened this work: a delivery booked with a part payment tracked the residual but the money handed over never reached `supplier_payments`, so the supplier's Payments tab, the supplier-payments screen and the payments ledger all omitted it, "paid to suppliers" understated reality, and the branch balance was computed by a different formula (bills' `amount_paid` + payments) from the supplier total. Adds `purchases.payment_method` and `supplier_payments.purchase_id` (foreign key, unique partial index — one advance per bill), backfills every existing advance from its bill, re-creates `create_purchase` to clamp the paid amount to the bill, store the method and write the advance into the ledger linked to the bill, and re-creates `get_branch_company_balances` to derive paid and outstanding from that one ledger instead of adding `amount_paid` a second time. No supplier's balance changes; the payments screens can finally see the advance. Idempotent and forward-only. |
| `0259_a_shelf_and_a_unit_are_the_shops_own.sql` | **The shop's own categories and units, and Add Product uses them — applied to the local development database (both tables, the seed trigger and all four functions exist; seven shelves and three units seeded for each of the three shops; all 13 products backfilled to a shelf and a unit; a subcategory was created under Pesticide and the duplicate-name, third-level, duplicate-symbol, bad-family and foreign-parent calls were all refused; a product created under the child shelf inherited `pesticide` and `piece`, re-filing moved both the shelf and the kind, clearing the shelf left the kind alone, and a direct client INSERT was denied while a session read only its own shop's rows; `tsc`, the unit guards and the registry guard green); production pending, needs a gated batch after `0246`/`0224`, whose product functions it replaces.** The reference asks for Categories (with subcategories) and Units as real screens, and for both to be what Add Product offers; that was impossible while the seven kinds were a compiled enum and the units were two strings. Adds `product_categories` (one level deep, a name per parent, the fixed kind carried as `legacy_category`, `is_system` true only while a seeded shelf keeps its name, RLS read by `current_shop_id()` with every client write revoked) and `product_units` (name, symbol, measurement family kg/liter/piece and a 0–4 precision, unique symbol per shop), seeds seven shelves and Kilogram/Liter/Piece for every existing shop and via an AFTER INSERT trigger on `shops`, and adds `products.category_id`/`products.unit_id` with a backfill from each product's kind and unit. Re-creates `create_product` and `update_product` to resolve a supplied shelf to its root's kind, take the measurement family from the unit row rather than the client, and distinguish "shelf not mentioned" from "taken off the shelf" exactly as they already distinguish the barcode. Adds `save_product_category` (refuses a duplicate name, a foreign parent and a third level) and `save_product_unit` (refuses a duplicate symbol, a fourth family and a precision outside 0–4), both owner/`products.edit` and `authenticated` only. No stock, sale, purchase or report changes: the kind each of them reads is still written. Idempotent and forward-only. |
| `0260_editing_a_customer_is_not_blocked_by_an_old_due_date.sql` | **Editing a customer no longer fails because their payment due date has passed — applied to the local development database (the row check is gone and the trigger exists; `Rashid Kiryana`, whose due date is 29 Oct 2026, saved an address change with the date untouched; a new past date was refused with `23514` / `due_date_not_past`; re-sending the stored date and clearing it were both accepted; `Add Customer` created a customer that then appeared in the list, and the probe row was removed); production pending, needs a gated batch after `0259`.** Replaces the `due_date_not_past` row CHECK added by migration `0034` — a CHECK is evaluated on every UPDATE of the row, so once a customer's due date went by, the owner could not edit that customer's name, address or archive flag at all; the reported error named a column the form had not touched. The rule becomes a `BEFORE INSERT OR UPDATE OF due_date` trigger: a date being set into the past is still refused (same SQLSTATE and constraint name), an unchanged stored date and a clear to NULL are allowed, and an update that does not mention the column never reaches it. The comparison uses the shop's day (Asia/Karachi) as every screen does, not the server's UTC `CURRENT_DATE`. No column, policy or grant change; the function is revoked from every client role. Idempotent and forward-only. |
| `0261_recorded_money_keeps_its_papers_and_its_past.sql` | **Receipts, voice notes, corrections and a history for recorded money — applied to the local development database (both tables, the private bucket, both storage policies and every function exist; a 1,234 expense saved with one photo, its signed URL rendered at 637×737, the entry corrected through the sheet with the Description diff in its history, then soft-deleted with `created,deleted` while the ledger and every total stopped counting it); production pending, needs a gated batch after `0255`, whose ledger it extends.** Adds `finance_attachments` (one row per private object: kind photo/voice, path, mime, bytes, duration, with a check that a voice note has a length and a photo does not) and `finance_entry_history` (one row per create/correction/delete, written by a trigger and carrying before/after jsonb snapshots), soft-delete columns on `finance_entries` (`updated_at/by`, `deleted_at/by`), the PRIVATE `finance-receipts` bucket with exactly two policies (branch-scoped authenticated read and insert — deliberately no delete, because 0230 forbids a later file re-opening storage to client mutation; 0263 repairs any database that already received the original three), and the functions `get_finance_entries`/`get_finance_entry` (payments.view, session branch), `update_finance_entry`/`delete_finance_entry` (owner only, soft delete, history), `attach_finance_media`/`remove_finance_media` (owner only; the RPC checks the object's own `<shop>/<branch>/<entry>/` folder) and the history trigger. Every client table grant is revoked and every function is `authenticated` only with PUBLIC/anon revoked. Idempotent and forward-only. |
| `0262_money_moves_in_one_statement.sql` | **One read-only statement of money actually moving, across every ledger — applied to the local development database (nine movements for the month; money in 119,700, out 45,500 and net 74,200 agreed with the list; the Finance hub showed the same three figures beside net profit and the two balances); production pending, needs a gated batch after `0254`/`0258`.** Adds `get_money_statement(p_from, p_to)` as a `STABLE SECURITY DEFINER` union of the paid part of non-voided sales, `customer_payments`, refunds, `supplier_payments` and non-deleted income/expense/drawing rows, each with its direction, method, party, reference and note, scoped to the session's branch and one PK window; adds `get_money_totals`, which aggregates that same function so the figures cannot describe a different set of rows from the list. A credit sale's unpaid balance, a purchase bill and a voided sale move nothing and are excluded on purpose. It is never written through: a correction stays in the ledger that owns the movement. Gated on `payments.view`, `authenticated` only, PUBLIC/anon revoked. Idempotent and forward-only. |
| `0263_a_receipt_is_removed_by_its_row_not_by_a_client_delete.sql` | **A receipt is removed by its row, not by a client DELETE on storage — applied to the local development database (the delete policy is gone; the read and upload policies remain; the storage lockdown guard is green).** Drops `finance receipts delete`, which `0261` originally created before `tests/unit/storagePolicyLockdown.test.ts` showed it re-opened `storage.objects` to a client mutation after `0230`. `0261`'s body was corrected in the same change so a fresh replay never creates it; this file is the repair for a database that already applied the earlier body. The object behind a removed attachment is left private and unreferenced (no row names it, no signed URL can be asked for it) and is reclaimed only by server-side maintenance — the alternative was handing every signed-in client a delete grant the storage lockdown forbids. Asserts both surviving policies exist and that the delete policy does not. Production must apply after `0261`; idempotent. |
| `0264_the_due_date_trigger_is_named_where_retirements_are_counted.sql` | **The due-date trigger `0260` retires is named where retirements are counted — applied to the local development database (the assertion reports one retired function unreachable from every API role).** Adds `customers_due_date_not_past` to the declaration set that `tests/unit/writeRpcAnonGuard.test.ts` unions across migrations; `0260` revoked it from PUBLIC/anon/authenticated but did not name it, so the ledger's server-only set and the files' declared set disagreed by exactly that function. No schema, grant or policy change — a declaration and an assertion that no API role can execute it. Production after `0260`; idempotent. |
| `0249_the_business_profile_shows_its_papers.sql` | **The Business profile can show the images submitted at signup — development verified; production pending, needs a gated batch after `0247`.** Adds a `documents` block (licence, CNIC front, CNIC back, plus the signup logo as the hero fallback) to `get_business_profile`, read from the linked `shop_requests` row. Identity documents were excluded by `0247` on the rule that a screen listing them is a leak; this file returns them under the same owner/admin gate and the same `current_shop_id()` scope, so only the owner or an admin of that business can read them, and they are read-only. One function body; no table, column or grant change. |

| `0265_a_role_says_what_it_does_and_what_it_sees.sql` | **A role says what it does and which dashboard blocks it may see — applied locally; production pending, needs a gated batch after `0233`/`0259`.** Adds role data scope and dashboard visibility, with owner-only writes and the role ceiling preserved. No Co-Owner surface is enabled by this file. |
| `0266_a_co_owner_is_a_delegation_not_an_admin.sql` | **Co-Owner delegation, not an admin promotion — applied locally; production pending and not approved.** Adds explicit grant, scope, permission, dashboard, authority and approval tables with fail-closed RLS. Co-Owner identity remains `memberships.access_kind='co_owner'` with `role='employee'`; `users.role` never becomes admin and the original owner is untouched. Brand scope is closed because the schema has no brand entity. |
| `0267_co_owner_hardening.sql` | **Co-Owner hardening — applied locally; production pending with `0266`.** Tightens login provisioning, employee-management ceilings and revocation behavior. It must not be applied to production without the owner's explicit authorization. |
| `0268_co_owner_invitation_transaction_fix.sql` | **Invitation writes are one transaction — applied locally; production pending with `0266`–`0267`.** Ensures a failed invitation leaves no partial grant or login. |
| `0269_co_owner_acceptance_transition_fix.sql` | **Acceptance can complete the membership transition — applied locally; production pending with `0266`–`0268`.** Allows the invitee's own pending membership to become active while accepting the grant. |
| `0270_co_owner_dashboard_uses_the_stock_ledger.sql` | **The Co-Owner dashboard reads the real stock ledger — applied locally; production pending with `0266`–`0269`.** Replaces the nonexistent `branch_stock` reference with `inventory_movements`. |
| `0271_co_owner_employee_bootstrap.sql` | **Employee bootstrap remains intact for Co-Owner-created staff — applied locally; production pending with `0266`–`0270`.** Keeps ordinary employee invitation and onboarding separate from owner-level delegation. |
| `0272_co_owner_approval_target_scope.sql` | **An approval cannot name a target outside the grant — applied locally; production pending with `0266`–`0271`.** Validates sale, customer and supplier targets before a request is recorded. |
| `0273_co_owner_explicit_acceptance.sql` | **Co-Owner acceptance is an explicit invitee decision — applied locally; production pending and feature-flag OFF.** Onboarding no longer auto-accepts a Co-Owner grant, acceptance requires an unexpired `invited` grant, decline revokes it without activating the membership, and the acceptance screen receives branches, modules, dashboards and authorities. Replay found and fixed a checked empty `branch_scope` in decline. |
| `0274_co_owner_invitation_normalizes_phone.sql` | **A Co-Owner invitation stores the phone form login resolves — applied locally; production pending with the Co-Owner batch.** Replaces the invitation function additively: local `03…` and ten-digit input become `92…` before the user lookup, insert and login provisioning, fixing the invited person being unable to receive a code. Existing rows are untouched; invitee acceptance and revocation do not change. |
| `0275_roles_remember_category_and_level.sql` | **Role category and responsibility level are metadata, not authority — applied locally; production pending with the Co-Owner batch.** Adds nullable columns, backfills existing rows from their current department and name, and replaces `get_role_access`/`create_role`/`update_role` to carry the two fields with validation. No permission, dashboard grant, RLS policy or employee scope is changed by the migration. |
| `0276_branch_roles_and_dashboard_permission_rules.sql` | **A branch can carry its own saved role at invitation time, and a selected widget still needs its permission — applied locally; production pending with the Co-Owner batch.** Extends `create_employee_core` with an optional `branchRoles` object written into `membership_branch_roles` in the invitation transaction, and makes `get_my_dashboards` return only selected widgets whose `default_permission` is effective. Existing invitations without the object keep the single-role behaviour; the widget filter can only narrow visibility, never grant it. |
| `0277_role_permissions_drive_the_dashboard.sql` | **A role's permissions decide its widgets, and an employee setting can only reduce that role — applied locally; production pending with the Co-Owner batch, after `0265`/`0276`.** Removes the manual dashboard tick-list at role creation; a widget may need more than one permission; an individual employee setting may take access away but never add any; a role people hold cannot be deleted. |
| `0278_salary_is_a_recurring_expense.sql` | **Salary is a recurring expense owned by the employee it pays — applied locally; production pending, after `0254`/`0255`.** Reuses `finance_recurrences` so a salary writes a real expense row on each due date instead of a second payroll ledger that could drift from the Money statement. |
| `0279_owner_can_remove_any_role.sql` | **The owner can remove any role, including a built-in one — applied locally; production pending with the Co-Owner batch.** Deleting a role takes away the access it provided; it never deletes an employee or their history. |
| `0280_ownership_transfer_and_co_owner_archive.sql` | **Ownership transfer and Co-Owner archive/restore — applied locally; production pending with the Co-Owner batch, after `0266`–`0274`.** Adds the separate legal-ownership transfer workflow and the missing archive/restore lifecycle, without turning a Co-Owner into an employee or creating a second ownership model. |
| `0281_branch_co_owner_assignment_and_owner_audit.sql` | **Branch-scoped Co-Owner assignment and the Owner's cross-branch audit — applied locally; production pending with the Co-Owner batch, after `0266`.** The Owner selects a sub-branch and the Co-Owner delegation is created with exactly that branch in scope; the Owner gets the all-branch read the two-sided audit rule needs, the Co-Owner keeps the single-branch read. |
| `0282_co_owner_branch_management_is_enforced.sql` | **The branch-management flag is a real check, not stored decoration — applied locally; production pending with the Co-Owner batch, after `0281`.** Enforces `co_owner_grants.can_manage_branches = false` with a trigger on every branch write path, so a Co-Owner with `settings.edit` can no longer rename, relocate or archive a branch through the Owner screens. |
| `0283_profile_phone_change.sql` | **A person can move their own login number without splitting their identity — applied locally; production pending, needs a gated batch.** Moves the app row and the Supabase Auth credential in one transaction, caller-own-row only (actor from the JWT, never a client-supplied user id). |
| `0284_catalogue_deletion_is_guarded.sql` | **A shelf or unit can only be deleted when nothing active still uses it — applied locally; production pending, after `0259`.** Adds the server delete functions with an explicit dependency rule (a category with products is refused with the count still on it) instead of leaving it to the `ON DELETE SET NULL` foreign key. |
| `0285_employees_serve_customers_and_owner_hears_about_payments.sql` | **Employees can manage customers and record payments; customer reminders travel with the customer — applied locally; production pending, needs a gated batch.** Widens counter payment-taking and customer add/edit to branch employees while customer deletion stays with the Store Manager role. |
| `0286_one_identity_agri_id_recovery_and_explicit_invitations.sql` | **One person, one identity: Agri ID, recovery, and explicit invitations — applied locally; production pending, needs a gated batch.** Adds `users.agri_id` (backfilled for every existing row, default for new rows) and the recovery/invitation flows around the single identity. |
| `0287_branch_roles_absent_is_not_invalid.sql` | **An absent `branchRoles` is absent, not invalid — applied locally; production pending, after `0276`.** Fixes the invitation validator so a missing `branchRoles` (JSON null from the client) no longer returns `INVALID_BRANCH_ROLES` for a valid invitation. |
| `0288_retire_employee_self_request.sql` | **Self-request access is retired; history stays — applied locally; production pending, needs a gated batch.** Revokes execution of the anonymous request RPC (the last public write in the onboarding story); the table and every historical row stay exactly where they are. |
| `0289_a_category_says_what_it_sells.sql` | **A category says what it sells and how it is measured — applied locally; production pending, after `0259`.** Adds one optional profile per category listing physical forms and units, so the Add Product screen offers only the units that fit the category. |
| `0300_policies_and_guards_for_0280_0289.sql` | **Policies and guards for the tables and RPCs 0280–0289 introduced — applied locally; production pending with the Co-Owner batch.** Closes the two gaps PR #13's QA run caught: one tenant-scoped SELECT policy each for `employee_compensations` (also requires `employees.manage`) and `ownership_transfers`, and the recognized `authorize_tenant_membership()` guard, first in the body, on `create_product_with_classification`, `update_product_with_classification`, `reject_ownership_transfer` and `restore_co_owner` (restated byte-for-byte, caller sets unchanged). |
| `0301_shop_creation_survives_customer_defaults.sql` | **New-shop creation survives the customer-defaults trigger — applied locally; production pending with the Co-Owner batch.** Restates `create_shop_internal` (0166) byte-for-byte with `ON CONFLICT DO NOTHING` on both grant-copy INSERTs: 0285's role-INSERT trigger pre-grants the customer defaults, so the plain template copy collided and every new-shop creation (registration and approved shop request) rolled back. The result is the intended union, no pair inserted twice. |
| `0302_drop_adhoc_storage_update_delete_policies.sql` | **Drop the two ad-hoc storage UPDATE/DELETE policies — applied locally; production pending (no-op there).** The 2026-11-07 repair script created "images auth update" and "images auth delete" on storage.objects with no TO role (PUBLIC), so any anonymous caller could update/delete any image in the four buckets — exactly what 0230 removed on purpose. Drops both IF EXISTS and verifies no UPDATE/DELETE policy remains. The policies existed only on QA (created by the script, never by a migration), so production is unaffected. |
| `0303_production_reconciliation_for_batch1.sql` | **Reconcile production's schema so batch 1 (0233–0276) can apply — applied locally; production pending, apply BEFORE batch 1.** Production is missing schema the batch assumes (verified by replaying batch 1 onto the 2026-11-08 production backup in PGlite): `shop_id` on `reminder_occurrences` and `reminder_logs` (0115 added it, production only has it on `reminder_configs`), `occurrence_id` on `reminder_logs` (0040 adds it, production never got it), `reminder_logs.config_id` is TEXT on production but 0242 compares it to `reminder_configs.id` (uuid), and `purchases.recorded_by` is VARCHAR on production while `supplier_payments.recorded_by` is UUID on both (0258 copies it and Postgres rejects the assignment at plan time). Closes all four idempotently (IF NOT EXISTS / type-checked with safe UUID casts). Self-checks that each divergence is closed. **CORRECTION 2026-11-08: the original row claimed staging's recorded_by was already uuid and the file was a no-op on staging — both wrong. Staging's column was VARCHAR too, and 0303 converted it, which broke create_purchase (see 0304).** |
| `0304_create_purchase_recorded_by_uuid.sql` | **Restate create_purchase so recorded_by receives a uuid — applied locally; production pending, apply with 0303 BEFORE batch 1.** 0303 converts purchases.recorded_by to uuid, but create_purchase (0224) inserts `v_actor::text` into it; Postgres rejects text into a uuid column at plan time ("column recorded_by is of type uuid but expression is of type text"), which failed two QA integration suites (createOnceSafety, priceTraceability) after 0303 was applied to QA. This restates create_purchase byte-for-byte from 0224 with the single change `v_actor::text` → `v_actor` (v_actor is declared uuid, same value, type now matches). Self-checks the function source no longer casts to text. |

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

| `0290_a_shop_request_has_a_phone_and_a_place.sql` | **Production signup repair — one-file batch.** Adds the five nullable `shop_requests` columns the registration RPC writes (`phone`, `latitude`, `longitude`, `location_label`, `location_source`), backfills `phone` from `owner_phone`, and installs the Pakistan place constraint. Additive and idempotent; the only table it may change is `shop_requests`. Apply only as a named, verified batch on production's own baseline, with the required fresh backup and restore verification. |
| `0291_the_owner_fields_guard_exempts_the_database_owner.sql` | **CI QA fix, base-fix batch — production pending, apply after `0245` and after the `0233`–`0276` batch.** Restates `guard_user_privileged_columns()` with a `session_user = 'postgres'` exemption so the database owner's own session (the QA admin connection) can reactivate/deactivate fixture accounts; every refusal for app sessions is unchanged. Verified locally only (pglite minimal-fixture replay, 18/18 checks; `tsc` and unit guards green); hosted-QA proof is the CI QA run. Apply only as a named, verified batch under §7(a). |
| `0292_every_tenant_table_carries_a_policy.sql` | **CI QA fix, base-fix batch — production pending, apply after the `0233`–`0276` batch.** Adds one tenant-scoped SELECT policy to each of the ten RLS-enabled tables that had zero policies (`company_branches`, `customer_branches`, `product_branches`, `employee_access_requests`, `finance_entries`, `finance_attachments`, `finance_entry_history`, `finance_recurrences`, `payment_reminders`, `membership_branch_roles`), following the existing policy style. No INSERT/UPDATE/DELETE policy is added; writes stay RPC/trigger-only. Verified locally only (pglite replay; `tsc` and unit guards green); hosted-QA proof is the CI QA run. Apply only as a named, verified batch under §7(a). |
| `0293_every_business_write_rpc_carries_its_guard.sql` | **CI QA fix, base-fix batch — production pending, apply after the `0233`–`0276` batch.** Adds `PERFORM public.authorize_tenant_membership();` as the first statement of the seven business write RPCs that carried no authorization guard (`create_co_owner_invitation`, `update_co_owner_grant`, `delete_finance_entry`, `update_finance_entry`, `delete_payment_reminder`, `record_finance_entry`, `update_business_profile`). Every existing refusal below it is untouched, so no caller set widens; the four finance functions stay owner-only. Verified locally only (pglite replay; `tsc` and unit guards green); hosted-QA proof is the CI QA run. Apply only as a named, verified batch under §7(a). |
| `0294_the_open_shop_policies_carry_the_shop_predicate.sql` | **CI QA fix, base-fix batch — production pending, apply after `0241` and after the `0233`–`0276` batch.** Replaces the four permissive-`true` SELECT policies `0241` created (`sales_read`, `purchases_read`, `returns_read`, `stock_adjustments_read`) with same-named policies carrying `shop_id = public.current_shop_id()`. The RESTRICTIVE permission gates and branch policies are untouched. Verified locally only (pglite replay; `tsc` and unit guards green); hosted-QA proof is the CI QA run. Apply only as a named, verified batch under §7(a). |
| `0295_no_delete_policy_on_customers.sql` | **CI QA fix, base-fix batch — production pending, apply after `0267` and after the `0233`–`0276` batch.** Drops the two DELETE policies on `customers` (`co_owner_record_delete_customers` from `0267` and the demo-era `customers_delete_anon` from `0053`, whose predicate is already `false`). No permissive DELETE policy exists on the table, so dropping them cannot grant a delete; direct DELETE now matches zero rows for every role, and deletes stay with the `archive_customer` RPC. Verified locally only (pglite replay; `tsc` and unit guards green); hosted-QA proof is the CI QA run. Apply only as a named, verified batch under §7(a). |
| `0296_variant_cost_reads_require_products_view.sql` | **CI QA fix, base-fix batch — production pending, apply after `0241`/`0212` and after the `0233`–`0276` batch.** Adds the RESTRICTIVE `permission_read_gate` FOR SELECT on `product_variants`, requiring `current_branch_id() IS NOT NULL AND has_effective_permission('products.view')`, in exactly the `0212` gate shape. A member without `products.view` now reads zero variant rows; the owner still reads cost. No INSERT/UPDATE gate is added; variant writes go through RPCs. Verified locally only (pglite replay; `tsc` and unit guards green); hosted-QA proof is the CI QA run. Apply only as a named, verified batch under §7(a). |
| `0297_reminder_config_without_customer_gets_the_caller_shop.sql` | **CI QA fix, base-fix batch — production pending, apply after `0242`/`0122` and after the `0233`–`0276` batch.** Restates `enforce_reminder_config_tenant()` so a customer-less `reminder_configs` row is stamped with the caller's `current_shop_id()`, and relaxes the `reminder_configs_branch` policy to admit customer-less rows. The customer path is unchanged and an explicitly cross-tenant `shop_id` is still refused by RLS. Verified locally only (pglite replay; `tsc` and unit guards green); hosted-QA proof is the CI QA run. Apply only as a named, verified batch under §7(a). |
| `0298_access_request_names_the_current_membership.sql` | **CI QA fix, base-fix batch — production pending, apply after `0243` and after the `0233`–`0276` batch.** Restates `list_employee_access_requests` and `get_employee_access_request` with the requester's membership resolved active-first, newest-first instead of `ORDER BY m.created_at ASC` (oldest first). Shop derivation, authorization, filters and return shape are unchanged. Verified locally only (pglite replay; `tsc` and unit guards green); hosted-QA proof is the CI QA run. Apply only as a named, verified batch under §7(a). |
| `0299_effective_role_follows_the_working_branch.sql` | **CI QA fix, base-fix batch — production pending, apply after `0266`/`0233` and after the `0233`–`0276` batch.** Restores the branch-role resolution `0266` dropped from `get_effective_permissions`: for a non-owner, non-co-owner caller, an explicit `membership_branch_roles` row for `current_branch_id()` overrides the membership default role. Owner, co-owner and user-override paths are untouched. This is the root cause of the `rbacLifecycleAndSessions` revocation failure: the `0233` seed/sync triggers still maintain the branch-role rows and `0276`'s `get_my_dashboards` still reads them, so authorization answered from the membership default while the dashboard answered from the branch role. Verified locally only (pglite replay, including a full revocation probe; `tsc` and unit guards green); hosted-QA proof is the CI QA run. Apply only as a named, verified batch under §7(a). |

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

### 5.5 The `0291`–`0299` base-fix batch, applied to QA (2026-11-05)

Applied to QA (project `bpybjrjenwccowvtrevu`) on 2026-11-05 ~19:18 UTC, through the manual workflow
`.github/workflows/apply-staging-migrations.yml` (`workflow_dispatch`, run 42093431814), which runs the
repo's own `scripts/migrate.mjs apply --env staging --apply` on a GitHub runner with the repo's `QA_*`
secrets. The workflow exists because a developer machine in this sandbox cannot reach the QA database
directly (its egress proxy allows only port 443; Postgres needs 5432/6543), while a GitHub runner can.
Each file applied and recorded: `0291` (4 statements), `0292` (22), `0293` (9), `0294` (10), `0295`
(4), `0296` (4), `0297` (5), `0298` (4), `0299` (3). Ledger `268 → 277` rows; `verify` with the
ledger-only allowlist: **PASS** (the 44 QA-only rows `0233`–`0276` accepted, 0 pending).

Production status is unchanged: `0291`–`0299` remain production-pending and still go out only as a
named, verified batch under §7(a), after the `0233`–`0276` batch. Hosted-QA proof of the fixes
themselves — that the CI QA suites now pass against the corrected schema — awaits the CI QA run on
PR #10; the apply above only proves the migrations record cleanly on QA.

### 5.6 The `0277`–`0289` QA apply and the one-time out-of-order override (2026-11-06)

The Phase 2 branch adds `0277`–`0289` to the directory, but the QA ledger already holds `0299`
(from §5.5), so the thirteen files sort before the newest recorded version and
`scripts/migrate.mjs` refused the apply — correctly, by default — with an order hazard
(run 42205248029). There is no override in the tool, and the branch CI fails at the ledger step
until they are applied, so the owner authorised a narrow, one-time exception:
`--allow-out-of-order "<reason>"`, valid only for `verify`/`apply` on staging (or pglite),
never for production, with the reason printed in the run log and recorded in the report
(`tests/unit/migrationOutOfOrderOverride.test.ts` asserts every side of it, including that the
refusal still fires without the flag). The hazard is a numbering artifact, not a rewrite: the
`0291`–`0299` batch does not depend on `0277`–`0289`, and §7(a) puts `0277`–`0289` last anyway,
so applying them after `0299` matches the intended order. The workflow
`.github/workflows/apply-staging-migrations.yml` takes the override as dispatch inputs
(`allow_out_of_order`, `override_reason`).

Follow-up (2026-11-06, same day): the apply stopped at `0280` (run 42206458716) because the
fixture shop held six active standard owners, which `0280`'s unique index refuses. Root cause:
migration `0113`'s trigger gives an owner membership to every user inserted with
`is_original_owner = true`, and five test identities were seeded that way although they are
admins. The fix, at the root: `is_original_owner` is now false in the five seed sites
(`tests/setup/fixtures.ts` and the four lane suites), and the one-time script
`scripts/dev/qa-fix-0280-duplicate-owners.mjs` demoted exactly those five to the Store Manager
role (QA Admin, Destruct/Perm/Fin/Inv test users) with an explicit branch scope, because
migration `0188`'s trigger refuses a role change away from owner on a NULL scope; the
designated fixture owner, Khalid Khan (923001234567), was untouched. The script was dry-run
first (run 42212212138, PASS) then applied (run 42212500959, APPLIED and committed). A
branch-only workflow cannot be dispatched — GitHub registers workflows from main — so the
one-time workflow file was dropped and the fix rode on the registered `qa-probe.yml` instead;
the temporary `run_fix`/`fix_apply` inputs and the `pg` install step stay on the branch until
the Phase 2 PR merges, then they go away with the probe revert. The re-dispatched apply
(run 42214806581) then recorded all ten files, `0280`–`0289`, and the QA ledger stands at 290
rows with 0 pending. The same run's post-apply verify failed only on the QA-only allowlist:
its 44 entries (`0233`–`0276`) went stale the moment Phase 2 imported those files, which is
the closure the file was designed for. The allowlist is therefore retired — the flag is removed
from `ci.yml`, `build-apk.yml` and `apply-staging-migrations.yml`, and
`.github/qa-ledger-only.txt` is deleted; verify now fails closed on any ledger-only row, and
there are none.

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
