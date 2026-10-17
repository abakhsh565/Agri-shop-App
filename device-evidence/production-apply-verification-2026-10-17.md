# Production apply — 0220 and 0221 recorded, measured, and the one finding that blocks use

**When:** 2026-10-17, measured at 15:04–15:22Z. **Target:** `gkswcfljxlutkfdvvqng` (Agrishop APp,
cluster `7666007964130682852`), confirmed by the credential guard. **Authorization:** owner-approved
apply of the six-table RLS correction, then `0220` through the existing gate, with `0221` allowed to run
as a no-op.

**Verdict: the migration apply is complete and recorded. The ledger, the ACL closure and the
authorization model check out. Production is NOT ready to use, because the branch model was applied
without the branch data: all 52 sales, 17 inventory movements, 13 stock adjustments and the payment,
return and purchase rows have `branch_id = NULL`, and the branch-scoped policies hide every one of them
from every signed-in role — the owner included. See §4.**

## 1. The ledger — a fact, not a claim

Read over a read-only transaction on production's own ledger:

| | Value |
|---|---|
| `schema_migrations` rows | **34** (8 legacy `0009`–`0016` with no hash, + 26 applied files) |
| latest version | **`0221`** |
| `schema_migration_files` rows | 26 |
| sha256 of recorded file vs file on disk | **25 / 26 match** |
| mismatched | `0220` — see §6, the applied body and the repository body differ only in post-assertions |

`0220` was recorded at `2026-10-17T15:00:49.425Z` (sha256 `f4c0cba25d28…`, 11,192 bytes) and `0221` at
`2026-10-17T15:00:50.307Z` (sha256 `36d88d04f8d7…`, 3,053 bytes). Both were written by
`scripts/migrate.mjs` in the same transaction as the file — the mode that refuses `--env production`
unless a named batch, a PASS report against production's baseline, a fresh backup and a restore report
of that same artifact are all present (`backups/prod-batch-26-verified.json`, fresh PASS at 15:10Z
after this session's edit, 26 files / 454 statements / 0 failures; backup
`backup-production-gkswcfljxlutkfdvvqng-2026-10-17T14-58-46`, restored and compared: integrity,
replay, counts, structure, digests, auth all true).

**The production credential in `~/.agrishop/production.env` is read-only**
(`default_transaction_read_only = on`, measured). The apply above therefore could not have been
performed by this session, and nothing in this session wrote to production: every statement here ran
inside `BEGIN READ ONLY`, and the one probe that tried to build a second shop was refused by the
database (`cannot execute INSERT in a read-only transaction`) rather than forced.

## 2. The rows 0220 exists to create — present and correctly shaped

```
shops 1 · users 4 · branches 1 ("Default Shop - Main", default+active)
permissions 32 · roles 4 · memberships 4 · user_active_shops 4
```

| User | membership | own shop | scope | role template | permissions |
|---|---|---|---|---|---|
| `…0002` original owner | `owner`, active | yes | NULL = all branches | — (owner is implicit-all) | 32 |
| `84deb713…` admin | `admin`, active | yes | `[d717d974…]` | Store Manager | 29 |
| `c333f839…` employee | `employee`, active | yes | `[d717d974…]` | Sales Employee | 6 |
| `…0003` employee | `employee`, active | yes | `[d717d974…]` | Sales Employee | 6 |

Store Manager 29 = the 32-code catalogue minus `employees.manage`, `employees.view`, `settings.edit` —
the definition `scripts/dev/canonical-roles.mjs` checks against `0107`. Every membership names the
user's own `users.shop_id`; no membership exists in any other tenant.

## 3. Authorization now answers, and answers per role

Measured by impersonating each account (`set local role authenticated` + `request.jwt.claims.sub`)
inside a read-only transaction:

| Probe | Owner | Store Manager | Employee |
|---|---|---|---|
| `get_my_permissions()` | 32 | 29 | 6 |
| `get_my_branches()` | 1 | — | — |
| `get_my_shops()` | 1 | — | — |
| `authorize_business_action('sales.view')` | allowed | — | — |
| `authorize_business_action('sales.create')` | — | allowed | allowed |
| `authorize_business_action('employees.manage')` | — | **refused** | **refused** |
| `authorize_business_action('reports.view')`, `products.delete`, `settings.edit` | — | — | **refused** |
| `anon` calling `authorize_business_action` | `permission denied for function` | | |

This is what was missing before the file: production's four users authenticated and authorized
nothing. Access no longer fails closed for the wrong reason; it fails closed for the right one.

## 4. BLOCKER — the branch model has no branch data, so signed-in users see no sales

Every row in every branch-scoped table carries `branch_id = NULL`, because the branch did not exist
when they were written and nothing attached them to it:

| Table | rows | `branch_id` NULL |
|---|---|---|
| `sales` | 52 | **52** |
| `inventory_movements` | 17 | **17** |
| `stock_adjustments` | 13 | **13** |
| `supplier_payments` | 2 | **2** |
| `customer_payments` | 1 | **1** |
| `returns` | 1 | **1** |
| `notifications` | 51 | **51** |

Those tables carry **RESTRICTIVE** SELECT policies of the form `branch_id = ANY (current_branch_scope())`
(`sales_branch_select`, `purchases_branch_select`, `returns_branch_select`,
`stock_adjustments_branch_select`, `supplier_payments_branch_select`). `NULL = ANY(scope)` is not true,
so the rows are excluded for every `authenticated` caller:

| Caller | sales visible | customers | products |
|---|---|---|---|
| owner | **0** of 52 | 6 | 6 |
| Store Manager | **0** of 52 | 6 | 6 |
| employee | **0** of 52 | 6 | 6 |
| `anon` | **52** | 6 | 6 |

The last row is the absurd end state, and it is not a bug in the policy file: `anon` is not subject to
the `authenticated`-only restrictive policy, and a pre-existing permissive `sales_select` policy says
`true` (see §5). So the shop's sales are readable by an unauthenticated caller and invisible to its
owner.

**This is a data-completion gap, not a policy defect.** The fix is one forward file that assigns every
NULL `branch_id` in a shop with exactly one active branch to that branch, asserts no NULL remains, and
leaves anything ambiguous untouched — the same shape as `0220`, run once the owner approves it. Until
then, the Sales, Purchases, Returns, Stock and Payments screens on production are empty and using
production would look like data loss. **It has not been applied**, and this session cannot apply it:
the credential is read-only.

## 5. What the batch closed, and what it did not

Closed, measured after the apply:

* the six tables `0208` created (`product_barcodes`, `barcode_registry`, `barcode_history`, `incidents`,
  `incident_rate_limits`, `incident_signatures`): `relrowsecurity = true`, 0 policies → deny-by-default
  for `anon` and `authenticated`; the definer RPCs that read them still resolve `authenticated`;
* `anon` cannot execute a write RPC: 0 of 51 on the write surface, 0 trigger functions exposed, and
  `authorize_business_action` itself is `permission denied` to `anon`;
* `users` has no always-true policy; `users`/`user_permissions`/`memberships` are shop-predicated;
* the 24-file batch's ACL state is unchanged by `0220`/`0221` (both files are data/RLS-flag only).

Still open, pre-existing, and outside this batch (the files that scope them, `0183`–`0196`, were never
re-issued as numbered):

1. **`anon` reads business data.** Measured with `role anon`: `sales` **52 rows**, `customers` **6**,
   `products` **6**, `permissions` 32. The public anon key can read the shop's sales, customers and
   products. The responsible policies are permissive and `true` to `public`: `sales_select`,
   `sales_select_anon`, `products_select_anon`, `customers_select_anon`, `public_all_products`.
2. **Eleven always-true permissive policies remain**, on eight tables: `companies`
   (`public_all_companies`), `customers` (`customers_update`, `customers_update_auth`), `products`
   (`products_update_all`, `public_all_products`), `sales` (`sales_update`, `sales_update_auth`),
   `purchases` (`public_all_purchases`), `inventory_movements` (`public_all_inventory_movements`),
   `shop_requests` (`public_all_shop_requests`), `shops` (`public_all_shops`).
3. **`anon` holds INSERT on the six relations `0207` created** — `branches`, `memberships`,
   `permissions`, `role_permissions`, `roles`, `user_permissions`. RLS denies today (no permissive
   insert policy for `anon`, and `anon` reads 0 rows from all six), so the grant is not a live hole,
   but it is a grant that no migration intended. The same shape as `0216`, applied to six more tables.

## 6. `0220`'s repository body is not byte-identical to the applied body — exactly, and only, in its assertions

The file was corrected after it was applied, because the version production received refuses to run on
staging's data (two multi-shop owners, two pending invitations — supported product states). The
correction was made before that was noticed. What it changed:

| Applied body (`f4c0cba2…`, 11,192 bytes) | Repository body (`9817e2aa…`, 12,469 bytes) |
|---|---|
| `v_scope uuid[]` declared | `v_rows int`, `v_added text[]` declared instead |
| asserts over **every** membership | asserts over **the rows this file inserted** (`v_added`) |
| `raise notice …` | same, plus `created % by this file` |

No `insert`, no `update`, no DDL, no loop changed. Reconstructing the applied body from the repository
file reproduces sha256 `f4c0cba25d28…` byte for byte, which is the proof that the difference is exactly
the assertions and the comments. The ledger keeps the hash of what actually ran, and `0220` is applied
in both environments, so no future batch can name it. The divergence is recorded here and in
`docs/PRODUCTION_MIGRATION_PLAN.md` rather than fixed by editing production's ledger.

## 7. Cross-shop isolation — structurally enforced where it was written, not demonstrated behaviourally

Production holds **one** shop, and this session's credential is read-only, so a two-shop probe cannot be
built on production: no synthetic tenant can be inserted, and there is no second real tenant to read
across. What can be said, from the policies themselves:

* shop-predicated (a second shop *would* be isolated): `users_select`/`users_update`
  (`shop_id = current_shop_id() OR id = app_current_user_id()`), `users_insert`
  (`shop_id = current_shop_id()`), all three `user_permissions` policies (target must hold a membership
  in `current_shop_id()`), `memberships_select_tenant_admin` (`tenant_id = current_shop_id()`), and the
  RPC path (`authorize_business_action` resolves the caller's membership; a foreign tenant id is
  refused with `NOT_AUTHORIZED`);
* **not** shop-predicated: `customers`, `products`, `sales` and the other always-true tables in §5.2.
  Their restrictive gates check *permission*, not the row's shop, and their permissive `true` policies
  OR over the top. With one shop nothing leaks; with two, a member of shop A would read and (for
  `customers_update_auth`, `sales_update_auth`, `products_update_all`) rewrite shop B's rows.

So cross-shop isolation is **PASS on the membership/permission model and the RPC path, UNKNOWN
behaviourally, and structurally FAIL for customer/product/sale tables** until the scoping files are
re-issued. Reporting it as a pass would be wrong in the direction that matters.

## 8. What has to happen next, in order

1. **Branch backfill** (§4) — one forward file, owner-approved, then re-measure with the same probes:
   owner/Store Manager/employee each see 52 sales, and `anon` sees none.
2. **Close `anon`'s read path and its six INSERT grants** (§5) — one closure file per concern, the
   `0216`/`0221` shape.
3. `0223`+ re-issue of the `0183`–`0196` scoping intent for `customers`, `products`, `sales`,
   `purchases`, `companies`, `inventory_movements`, `shop_requests`, `shops`, so cross-shop isolation is
   a policy property rather than a single-tenant accident.

None of 1–3 is applied. Production's schema and ledger are now consistent with the repository except
for `0220`'s documented assertion-only difference.

## 9. The two guards this change had to touch, and why

* `tests/unit/productionMigrationPlan.test.ts` asserted the plan still said **NOTHING HAS BEEN
  APPLIED**. That was true and is not any more; the test now demands the opposite evidence — the applied
  versions, the ledger count, the link to this report, the `0 of 52 sales` blocker, and the unchanged
  approval gate. Non-vacuity re-proved by editing the blocker sentence in the plan and watching the
  test fail by name (`the branch-data blocker is not stated`), then restoring it.
* `tests/unit/migrationReplayability.test.ts` reported five **false positives** across `0220` and
  `0221`: a bare `loop` or `else` line followed by a lower-case line is a complete PL/pgSQL statement,
  not an identifier split. The rule now excludes a closed set of block keywords (`loop`, `else`,
  `then`), and a new test pins the 0012 shape it exists for (`o` / `utstanding_payable`) as still
  caught and each excluded keyword as not caught. The files themselves were **not** reflowed: both are
  applied, and reflowing them would break the ledger hashes for `0221` as well.

`npx tsc --noEmit` clean; `npx vitest run tests/unit/` 76 files / 999 tests pass.
