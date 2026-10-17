# Production's actual privileges — measured, read only

**When:** 2026-10-17 10:52Z. **Against:** project `gkswcfljxlutkfdvvqng` (Agrishop APp), Postgres 17.6,
cluster `7666007964130682852`. **Read only:** `set default_transaction_read_only = on`, then
`begin; set transaction read only`, then `pg_class` / `pg_policy` / `pg_proc` and the
`has_*_privilege()` functions only. No DDL, no DML, no temporary objects, no `set_config`.

**Why this had to be done here.** The frozen production baseline is a *statement set captured without
GRANTs* — it contains no `GRANT` at all. So every rehearsal in this repository could prove what a batch
*leaves behind*, and none of them could say what production *already holds*. That gap is now closed.

**How it was run** (the credential wrapper is the only path; this is one of its three read-only
commands):

```bash
node scripts/run-with-production-credentials.mjs -- \
  node scripts/measure-production-acls.mjs --env production --json backups/production-acls-measured.json
```

## 1. The measured state

| | anon | authenticated |
|---|---|---|
| SELECT | 16 / 16 measured relations | 16 / 16 |
| INSERT | **4** | **12** |
| UPDATE | **4** | **12** |
| DELETE | **4** | **12** |

`anon` may write **`audit_events`, `customer_payments`, `stock_adjustments`, `users`** — SELECT, INSERT,
UPDATE and DELETE on each.

`authenticated` may INSERT/UPDATE/DELETE **`audit_events`, `customer_payments`, `inventory_movements`,
`product_variants`, `purchase_items`, `purchases`, `return_items`, `returns`, `sale_items`,
`stock_adjustments`, `supplier_payments`, `users`** — i.e. the money, stock and history tables directly,
around the RPCs.

**`audit_events` is directly writable by both API roles.** That is precisely the policy 0181 closes (a
client forging history), and on production the *policy* is `public_all_audit_events: true` — a
permissive policy that is always true.

**Fourteen permissive policies are `true`** on: `app_settings`, `audit_events`, `cash_reconciliations`,
`companies`, `customers` (`customers_update`, `customers_update_auth`), `inventory_movements`,
`notifications`, `product_variants`, `products` (`products_update_all`, `public_all_products`),
`purchases`, `sales` (`sales_update`, `sales_update_auth`), `shop_requests`, `shops`, `users`.

**All 37 functions in `public` are executable by `anon`**, including the SECURITY DEFINER money RPCs
`create_sale`, `void_sale`, `process_return`, `adjust_stock`, `record_customer_payment`, and
`current_shop_id`. Five trigger functions are executable by `anon` as well
(`prevent_role_escalation`, `protect_customer_financials`, `protect_product_stock`,
`protect_sale_financials`, `update_updated_at_column`) — harmless in effect, and still a default
nobody chose.

RLS is enabled on every measured table (no table without it), so the policies above are the whole of
the row-level boundary — and on 14 of them the policy says yes to everything.

The app surface is also still incomplete: **16 of the 22 app-called functions measured are absent**
(`get_my_branches`, `get_my_permissions`, `get_my_shops`, `set_active_shop`, `set_active_branch`,
`create_role`, `create_employee`, `update_employee_access`, `delete_role`, `my_shop_ids`,
`guard_operational_request`, `guard_employee_access_edit`, `delete_branch`, `audit_operational_snapshot`,
`current_branch_scope`, `has_effective_permission`), and six relations are missing (`branches`,
`memberships`, `roles`, `role_permissions`, `permissions`, `user_permissions`).

## 2. What this changes about the batch

Nothing about its verification, and everything about what counts as "done" after it is applied. The
batch is written to close exactly these shapes:

* 0211/0212 rewrite the tenant-scoped policies and drop the `public_all_*` legacy names;
* 0213 closes `audit_events` to client writes and drops `public_all_audit_events`;
* 0212 carries 0195's `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` for the money tables;
* 0214's ACL pass re-applies every ledger ACL statement after the last create, and closes the
  trigger functions the batch itself creates;
* 0208 carries the ledger's EXECUTE contract per function — **and that contract is not the same thing
  as least privilege.** Corrected 2026-10-17 after the batch was applied to hosted QA: nine write RPCs
  (`create_role`, `update_role`, `delete_role`, `create_company`, `archive_company`, `delete_my_account`,
  `delete_product_barcode`, `approve_credit_limit_request_v2`, `reject_credit_limit_request_v2`) came
  out **still executable by `anon`**, because staging's own catalog holds that grant and `0214`'s ACL
  pass re-applied it after every create. The repository's live guard caught it on QA; `0215` is the
  closure (revoke `PUBLIC, anon` on the whole write surface, keep `authenticated`/`service_role`, close
  trigger functions, assert the result). So on production `anon` loses the legacy RPCs it holds here
  **through `0215`**, not through `0208`, and the post-apply measurement must show **0** write-surface
  functions reachable by `anon` — not merely "fewer".

**But "the batch should fix it" is not a measurement.** The post-apply state of production can only be
confirmed by running this same measurement again after the apply, and that is a precondition of calling
the migration complete — not an optional extra.

## 3. The backup taken in the same window

```
artifact   backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-17T10-41-12.sql
sha256     2984c285da0eaaf4…   (full hash in the manifest)
rows       249 across the public tables · FKs 56 · policies 104
restore    PASS — integrity, replay, counts, structure, digests, auth
```

The restore was replayed into a throwaway database and compared with production; every check passed,
and the report names this exact artifact. Both artifacts are older than the one-hour gate only after
11:41Z — an apply must happen inside that window or a new backup must be taken.

## 4. What is still not established

* The `service_role` and `supabase_auth_admin` privileges were not enumerated (the API roles are the
  boundary that matters for a client).
* Privileges on objects outside `public` (`storage.objects`, `auth.*`) were not measured here.
* This document records a measurement, not a fix: production is unchanged.
