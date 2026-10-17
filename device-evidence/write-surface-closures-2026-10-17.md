# Three closures the batch needed, found by guards rather than by failure counts

**When:** 2026-10-17, after `0209`–`0214` were applied to hosted QA.
**Trigger:** the full suite run, with the live integration guards in it. Not a review, not a hunch.

Three separate defects were found and fixed, all in the same shape: **a batch written to reproduce an
environment is not automatically a batch that enforces a security property.** Each was caught by a guard
that asked a different question than the file's own assertion did.

---

## 1. Nine write RPCs executable by `anon` — `0215`

```
FAIL tests/integration/rbacInvariants.test.ts > Invariant B — no tenant write RPC is executable by anon
+ [ "approve_credit_limit_request_v2", "archive_company", "create_company", "create_role",
+   "delete_my_account", "delete_product_barcode", "delete_role",
+   "reject_credit_limit_request_v2", "update_role" ]
```

`0208` reproduces each function's EXECUTE contract "from the ledger" — staging's own catalog state — and
`0214`'s ACL pass re-applies every ledger ACL statement after the last create. For these nine, that
contract is `anon` may execute. `0209`–`0214` were verified PASS against both frozen baselines and the
real engine, and none of those runs could see it: the baselines carry no `GRANT` at all, so every ACL
question asked of a rehearsal describes PostgreSQL's default, not an environment.

**Fix:** `0215_a_write_rpc_is_not_for_an_unauthenticated_caller.sql` — revoke `PUBLIC, anon` from the
write surface (the same regex and allow-list the live guard uses), close trigger functions to every API
role, assert the result.

**Measured on QA after the apply:** 51 write-surface functions, **0** anon-executable; the nine
individually `anon` false / `authenticated` true; `insert_shop_request` and `lookup_user_by_phone` still
executable by `anon`; 0 trigger functions exposed.

## 2. `anon` writable on `public.users` — `0216`

Fixed proactively from the read-only measurement of production, not from a failure: production has `anon`
holding INSERT/UPDATE/DELETE on four tables. `0212` closes the money tables, `0213` closes
`audit_events`, and **nothing in the range names `public.users`** — QA measures `anon` false there only
because QA's grants came from the migrations while production's were made out of band.

**Fix:** `0216_an_unauthenticated_caller_cannot_write_the_people_table.sql` — revoke
INSERT/UPDATE/DELETE/TRUNCATE on `public.users` from `anon`; leave `authenticated` alone (the app edits
profile rows directly) and compare before/after readings rather than hard-coding them.

## 3. `0215` widened access while narrowing it — `0217`

```
FAIL tests/integration/saleIdempotency.test.ts
     4. the unchecked implementation is not reachable from an authenticated client
FAIL tests/integration/tenantResolverReplay.test.ts > the chain is internal
     anon and authenticated cannot execute the resolvers → [ 'create_shop_internal' ]
```

`0215` revoked `anon` correctly and then GRANTED `authenticated` EXECUTE on the whole surface. The ledger
retires fifteen functions from the client; seven are on the write surface, so `0215` handed back the
bypass those two guards exist to prevent. Its own assertion could not see it — it asks about `anon`.

**Fix:** `0217_a_retired_function_is_not_for_the_client.sql` — revoke `PUBLIC, anon, authenticated` from
the ledger's server-only set, each inside an existence test, and assert none is reachable.
**Measured on QA after:** all 15 present, **0** reachable by either API role.

`0215`'s only post-apply edit was the `LOOP` keyword moving onto the preceding line (a static guard reads
lines, not SQL). `migrate reconcile` proved it before recording it: *"Compared with the recorded
statements, ignoring comments and whitespace: identical"*.

---

## Verification of all three, at the layer each one needs

| Check | Result |
|---|---|
| `verify-forward-on-baseline --baseline production --files <batch 1+2 + 0209–0217>` | **PASS — 22 files, 448 statements, 0 sql failures** |
| `verify-forward-on-baseline --baseline staging --files <0207–0217>` | **PASS — 11 files, 398 statements, 0 sql failures** |
| `migrate apply --env staging --apply` | **0215, 0216, 0217 applied and recorded**, one transaction each (0209–0214 were recorded in the re-issue's own apply) |
| `migrate verify --env staging` | **PASS — 209 rows, every file recorded, every hash matches** |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **119 files, 1517 tests, 0 failures** |
| `npx vitest run tests/unit` (re-run after the last test edit) | **76 files, 0 failures**; `tsc` exit 0 |
| `npm run test:e2e:lanes` | **PASS — 2 lanes, 66 tests, 0 failures** (`isolated` 35 tests/4m12s, `reconcilers` 31 tests/7m13s) |
| `npm run build` | exit 0 |
| `npm run qa:count` | 4,930 business rows (4,905 of them `audit_events`) — the QA cleanup this batch's triggers produced, still an owner act |
| Live guards re-run alone (`rbacInvariants`, `saleIdempotency`, `tenantResolverReplay`) | **PASS** |
| QA privileges after (read only, `has_function_privilege`) | 0 anon-reachable write functions; 0 exposed trigger functions; 15/15 retired functions closed; `users` anon-writable false |
| Pre-session paths intact | `insert_shop_request` and `lookup_user_by_phone` still executable by `anon` |

## What is NOT claimed

* **Production is unchanged.** Its ledger still reads `8 / 0016`. These files reach it only if the owner
  runs the gated apply, and the post-apply measurement
  (`scripts/measure-production-acls.mjs`) is the acceptance test — not this document.
* **`public.users`' row policy is still open on production** (`authenticated`, always-true policy). Which
  rows a signed-in principal may edit is a product decision; recorded in `docs/PRODUCTION_MIGRATION_PLAN.md`
  §9.9 rather than guessed at.
* **The window between files.** In one batch apply, `0215`'s grant to `authenticated` exists until `0217`
  removes it. On an end state it never exists; on a live apply it exists for two statements.
* **One E2E evidence report inside a passing spec reads `4 PASS, 2 FAIL`** (`actionCenter` §10, "Approve
  request" → `NOT_AUTHENTICATED`, "Customer limit updated"). It is **not** from this work: the identical
  failure, with the same two steps and the same error, is in `device-evidence/logs/e2e-full-2026-10-15*.log`
  — two days before these migrations existed. The spec itself passes (Playwright marks it `ok`), and the
  failure is in the report's step assertions, not in the run.
* **The frozen baselines cannot answer ACL questions** — they carry no `GRANT`s. Every ACL claim above was
  measured on live QA or on production read-only, never inferred from a rehearsal.
