# Production schema reconciliation — 2026-10-16

The report that opened this: production's migration ledger holds **8 entries through 0016** while the
repository holds **198 migration files**, so "applying migrations" could damage data or break the app.
This is the measurement that turns that into a plan. Nothing here wrote to production, connected to
production as a migration target, or changed any ledger: every number comes from read-only captures
that already existed plus in-process replays against the frozen production baseline.

The decision this sits inside — never replay history, frozen baselines, forward-only files — is
`SCHEMA_STRATEGY.md` (decided 2026-10-01, implemented and guarded). What was missing was the
production side of it: the object-level differences, the full pending sequence measured against
production's own schema, and an ordered plan. Those are `docs/PRODUCTION_MIGRATION_PLAN.md`.

## 1. Both sides, measured

| | Production | Repository |
|---|---|---|
| Recorded history | **8 rows, latest `0016`** — read from the capture manifest (`migrationLedger`), identical at both captures below | **198 files**, newest `0206` |
| Structure | **28 tables · 37 functions · 2 views · 47 indexes · 56 FKs · 9 checks · 9 uniques · 10 triggers · 104 policies · 8 enums** | — |
| Schemas dumped | `public`, `auth` | — |

Two read-only captures were compared, because a single one could not tell "the baseline is stale" from
"production is quiet":

| Capture | Artifact | sha256 | Rows | Ledger on server | Structure |
|---|---|---|---|---|---|
| 2026-10-01T11:21:48Z | `backups/…2026-10-01T11-21-48.sql` (340,654 bytes) | `59aaca8a…` | 268 | 8 / `0016` | 28 / 37 / 104 / 47 / 10 / 2 |
| 2026-10-15T23:57:01Z | `backups/…2026-10-15T23-57-01.sql` (333,989 bytes) | `ceb62aa9…` | 249 | 8 / `0016` | 28 / 37 / 104 / 47 / 10 / 2 |

**Finding 1 — the ledger is not a record of what production has.** Production's schema is far ahead of
anything 0009–0016 would create: 28 tables, 37 functions and 104 policies whose only possible origin is
the project's own out-of-band setup SQL. So "0016" must never be read as production's state, and
"catching the ledger up" by replaying the directory is not a repair — it is the failure mode
`SCHEMA_STRATEGY.md` §1 measured four ways.

**Finding 2 — production's schema has not moved since the baseline was frozen.** Both captures report
identical structure counts (row counts differ: 268 → 249, i.e. data moved, schema did not). The frozen
production baseline is therefore still a faithful stand-in for production, so nothing below rests on a
stale snapshot. The newer artifact is on disk and could be promoted for freshness; it is not needed for
correctness, and promoting it would mean a second accepted artifact for the same schema.

## 2. The pending sequence, measured against production's own schema

Selection = every file after production's recorded position: **0177 → 0206, 30 files**. Method: the
artifact's schema is loaded into in-process PGlite with all 268 data statements counted and skipped,
then the selection is applied in order. No environment is contacted.

```
node scripts/verify-forward-on-baseline.mjs --baseline production --since 0177 --json …
→ SUMMARY FAIL: 30 files, 275 statements, 106 sql failures, 0 env-gap failures   (exit 1, 69 s)
```

**12 files apply unchanged, 18 do not.** The 18, with their failure counts:

| File | Failures | | File | Failures |
|---|---|---|---|---|
| 0177_a_definer_knows_where_it_looks | 2/3 | | 0189_access_changes_keep_the_person_and_history | 6/15 |
| 0178_a_variant_belongs_to_a_shop | 1/10 | | 0191_operating_branches_preserve_the_business | 8/11 |
| 0180_admin_is_not_a_boundary | 4/11 | | 0192_consequential_records_guard_before_retry | 2/14 |
| 0182_settings_belong_to_their_shop | 1/10 | | 0194_access_edits_do_not_widen_the_editor | 6/9 |
| 0183_deleting_a_role_revokes_its_access | 1/4 | | 0195_permissions_are_not_just_navigation | 3/5 |
| 0184_a_branch_decides_how_far_it_serves | 4/11 | | 0196_a_branch_has_a_responsible_person | 20/22 |
| 0185_a_product_can_be_listed_on_the_marketplace | 4/20 | | 0197_a_notification_says_which_branch | 7/17 |
| 0186_the_branches_read_carries_its_marketplace_state | 4/6 | | 0198_a_sale_keeps_its_due_date_and_leaves_a_movement | 1/2 |
| 0187_the_distance_belongs_to_the_farmer_not_the_branch | 8/17 | | 0188_a_branch_is_not_its_tenant | 24/29 |

### The result that changes the method: a PASS can be an accident of a predecessor

`0193_activity_reads_the_action_history.sql` passed inside the 30-file run and **failed** inside a
12-file batch of the files that had passed:

```
✗ 0193_activity_reads_the_action_history.sql: 9 statements, 1 failures
    [sql] column "tenant_id" does not exist
```

0193 indexes `public.audit_events(tenant_id, branch_id, …)`. In the 30-file run it passed only because
files 0180–0192 had run before it and **partially applied** their statements before failing — leaving
`audit_events.tenant_id` behind for 0193 to use. A file's individual PASS is therefore not evidence
that a batch containing it will pass. The unit of verification is the batch, in the order it will be
applied. This is recorded because it is the kind of thing that would otherwise be discovered during a
real apply.

### Batch 1, verified as a batch

The 11 files that pass with 0193 removed from the batch were then verified as a batch, in order:

```
node scripts/verify-forward-on-baseline.mjs --baseline production --files <the 11> --json …
→ SUMMARY PASS: 11 files, 50 statements, 0 sql failures, 0 env-gap failures   (exit 0)
```

`0179 · 0181 · 0190 · 0199 · 0200 · 0201 · 0202 · 0203 · 0204 · 0205 · 0206`

## 3. The differences themselves, and an independent check on them

The tool's 106 failures reduce to 36 distinct reasons. Grouped by the decision each needs:

| Group | Seen in the failures | Independent corroboration in the dump |
|---|---|---|
| **Missing functions** the newer files grant on or replace | 8 × `get_my_branches()`, 4 × `current_branch_id()`, 3 × `allowed_branch_scope()`, 3+3 × `set_marketplace_settings(...)`, 2 × `current_branch_scope()`, `set_active_branch`, `authorize_business_action`, `assign_employee_branch`, `create_operating_branch`, `archive_operating_branch`, `branch_responsible_person`, `grant/revoke/transfer_branch_responsibility`, `membership_in_active_shop`, `has_effective_permission`, `delete_branch`, `guard_employee_access_edit`, `audit_context_stamp`, `notification_branch_visible`, `get_my_shop_request`, `process_reminders` | `get_my_shop_request`, `process_reminders`, `current_branch_id`, `allowed_branch_scope`: **0 occurrences** in the dump |
| **Missing relations, types and columns** | 22 × `relation "…" does not exist`, 15 × `type "…" does not exist`, 8 × `column "…" does not exist` (`notifications.shop_id`, `audit_events.tenant_id`, `s.latitude`), `type membership_role` | `payments`: 0 occurrences (production has `customer_payments`); `membership_roles`: 0; `membership_role` type: 0; `public.notifications` = `id, kind, title, body, entity_id, actor_id, actor_name, read, created_at` — **no `shop_id`, no `branch_id`** |
| **Non-idempotent history** | `cannot change name of input parameter "p_payload"` (0198, `public.process_return`) | production's `process_return` predates the rename, so `create or replace` is refused by PostgreSQL |
| **The files' own assertions firing** | 0178 *"did not close every permissive-true policy on product_variants: public_all_product_variants"*, 0180 *"left a tenant-blind policy in place: cash_reconciliations.public_all_cash_reconciliations"*, 0182 *"left an app_settings policy with no shop predicate: public_all_app_settings"*, 0192 *"unexpected body for public.record_customer_payment(jsonb)"* | these are the migration files' own guards, correctly refusing to claim work they did not do on *this* lineage |

The second column matters: the tool's report and a direct reading of the artifact agree, so the
differences are not an artifact of PGlite's behaviour.

## 4. Rehearsed on a real Supabase engine, not PGlite

The plan carried one honest caveat: PGlite is Postgres without the platform, so "applies onto the
baseline" was weaker than "applies onto the real server". That is now measured instead of caveated.

`scripts/dev/rehearse-on-local-engine.mjs` (new, `npm run rehearse:engine`) loads a baseline record's
artifact into a **scratch database on the local Supabase CLI stack** and applies a named file
selection to it. It refuses to run without a named baseline, without a `rehearsal_*` database name,
when the artifact's sha256 or byte length disagrees with its record, and when the engine is not
reachable. It counts the artifact's data statements, **refuses to apply them**, and never touches the
local development database or any hosted project.

| | Measured |
|---|---|
| Engine | local Supabase CLI stack, container `supabase_db_…`, **Postgres 17.6** — production's own server version — with `pg_net, pgcrypto, pgsodium` available |
| Platform shape | `auth`, `storage` and `extensions` schemas copied **schema-only** from the stack's own database, so a file that touches storage is judged on a shape production has |
| Baseline loaded | `backups/…2026-10-01T11-21-48.sql`, sha256 re-measured and matched: **520 statements, 0 failures** after the pre-table retry |
| Production rows | **268 data statements counted, 0 applied** — no production row is loaded anywhere |
| Batch 1 applied | **PASS: 11 files, 50 statements, 0 failures**, exit 0 |
| Versus PGlite | **AGREES** — same 11 files, same 50 statements, zero failures, no per-file difference |
| Post-state on the engine | `public.client_error_events` exists with policy `client_error_events_insert_only`; 29 tables and 108 policies in `public` (the baseline+platform shape the batch was applied to) |

**The harness was proven able to fail, because the first version could not.** The initial
implementation ran `docker exec` through `execFileSync`, which returns **stdout only** — and psql
reports SQL errors on **stderr**. Every statement that failed would therefore have been scored as a
success, and the rehearsal would have reported PASS no matter what. Fixed to `spawnSync` with both
streams captured, and then proven: injecting `select * from public.this_relation_does_not_exist;` made
the harness report `✗ 1 statements, 1 failures` with the stderr text and **exit 1**. The exit contract
is measured in full: **2** with nothing named, **2** for a non-`rehearsal_*` database, **1** for a
failing statement, **0** for the PASS above.

**What the rehearsal still does not cover, and is not claimed:** the hosted platform's *behaviour* —
Supavisor pooling, the real default-privilege configuration, the storage and auth services — and the
runtime RBAC path, because the scratch database is deliberately row-less (`scripts/dev/local-db.mjs`
is the tool that restores rows, and it does so for local development against the staging baseline).

## 5. What this did not measure

1. **Production's ledger now.** The dump excludes `supabase_migrations` (a stated limitation of the
   backup tool), and `migrate.mjs` refuses production before connecting, so 8/`0016` is as of
   **2026-10-15T23:57Z** — the newest capture. Nothing later has been measured.
2. **Production as a migration target.** No connection was made to apply anything; `migrate.mjs`
   refuses production by policy and was not modified.
3. **Hosted-platform behaviour.** The rehearsal in §4 covered a real PostgreSQL 17.6 with Supabase's
extensions and platform schemas; it did not cover Supavisor pooling, the hosted default-privilege
   configuration, or the storage/auth services, and its database is row-less by design so no runtime
   authorization path was exercised. "Applies onto the baseline" is now also "applies onto a real
   Supabase engine" — it is still not "behaves correctly on the hosted project".
4. **Batch 3 membership is predicted, not measured** — see `docs/PRODUCTION_MIGRATION_PLAN.md` §4.
5. **Semantics.** That a file applies says nothing about what it does to behaviour; RBAC and RLS
   claims still need their own evidence.

## 6. Reproducing every number here

```bash
# both sides
node -e 'JSON.parse(require("fs").readFileSync("backups/…2026-10-15T23-57-01.manifest.json","utf8"))'   # migrationLedger, structure
ls supabase/migrations/*.sql | wc -l

# the pending sequence, and batch 1
node scripts/verify-forward-on-baseline.mjs --baseline production --since 0177 --json backups/baseline-prod-forward-0177.json
node scripts/verify-forward-on-baseline.mjs --baseline production --files <the 11 in §2> --json backups/baseline-prod-batch1-verified.json

# the independent object checks
grep -c 'function public."current_branch_id"' backups/…2026-10-15T23-57-01.sql
```

Reports and logs live in gitignored `backups/`: `baseline-prod-forward-0177.{log,json}`,
`baseline-prod-batch1.{log,json}` (the 12-file attempt that exposed the 0193 trap),
`baseline-prod-batch1-verified.{log,json}` (the verified 11).
