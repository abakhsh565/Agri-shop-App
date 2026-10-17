# Production closed out — 2026-10-17, 16:28–16:47Z

**Target:** `gkswcfljxlutkfdvvqng` (Agrishop APp, cluster `7666007964130682852`), confirmed by the
credential guard's project-ref check on every run. **Authorization:** the owner's instruction to
finish the blockers and to delete the visible production sales/test transactions, with dependent
records cleaned consistently.

**Verdict: all three reported blockers are fixed and applied, production is empty of test
transactions with its configuration intact, and the write path works end to end.** The verification
in §6 is a live run against production; the only rows it created were rolled back.

## 1. What was actually wrong

| Reported | Root cause found by measurement |
|---|---|
| Screens empty for authorized users | Two independent causes. (a) Every operational row had `branch_id = NULL` because production received the *schema* of `0207`/`0208` but never `0118`'s backfill; the branch policies are `branch_id = ANY(current_branch_scope())` and `NULL = ANY(…)` is NULL, which a policy treats as false. (b) Nothing stamped new rows either — `create_sale_unchecked` and its siblings insert no `branch_id`, so backfilling alone would have fixed the past and left the next sale invisible. |
| Public can read sales/customers/products | 42 tables carried a grant to `anon`, and 38 carried a permissive policy whose predicate was the literal `true` — the demo-era `0022` `*_select_anon` / `public_all_*` set. Every guard asked "can `authenticated` read only its own rows?", which was answered correctly and was the wrong question. |
| `0220` hash mismatch | The repository file had been edited after the apply (two post-conditions narrowed for staging's pre-existing multi-shop memberships). That changed the statements, so the on-disk body stopped matching the hash recorded at apply time. |
| **Found while verifying (not on the list)** | `create_sale`, `create_purchase` and `adjust_stock` raised `column "payload" does not exist` on every call: `0213`'s textual guard splice assumed a parameter named `payload`, and production's bodies name it `p_payload`. `sale_submissions` (the idempotency ledger) did not exist, `purchases` lacked `amount_due`/`status`/`notes`/`recorded_by`, `purchase_items` lacked `unit_price`/`base_unit`, and the legacy `sales.customer_name NOT NULL` rejected the body's snapshot-only insert. Production could not have recorded a sale, a purchase or a stock adjustment. |

## 2. Migrations applied (each through `migrate apply --env production` and the batch gate)

Every file was verified PASS on production's frozen 2026-10-01 baseline immediately before the
apply, and each was applied in one transaction with its ledger rows.

| Version | File | Statements | Applied (UTC) |
|---|---|---|---|
| `0222` | `0222_operational_rows_learn_their_branch.sql` | 2 | 16:32:33 |
| `0223` | `0223_an_unauthenticated_caller_reads_no_business_table.sql` | 2 | 16:32:34 |
| `0224` | `0224_the_three_write_rpcs_a_caller_could_not_call.sql` | 27 | 16:36 |
| `0225` | `0225_the_idempotency_ledger_is_not_addressed_to_anon.sql` | 1 | 16:39 |
| `0226` | `0226_the_trigger_function_is_named_where_it_is_retired.sql` | 1 | 16:44 |

Production's ledger is now **39 rows, latest `0226`**.

### `0220` — resolved without rewriting history

The repository file was rebuilt from `schema_migrations.statements` (the statement production
actually ran) so that only its comments differ, and verified to contain the applied statements
verbatim before anything was recorded. The ledger's file hash was then re-recorded against those
bytes — `270c81c1…`, 12,462 bytes — with `reconciled_at = 2026-10-17T16:32:09.913Z` and a
`reconcile_note` that names the earlier hash `f4c0cba2…` and the reason. `applied_at` is untouched and
the statements did not change; this is the tool's own `reconcile` contract, executed once against the
one database whose ledger it concerns (the production mode refuses `reconcile` by design, so the same
`UPDATE` was run in a transaction after the equivalence check). All `0220`–`0226` hashes now match the
files on disk.

## 3. The data reset

Backup first: `backup-production-gkswcfljxlutkfdvvqng-2026-10-17T16-28-09` (45 tables, 353 rows,
878 KB), restored into PGlite and compared with production — integrity, replay, counts, structure,
digests and auth all **PASS** (`backups/restore-verify-0222.json`).

`scripts/purge-production-test-transactions.mjs` — owner-authorized, production-only, dry run unless
the exact confirmation token is passed, one transaction, invariants asserted **before** commit:

```
deleted: returns 1 · return_items 1 · voids 3 · sales 52 · sale_items 57 ·
         customer_payments 1 · supplier_payments 2 · inventory_movements 17 ·
         stock_adjustments 13 · customer_crops 4 · notifications 51
reset:   customers 6 · products 6 · product_variants 12 · companies 4
```

Derived figures were reset with the rows that produced them: customer `outstanding_balance`,
`total_purchases`, `total_paid`; product and variant `stock_qty`; supplier `outstanding_payable` and
`total_purchases`. Left intact: schema, RPCs, policies, the shop, its branch, the four users, their
four memberships, 32 permissions, 4 role templates, settings, products, variants, customers and
suppliers.

## 4. Why the write path is now correct, not just unblocked

`0222` installs `stamp_operational_branch()` as a BEFORE INSERT trigger on sales, purchases, returns,
customer/supplier payments, inventory movements, stock adjustments, audit events and notifications.
It stamps `current_branch_id()` — resolved from the caller's active membership — and only when that
branch belongs to the row's own shop. An explicit `branch_id` is never overwritten. A trigger is used
because the writes come from several places (`create_sale_unchecked`, `create_purchase`,
`process_return`, the payment RPCs, `adjust_stock`, and a few direct client inserts); it is the one
place every current and future path passes through.

## 5. The exposure fix cannot break the app

Every policy naming `public` or `anon` was retargeted to `authenticated` (predicates untouched), and
`anon` lost every privilege on every relation in `public`. Pre-session reads are RPCs —
`lookup_user_by_phone`, `get_my_shop_request`, `resolve_invite`, `resolve_shop_code`,
`insert_shop_request` — which are SECURITY DEFINER functions and are unaffected; `0215`/`0217` had
already removed every write RPC from `anon`. Checked in `src/`: nothing reads a table before a
session exists.

## 6. Verification (live, after the apply)

```
PASS  ledger 0220/0222/0223/0224/0225/0226 match the files on disk
PASS  no test transactions remain — sales 0, items 0, returns 0, payments 0,
      purchases 0, movements 0, adjustments 0, notifications 0, audit 0
PASS  derived balances and stock are consistent — 0 rows with a non-zero figure
PASS  configuration preserved — shops 1 · branches 1 · users 4 · memberships 4 ·
      permissions 32 · roles 4
PASS  anon holds no table privilege; 0 policies name anon or public
PASS  `set role anon; select from sales` → permission denied for table sales
PASS  create_sale as the owner → sale stamped d717d974…, owner sees it, movement stamped
PASS  create_purchase as the owner → purchase created
PASS  adjust_stock as the owner → adjustment applied
PASS  the verification transaction left 0 rows behind
```

Machine-readable: `backups/final-production-verification-2026-10-17.json`.

Repository checks: `npx tsc --noEmit` clean; `npx vitest run tests/unit/` **76 files / 999 tests
pass**, including the three guards this work touched — `productionMigrationPlan` (new files have
dispositions), `productionDataPolicy` (the purge's confirmation gate is now a checked property, with a
non-vacuity case), and `writeRpcAnonGuard` (it now unions every migration's `v_server_only`
declaration instead of reading `0217` alone, so `0222`'s retired trigger function cannot go unnamed).

## 7. Limits — what was not exercised, and why

* **The production UI was not signed into.** Production has no onboarded real user; the four rows are
  demo accounts on demo phone numbers, and creating a session would either need their credentials or
  write new data the owner asked to remove. The write path was therefore exercised at the same layer
  the app calls (the RPC, as `authenticated`, with a real JWT claim set), and the read path through
  the anon role. A dev server pointed at production is refused by `src/lib/envGuard.ts` by design.
* **Cross-shop isolation is still only structural.** Production has one shop, so a two-shop
  behavioural probe cannot run there; the membership/RLS model and the RPC path assert it, the data
  can no longer demonstrate it.
* **`record_customer_payment` / `record_supplier_payment` / `process_return` / `void_sale` were
  smoke-tested only.** Each answered with a domain error (authentication mapping, required field, or
  branch access) rather than a missing column or relation, so none is broken the way the three fixed
  RPCs were; none was driven through a full happy path in this session.
