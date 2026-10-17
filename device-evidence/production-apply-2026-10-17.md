# Production apply — 24 files applied, ledger verified, and one critical data finding

**When:** 2026-10-17 14:36–14:56Z. **Target:** `gkswcfljxlutkfdvvqng` (Agrishop APp, cluster
`7666007964130682852`). **Authorization:** owner-approved for this batch and this step.
**Verdict: the schema batch is applied and verified. Production's application data is NOT ready:
`memberships`, `branches` and `roles` are empty, so every management RPC refuses. See §4.**

## 1. First attempt failed before writing anything — a code defect, not a SQL one

The gate passed all four preconditions, then `scripts/migrate.mjs:294` threw
`TypeError: Cannot read properties of undefined (reading 'length')`. Cause: `gateProductionBatch`
returns directory entries (`version`, `filename`, `sha256`, `bytes`, `mtimeMs`) and
`applyOne` read `entry.body`, which nothing populated. The path had never run, so the bug was never
hit. Fix: read the file the gate verified, in `runProductionApply`:

```js
const outcome = await applyOne(target, { ...entry, body: fs.readFileSync(path.join(dir, entry.filename), 'utf8') });
```

**Production was unchanged by that attempt**, measured read-only after the crash: ledger **8** rows
(latest `0016`), `branches` 0, `get_my_branches` absent, `users` still 3 policies of which 2 were
always-true.

## 2. Applied

```
✓ 24 files, each with its ledger rows in the same transaction
  Production's ledger now: 32 row(s), latest 0219
```

| Check | Result |
|---|---|
| Ledger rows | 32 (8 legacy + 24 applied) |
| `schema_migration_files` rows | 24 |
| sha256 of every recorded file vs the file on disk | **24 / 24 match** |
| `migrate verify --env production` | **refused by design** (verify is one of the modes production refuses); the hash comparison above is the equivalent evidence |
| App RPCs previously missing (`get_my_branches`, `get_my_permissions`, `set_active_shop`, `create_role`, `has_effective_permission`, …) | **0 missing** |
| Sampled row counts | sales 52, products 6, customers 6, users 4 — unchanged from the backup |

## 3. Security, measured after the apply

| Question | Before | After |
|---|---|---|
| Functions on the write surface reachable by `anon` (guard's own regex) | 9 | **0** |
| Trigger functions executable by `anon` | 5 | **0** |
| Always-true permissive policy on `public.users` | 2 | **0** |
| `users` policies | out-of-band `true` | `select`/`update` = `shop_id = current_shop_id() OR id = auth.uid()`, `insert` = shop-scoped |
| Always-true permissive policies, all measured tables | 14 | **11**, on 8 tables: `companies`, `customers` ×2, `inventory_movements`, `products` ×2, `purchases`, `sales` ×2, `shop_requests`, `shops` |
| Functions executable by `anon` (all) | 37 | 37 of 125 — readers and helpers (`get_*`, `lookup_*`, `resolve_*`, `sanitize_*`), **none** on the write surface |
| `anon` calling `set_customer_credit_limit` on a real customer | — | **REFUSED `NOT_AUTHENTICATED`** |

The 11 remaining always-true policies belong to tables whose scoping files (`0183`–`0196`) were
"not applicable as numbered" and have **not** been re-issued — they are outside this batch, not a
regression. Cross-shop probing on production is limited: production has **one** shop, so a two-shop
probe cannot be built from real data; the `users`/`user_permissions` policies themselves are
shop-predicated (verified by expression, and on QA behaviourally).

## 4. CRITICAL — the model is applied, the rows it needs are not

Production after the batch:

```
shops 1 · users 4 (2 admin, 2 employee, all with shop_id) · memberships 0 · branches 0 · roles 0
```

The batch is schema-only by design ("no data statements", plan §6.2), and production never had the
membership rows — they exist only in staging/QA, created out of band. Measured as the shop's original
owner, inside rolled-back transactions:

| Probe | Result |
|---|---|
| `authorize_business_action('sales.view')` | **REFUSED** `NOT_AUTHORIZED: tenant access denied` |
| `set_active_shop(<own shop>)` | **REFUSED** `NOT_AUTHORIZED: not an active member of shop …` |
| `create_operating_branch(...)` | **REFUSED** `NOT_AUTHORIZED: only the business owner can create a branch` |
| `get_my_branches()` | 0 rows |
| `get_my_permissions()` | `[]` |

There is no self-heal: `provision_member_login` itself calls `authorize_business_action`, and
`set_active_shop` requires an active membership. The application cannot create its first branch,
role or membership through any UI path. **This is a blocker for using production, not a security
hole — access fails closed.**

### What completes it (needs owner approval; data, not schema)

1. one **default branch** per shop, from `shops` (`tenant_id`, name, `is_default`, `is_active`);
2. one **membership** per user: `tenant_id = users.shop_id`, role `owner` where
   `is_original_owner`, else `admin` where `users.role = 'admin'`, else `employee`; `status =
   'active'`; `branch_scope = NULL` for the owner, `ARRAY[<branch>]` for the others;
3. canonical **role templates** per tenant plus `memberships.role_id`, or employees hold no
   role and therefore no permissions (owner is implicit-all and works without one);
4. optionally `user_active_shops`, which login sets by itself.

Rollback alternative: the verified backup `backup-production-…14-36-24` restores the pre-batch
schema and data; the ledger would be restored with it.
