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
| `anon` access that disagrees with the ledger's contract | **the rehearsal cannot answer this** — see the correction below |

**Correction — a rehearsal artifact, found and fixed 2026-10-17.** An earlier version of this table
recorded "5 client RPCs whose `anon` access disagrees with the ledger's contract", read off the scratch
database. That number was a property of the **harness**, not of any environment: the project's own backup
format carries schema and data and **no privileges at all** — the production artifact contains 0 `GRANT`
and 0 `REVOKE` statements, and staging's contains 0 of each too — so every function loaded from a baseline
starts out with PostgreSQL's default `EXECUTE TO PUBLIC`, and a comparison against it measures that
default. The question can only be asked of a database that has ACLs:

```
live QA, 23 names (the seven that showed a rehearsal difference, the twelve that differed between the two
rehearsal databases, and four batch-2/batch-3 names chosen as controls):
  anon may execute: 1 of 23 — `delete_role`, which the ledger's own contract also leaves to PUBLIC
  authenticated may execute: 23 of 23
```

So QA's ACLs **match the ledger**: no discrepancy to fix there. Production is the open question, and it
is now stated as one: **production's EXECUTE privileges have never been measured**, because every
artifact this repository holds of it was written without them (`backups/migration-proof/…` §
`get-my-shop-request-acl` measured six names read-only on 2026-10-13 through a catalog probe, which is the
only such measurement on record). Closing that gap needs a read-only catalog query against production —
an owner act, since the credential intake hands the password only to the backup and the restore verifier.

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
in one transaction, and `verify` reads the hash back on every later run.

**The live QA schema, asked after the apply** (read-only `run_sql` over the HTTP API, the same path the
integration suite uses — not inferred from the file, and not from the regression alone):

| Question | Answer |
|---|---|
| Batch 2's functions present | **62 of 62** |
| Batch 2's relations present | **7 of 7** |
| Batch 2's columns present | **28 of 28** |
| The 46 client RPCs `authenticated` cannot execute | **0 of 46** |
| Ledger rows for `0207`, `0208` | both present (200 rows total, hashes verified by `migrate:verify`) |

Regression afterwards, all green: unit **75 files / 976 tests**; targeted integration **12 files /
159 tests** (tenant and branch isolation, RBAC, membership, permissions — two files re-run after the
apply); browser **27 tests in real Chrome** against QA — branch responsibility in EN and UR, branch
flow corrections in EN and UR, branch removal, role-in-use deletion, session refresh, RTL/LTR, and
retry-after-timeout. `tsc` and the production build both exit 0.

## 3e. Batches 3 and 4, measured — and the schedule as written cannot be applied (2026-10-17)

The plan predicted that the gap-dependent files "should apply once batch 2 lands". Measured, they cannot:

| Measurement | Result |
|---|---|
| Batch 1 + batch 2 + all 14 batch-3 candidates, **ascending** (the only order the tools accept), production's baseline | **101 statements fail** |
| Classified against what 0207/0208 actually create | **86 name objects batch 2 creates**, 10 name objects no file creates, 5 are the files' own assertions firing |
| The same selection on the **real engine in dependency order** (batch 2 first — an order the gate refuses) | **19 of the 27 files apply cleanly**, including 0183, 0184, 0188, 0189, 0194, 0196 |

The order is not a preference, it is the tools' rule: `verify-forward-on-baseline` sorts a `--files`
selection by version, and the production gate refuses a batch that is not ascending. `0188` therefore
always precedes `0207`, and the objects it needs are created by `0207`. So the remaining work is not a
batch but a **re-issue**: the intent of 0177–0198 expressed in files numbered after `0208`, carrying the
objects the dependency-order run still names — `marketplace_listings`, `shops.latitude`,
`sales.notes`, `stock_adjustments.shop_id`, `my_shop_ids()` (defined by the pre-position file 0168),
`delete_branch(uuid, text, text)`, plus the two catalog-driven corrections 0180 and 0192 assert for
themselves. Full table: `docs/PRODUCTION_MIGRATION_PLAN.md` §4.

## 3f. The owner-run steps, measured where they can be (2026-10-17)

| Step | Result |
|---|---|
| Fresh production backup, read-only, through the credential intake | **taken** — `backup-production-gkswcfljxlutkfdvvqng-2026-10-16T20-31-20` (326 KB, 30 tables, 249 rows, 56 FKs, 104 policies, cluster `7666007964130682852` — production's own fingerprint) |
| Restore verification of that backup | **PASS** — integrity, replay, counts, structure, digests, auth; `memberships`, `roles`, `permissions`, `role_permissions` reported "not in this environment", which is the gap seen from the data side |
| Demo-data audit, read-only, from that artifact | **a finding, not a cleanup**: demo-identity ids in 6 tables (`shops` 1, `users` 2, `companies` 3, `customers` 3, `products` 4, `product_variants` 10), demo names/phones in `auth.users` 2, `shops` 1, `users` 3; and **79 rows across 8 tables** reference the demo tenant (`sales` 52, `customers` 6, `products` 6, `app_settings` 5, `companies` 4, `users` 4, `returns` 1, `shops` 1) |
| The cleanup runbook's own guard | **PASS** — Plan A refuses a database with a real shop, then empties every table and rolls back; it names every table that holds rows, so a forgotten table cannot survive the wipe; Plan B removes exactly the two test artifacts and touches no business row |
| The combined batch's verification, 13 files (batch 1 + batch 2) on production's baseline | **PASS — 13 files, 285 statements, 0 sql failures** (`backups/baseline-prod-batch1-and-2-verified.json`). On **staging's** baseline the same batch reports **1** failure: `0181` creates `audit_events_no_client_writes` with a bare `create policy` and the policy already exists there — a non-idempotent statement in a batch-1 file, recorded rather than papered over (production's baseline does not have that policy, and the ledger's per-file transaction and hash skip mean the same environment cannot apply it twice) |
| Can an agent reach the apply path at all? | **No, by construction.** With every precondition file in place, the intake still refuses: `[CREDENTIAL INTAKE REFUSED] "scripts/migrate.mjs" is not on the allow-list … hand only to the commands that read production and write nothing: backup-database.mjs, restore-verify.mjs. An injector that runs anything is a credential leak with a polite interface.` So items 3–4 of the 2026-10-17 brief — apply the batch, then verify production's ledger, signed-in app, branch isolation and RBAC — are **owner acts**, and nothing here claims them |
| The release gate | **REFUSED** — `no owner approval: pass --owner-approved only after the exact migration plan above has been reviewed by the owner`. The other conditions are unmeasured from here: the tree carries other threads' artifacts (`.freebuff/`, `tests/e2e/results/`), and the repository's Actions API is not readable without credentials, so "is there a green CI run for this commit" is **UNKNOWN**, not assumed |
| Production's EXECUTE privileges | **UNMEASURED** — see §3c's correction. The only such measurement on record is the six-name read-only probe of 2026-10-13 |

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
