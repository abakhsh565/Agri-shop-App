# The production gap, measured against the app — and a premise of the plan that does not hold

**When:** 2026-10-16, after the gated apply path was built and pushed (`7d19c25`).
**Against:** `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-16T14-58-47.sql` (read-only,
restore-verified) and the repository's own `src/`. **Nothing was applied and no production row was
read or changed.**

## 1. The app-blocking gap, measured

| | Count |
|---|---|
| Production, from its own artifact | **28 tables · 2 views · 36 functions** |
| What `src/` reads and calls (scanned, not listed by hand) | **26 tables · 63 RPCs** |
| **Tables the app uses that production does not have** | **8** — `branches`, `client_error_events`, `memberships`, `permissions`, `product_variants_public` (a view), `role_permissions`, `roles`, `user_permissions` |
| **RPCs the app calls that production does not have** | **46** — including `get_my_branches`, `get_my_permissions`, `get_my_shops`, `set_active_shop`, `set_active_branch`, `create_role`, `create_employee`, `update_employee_access`, `set_place`, `rename_branch`, `delete_role`, `resolve_invite`, `set_user_pin`, `provision_member_login`, … |

That measurement is why the deployed app renders and the signed-in surface does not: the marketing
path needs none of it, and every admin/employee screen needs most of it.

## 2. The finding: the model's DDL exists in **no tracked SQL file**

`docs/PRODUCTION_MIGRATION_PLAN.md` §4 says batch 2 is a gap migration "to author, then verify", adding
what D-1 and D-2 name — the missing relations, types and columns, and the missing functions. That is
authored from the repository, and for the functions it can be: their definitions are in the migrations
(0104–0196 define every RPC above except six).

For the **relations it cannot be**, and that is measured, not suspected:

```
create table branches            → NONE (not in any tracked .sql)
create table roles               → NONE
create table memberships         → NONE
create table permissions         → NONE
create table role_permissions    → NONE
create table user_permissions    → NONE
```

* Not in `supabase/migrations/` — 206 files, none of them creates these.
* Not in the two root setup files either: `COMPLETE_DATABASE_SETUP.sql` (1080 lines) and
  `ALL_MIGRATIONS_TO_RUN.sql` (2737 lines) do not mention them at all.
* They exist **only inside environment dumps** — production's own artifact does not have them, and the
  staging artifact defines every one of them:
  `backups/backup-staging-bpybjrjenwccowvtrevu-2026-10-15T14-11-09.sql` → `create table if not exists
  public."branches"` at line 7715, one statement each for all six.

**Consequence.** The branch/membership/permission model — the thing that makes the signed-in app work —
was created out-of-band in an environment and recorded nowhere in the repository. So a gap migration
cannot be authored purely from the repository, and the plan's batches 2–4, as written, cannot close the
gap on their own. This is the same divergence `SCHEMA_STRATEGY.md` §1 measured from the other side
("the migration directory is a patch set, not a baseline": nothing in it creates the base tables).

## 3. The two questions this leaves the owner

1. **Where may batch 2's relation DDL come from?** The repository has no source. The candidates are the
   accepted staging baseline (schema-only extraction of exactly the named objects, then verified against
   production's baseline like every other file — the policy's own line is *"code and schema move forward;
   DATA never moves up"*), or a hand-authored model, which is the entire RBAC/branch schema and is not a
   realistic single workstream.
2. **Who applies the verified batches?** `scripts/run-with-production-credentials.mjs` deliberately
   hands the production password only to the read-only backup and restore verifier, so the apply path
   built today is runnable only by an owner act: exporting the credentials by hand, or approving the
   intake to include `migrate.mjs` for the gated apply and nothing else.

## 3b. The extraction, and where it ended

The owner approved extracting the relations from the accepted staging baseline, and the extraction was
run and verified against production's baseline (never against production):

```
backups/migration-proof/corpus-e/0207_the_membership_model_exists_in_the_repository.sql
  run 1 → 55 statements · FAIL: 16 sql failures
  run 2 → 68 statements (6 tables · 17 alter · 8 indexes · 10 functions · 4 triggers · 14 policies · 6 RLS,
           plus 3 enum types) · FAIL: 5 sql failures
npm run verify:baseline -- --baseline production --files <that file> --json backups/baseline-prod-relations-0207.json
```

The first run's 16 failures had **three roots**, which is what the closure was missing:

| Failures | Root |
|---|---|
| 1 | `type "membership_role" does not exist` — the `memberships` table cannot be created, which cascades |
| 14 | `relation "public.memberships" does not exist` — the cascade itself |
| 1 | `function allowed_branch_scope() does not exist` — one policy on `branches` calls it |

The cause was the extractor, not the extraction: this dump writes enums inside `do $$ begin … exception …
end $$` guard blocks and puts a function's name on the line **after** `create … function public.`, so a
keyword-anchored scan matched neither. Looking definitions up **by name** instead pulled in
`membership_role`, `membership_status`, `user_role` and ten functions the six tables actually need
(`allowed_branch_scope`, `app_is_admin`, `current_shop_id`, `membership_in_active_shop`,
`resolve_active_shop` and the four trigger helpers) — and the failure count fell from 16 to 5.

**The 5 that remain, and why:**

| Failures | Cause | Next move |
|---|---|---|
| 1 | `function public.membership_in_active_shop(unknown) does not exist` — `app_is_admin()`'s body calls it, and it is emitted later | order the pulled functions by their own dependencies, not in dump order |
| 1 | `function public.resolve_active_shop(uuid) does not exist` — `current_shop_id()` calls it | same |
| 1 | `relation "user_active_shops" does not exist` — `resolve_active_shop()` reads it | widen the closure one level: relations referenced by pulled functions, not only the six asked for |
| 1 | `function allowed_branch_scope() does not exist` — the `branches_select_tenant` policy | follows from the above: the function did not create |
| 1 | the fifth is the same family | — |

So the relations are extractable and the approach is measured to converge: **one closure level and a
topological order** stood between that file and a PASS on production's baseline. Both were supplied, and
the file is now `supabase/migrations/0207_the_membership_model_exists_in_the_repository.sql`:

```
npm run verify:baseline -- --baseline production --files 0207_…  → PASS  76 statements, 0 sql failures
npm run verify:baseline -- --baseline staging    --files 0207_…  → PASS  76 statements, 0 sql failures
```

Round 4 is the one that made it safe to apply anywhere: the statements are **catalog-guarded**
(`pg_constraint` / `pg_policies` / `pg_trigger` / `pg_type` checked first), so on staging's baseline —
where every one of these objects already exists — the file went from 23 failures to 0 while changing
nothing, which is the no-op `SCHEMA_STRATEGY.md` §6.3 asks of a forward file.

## 3c. The function half — the other 46 RPCs, delivered as `0208`

The relation half alone leaves the signed-in app broken, because §1's second measurement is separate:
**46 of the app's 65 client RPCs have no function at all** in production's schema. Their bodies call ten
more functions that are equally absent, so the closure is 62, and they read relations and columns
production does not have either.

The definitions are in the repository (`0104–0196` define them), so unlike the relations this half needs
no dump for the functions — but it does need a *rule*, because 62 functions and 28 columns copied by hand
is not a reviewable change. `scripts/dev/extract-missing-functions.mjs` is that rule, and the rule was
tested by being wrong twice:

| Generation | What the verifier said |
|---|---|
| 1 (functions only) | FAIL, 6: `public.branch_responsibility` (×4), `current_branch_id()`, `mint_barcode(text, uuid)` — the call scan matched only unqualified calls, and nothing looked at the relations a body reads |
| 2 (+ relations, + ledger columns) | FAIL, 2: `column s.marketplace_enabled does not exist`, and 0193's multi-column `ALTER` emitted without its terminator |
| 3 | **PASS — 2 files, 235 statements, 0 sql failures** |

What the file carries, and where each part comes from:

| Part | Count | Source |
|---|---|---|
| Functions | 62 | the ledger's **last** `CREATE [OR REPLACE] FUNCTION` per name, in computed dependency order |
| Relations | 7 | the ledger's `CREATE TABLE` for the relations those bodies read (`incidents`, `product_barcodes`, `branch_responsibility`, …) |
| Columns | 28 | the ledger's own `add column if not exists` for the columns those bodies read — except `notifications.shop_id`, which **no tracked file writes** and which is extracted schema-only from the accepted staging baseline under §7.2's decision |
| EXECUTE contract | 62 | the ledger's ACL per function: `authenticated` always, `anon` only where the ledger leaves it, and otherwise `revoke … from public, anon` — because a freshly created PostgreSQL function is executable by PUBLIC until something says otherwise |

Verification, on both baselines and on the real engine:

```
verify:baseline --baseline production  → PASS  2 files, 235 statements, 0 sql failures
verify:baseline --baseline staging     → PASS  2 files, 235 statements, 0 sql failures
rehearse:engine --baseline production  → PASS  2 files, 235 statements, 0 failures · vs PGlite: AGREES
rehearse:engine --baseline staging     → PASS  2 files, 235 statements, 0 failures · vs PGlite: AGREES
```

**The post-state, asked of the rehearsed engine rather than inferred from the file.** On the kept scratch
database (production's baseline + 0207 + 0208, real PostgreSQL 17.6):

| Question | Answer |
|---|---|
| Client RPCs with no function | **0 of 65** (was 46) |
| Client RPCs `authenticated` cannot execute | **0 of 65** |
| Client RPCs whose `anon` access disagrees with the ledger's contract | **5 — none of them created by this file** |

Those five (`create_sale`, `create_purchase`, `process_return`, `upsert_reminder_occurrence`,
`update_reminder_occurrence_status`) are in production's baseline already, are **not** in 0208's closure,
and carry PostgreSQL's PUBLIC default where the ledger says `REVOKE … FROM public, anon`. The same five
read the same way on staging's rehearsed baseline, so this is a **pre-existing divergence between the
ledger's contract and both environments**, not an effect of this file: of the 62 functions 0208 creates,
**0** disagree with the contract. It is recorded here rather than fixed here, because narrowing EXECUTE
on a live RPC is its own deliberate change with its own evidence.

## 3d. The batch run through the ledger on QA — 2026-10-17

Batch 2 was applied to **staging (QA)** through the same recorded path production will use, and only
there:

```
$ node scripts/migrate.mjs apply --env staging          → pending 2, "Nothing was applied"
$ node scripts/migrate.mjs apply --env staging --apply  → ✓ 0207 (76 statements, recorded)
                                                          ✓ 0208 (159 statements, recorded)
$ npm run migrate:verify → 200 rows ↔ 200 files, every hash matches. VERIFY: PASS
```

On QA both files are **no-ops with an effect on the record only** — every object they carry already
exists there, which is why staging's own baseline replay passed with 0 failures *before* the apply.
What the apply proves is the recorded path itself: on a live project, the file and its ledger row land
in one transaction, and `verify` reads the hash back on every later run. Regression afterwards, all
green: unit **75 files / 976 tests**; targeted integration **12 files / 159 tests** (tenant and branch
isolation, RBAC, membership, permissions — two files re-run after the apply); browser **25 tests in
real Chrome** against QA — branch responsibility in EN and UR, branch removal, role-in-use deletion,
session refresh, RTL/LTR, and retry-after-timeout. `tsc` exits 0.

## 4. What is *not* claimed

* Nothing has been applied to production. Its ledger still reads `8 / 0016`.
* No production data was touched, and none is planned outside Plan A — which remains owner-run because
  the data policy says a script may not delete a production record.
* The app is **not** operational for signed-in users, and this record does not claim otherwise: the
  Vercel deployment being green and the unauthenticated surface being error-free says nothing about the
  eight missing tables and forty-six missing functions above.
* The **engine rehearsal ran**, and it is no longer the gap this list used to record. Docker started;
  the local Supabase CLI stack is `Postgres 17.6` — production's own version — with `pgcrypto`/`pgsodium`/
  `pg_net` present and the platform's `auth`/`storage` schemas copied schema-only. Both baselines were
  loaded into their own scratch databases (production's 268 data statements and staging's 2267 counted and
  **never applied**) and both files applied to each: **PASS, 235 statements, 0 failures**, agreeing with
  PGlite (`AGREES`). The one failure the staging load reports is in the *dump*, not in any file:
  `CREATE OR REPLACE FUNCTION public._test_check_auth()` → `function app_is_admin() does not exist` — a
  test function the staging artifact carries whose dependency is absent. It is unchanged by these files
  and is recorded rather than worked around.
* **What the rehearsal still does not cover**, so it is not claimed: the hosted platform's own behavior —
  Supavisor pooling, the default-privilege configuration of a hosted project, the storage and auth
  services, and the hosted `postgres` role's authority.
* **85 of the ledger's 185 function names are still absent from production** and are not in this batch:
  they are outside the app's call surface, and each one would need its own reason to ship. The number is
  here so the remainder stays visible instead of reading as "the gap is closed".
* Two commits are pushed to `main` (`7d19c25`, `d867861`). The console fix's CI finished **green**; the
  pipeline for the migrate commits was still **in progress** when this was written, so it is not claimed
  as passing.
