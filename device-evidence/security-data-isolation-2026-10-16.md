# Security & Data Isolation — evidence closed, 2026-10-16

**Branch** `ci-proof/full-tree` @ **`f0a73d1e`** (0 ahead / 0 behind `origin`) · **QA project**
`bpybjrjenwccowvtrevu` — every run below printed `[EnvGuard] Environment verified: bpybjrjenwccowvtrevu`.
**Production was never read or written** (0 requests; `.env.qa` only; the QA tools refuse the production
ref by name).

**The item this answers, verbatim:** *"Close Security & Data Isolation evidence gaps quickly. Do not
restart the audit or rebuild working fixes."* The gaps being closed are the `PARTIAL` rows in
`staging-checklist-status-2026-10-15.md` §3.

---

## 0. One line

**Seven of the eleven §3 rows are now measured, and the one thing that had never existed — a per-role
backend matrix for Owner/Admin/Manager/Employee on the same actions in the same tenant — was written
and run: `tests/integration/securityMatrix.test.ts`, **19/19, exit 0** (it grew by the four rows the new
coverage guard required), non-vacuity proven by injection — plus
`tests/unit/securityMatrixCoverage.test.ts`, **7/7**, which fails if a consequential RPC reaches the
ledger without a row in that matrix. Both were then committed, pushed and **measured green by CI**
(§8). The remaining unmeasured leg is named in §6 and is not a code defect.

---

## 1. The pending integration run — checked first, then reused

`gh run view 38809237887` (the PR run fired by the last push, head `f0a73d1e`, docs-only):

| Job | Result |
|---|---|
| Gates (tsc · unit guards · safety proofs · build) | **success** (21:22:24 → 21:23:45) |
| QA (migration ledger · integration suites) | **success** (21:23:48 → 21:34:42) |
| E2E lanes against QA | **success** (completed, 46m 5s) |

Its integration half **passed on this commit**, so it is reused rather than re-fired: no relevant code
changed, and the result is complete for the integration suites. **Correction, measured later the same
day:** while this pass began, that E2E job was still `in_progress` and was described here as *"the
runner appears stalled, not failed"*. It finished and the whole run reads **success** — so the
docs-only commit `f0a73d1e` is green end to end in CI (Gates, QA, and the E2E lanes), and the earlier
*stalled* wording was a snapshot of an unfinished job, now superseded by the job's own conclusion. No
part of this pass rests on the E2E lanes either way.

## 2. The new artifact — the per-role matrix that never existed

`tests/integration/securityMatrix.test.ts` (**uncommitted**, local evidence; CI has not seen it).

Five personas in the existing QA tenant, each removed at the end of the run: **owner** (original owner),
**admin**, **manager**, **employee**, plus an **admin whose role holds one unrelated permission**. Each
non-owner persona carries a role created for the run with an explicit permission set, is scoped to the
main branch and has that branch selected, and the fixture asserts that shop/branch context itself before
any matrix row is read, so a refusal can never be "no branch at all".

### 2.1 The matrix, as measured

| Action (permission) | Owner | Admin | Manager | Employee |
|---|---|---|---|---|
| `create_customer` (`customers.create`) | allow | allow | allow | allow |
| `void_sale` (`sales.void`) | allow | allow | allow | **refused** |
| `adjust_stock` (`inventory.adjust`) | allow | **refused** | **refused** | **refused** |
| `deactivate_employee_v1` (`employees.manage`) | allow | **refused** | **refused** | **refused** |
| `delete_product` (`products.delete`) | — | **refused** | **refused** | **refused** |

Two things make those cells mean something rather than "nothing happened":

* A **refusal is asserted as the guard's own text** — `NOT_AUTHORIZED: missing permission <code>` — so
  a refusal produced by the wrong layer fails the test.
* An **allow is asserted as the ABSENCE of that text**, and the payloads are chosen so the authorized
  caller is stopped by the RPC's own business validation instead: the invalid latitude for
  `create_customer`, the record-branch check for `void_sale`, the product check for `adjust_stock`,
  `EMPLOYEE_NOT_FOUND` for `deactivate_employee_v1`. **No matrix cell writes a row.**

Plus one assertion about the model itself: **`admin` is a role, not the owner.** 0195 makes the owner
the only implicit full permission set; the admin with one unrelated permission is refused
`customers.create` *the way an employee is* (`missing permission customers.create`) while its own
effective set reads back as exactly `['reports.view']` against the owner's 20+ codes.

### 2.2 Non-vacuity, measured by injecting the failure once

Granting `sales.void` to the employee role and re-running flips **exactly** the employee assertion:

```
× sales.void: owner, admin and manager pass the guard; the employee is refused with sales.void
  AssertionError: employee was NOT refused void_sale: expected
  'NOT_AUTHORIZED: record branch access …' to contain 'missing permission sales.void'
 Test Files  1 failed (1) · Tests  1 failed | 14 passed (15)
```

The grant was then removed and the file re-run green (15/15 at that point; 19/19 once §3.2's rows were
added). The denial assertions therefore measure
the permission wiring, not a test that cannot fail.

### 2.3 Direct API/RPC bypass — four refusals, each re-measured

| Attempt as | Result |
|---|---|
| `anon` → `create_customer` RPC | refused (no data, error returned) |
| `anon` → read `customers` / `companies` | **0 rows each** |
| employee → direct `INSERT` into `customer_payments` and into `sales` | refused (0195 revoked INSERT/UPDATE/DELETE on the money ledgers from `authenticated`) |
| employee → direct `INSERT` into `user_permissions` granting itself `inventory.adjust` | refused by RLS (`users.role = 'admin'`), **and** `get_my_permissions` still does not contain it, **and** the row count for that override is 0 — a refusal that still wrote cannot pass |

### 2.4 Sensitive fields — cost/margin, customer, supplier

* **cost/margin:** a member with no `products.view` reads **zero** `product_variants` rows, while the
  owner reads real rows with non-null `cost_price` — the control that makes the absence a refusal rather
  than an empty tenant. (The employee *projection* half, `product_variants_public` without `cost_price`,
  is `variantIsolation.test.ts`'s measured property and still passes — §3.)
* **customer and supplier records:** zero `customers` / `companies` rows without
  `customers.view` / `companies.view`, real rows for the owner as the control.
* **RPC layer:** the owner naming an unknown id is refused at the guard, not at authorization —
  `create_sale` → *customer access denied*, `record_supplier_payment` → *supplier access denied*,
  `adjust_stock` → *product access denied*. A foreign record cannot be reached by id through the RPCs
  that carry money.

### 2.5 Cross-branch reads and writes

* A write addressed to the **sibling branch** is refused for a branch-scoped manager
  (`branch access denied`), and the **same call by the owner is refused for a different reason** (the
  probe's invalid latitude) — so the manager's refusal is the branch scope, not the payload.
* A member's `sales` read is restricted to the **branch being worked in** (every returned row is in that
  branch), and the same read with no `sales.view` returns **zero** rows — so the read above was a
  permission-based read and not an unfiltered one.
* The non-vacuity control for "one branch at a time" (a sale planted in each branch, one visible and the
  other not, re-scoped by `set_active_branch`) lives in `branchScopeEnforcement.test.ts` and ran in the
  same set — §3.

## 3. The existing tests, run — nothing rebuilt

One command, one QA project, `--fileParallelism=false`, the same flags as the CI step
(`device-evidence/logs/security-matrix-affected-2026-10-16.log`):

```bash
npx vitest run tests/integration/{securityAudit,rbacEnforcement,rbacInvariants,employeePermissions,
  branchScopeEnforcement,tenantBoundarySweep,tenantIsolationOps,variantIsolation,duplicateActionSafety,
  createOnceSafety,employeeAccessOverrides,rbacLifecycleAndSessions,auditIntegrity}.test.ts \
  --fileParallelism=false --reporter=verbose
 Test Files  13 passed (13)
      Tests  146 passed (146)
```

Exit code **0**. What each leg contributes to §3:

| §3 row | Where the evidence comes from |
|---|---|
| Tenant isolation across relevant data | `tenantBoundarySweep` (all four `public` views read as a real authenticated session; `tenants` 1 own / 0 foreign after 0206; `users_public` 42501; `marketplace_listings` anon-by-design gated on the owner's opt-in), `tenantIsolationOps`, `rbacEnforcement`'s tenant-isolation block |
| Branch/shop isolation for reads and writes | `branchScopeEnforcement` 12 tests (stamping, cross-branch write refusal, one-branch-at-a-time reads, unheld branch not switchable, empty/NULL non-owner scope refused) |
| Owner, Admin, Manager and Employee permissions enforced | **`securityMatrix` — the gap, now measured (§2.1)**; `employeePermissions`, `rbacEnforcement`, `employeeAccessOverrides` |
| Direct API/RPC requests cannot bypass permissions | **`securityMatrix` §2.3**; `rbacEnforcement`'s direct-ledger-write refusal; `rbacInvariants` invariant B (no tenant write RPC executable by `anon`) |
| RLS policies correctly protect database tables | `securityAudit` (RLS enabled across the public tables, DELETE/INSERT policies, storage, `users` UPDATE policy), `rbacInvariants` A/E |
| No unauthorized access via views, functions or `SECURITY DEFINER` RPCs | `securityAudit` (protected RPCs, empty/fabricated JWT), `rbacInvariants` E, and the **definer early-return/retry leg below** |
| No cross-tenant or cross-branch data leakage | the row above, plus `securityMatrix` §2.5 |
| Private fields, credentials and secrets are not exposed | cost/margin and customer/supplier rows: `securityMatrix` §2.4, `variantIsolation`; credential literals: `productionDataPolicy` rule 6 |
| Audit records preserve the real actor and branch context | `auditIntegrity` (+ `branchIdentityBoundary`'s Activity-RPC assertions) |
| Employee role/permission revocation works correctly | `rbacLifecycleAndSessions` (deleting a used role revokes access rather than refusing, no orphaned reference, repeated deletion cannot bypass it), `employeeAccessOverrides` (reset clears every exception) |
| Sessions and cached permissions cannot preserve revoked access | `rbacLifecycleAndSessions` (live session: access changes apply at the next authorization boundary; the server reports effective permissions, not the client) |

### 3.1 `SECURITY DEFINER` early-return / retry paths — already covered, nothing added

`duplicateActionSafety` and `createOnceSafety` ran in the 13-file set above (one action once, under a
double submit and under a retry after the fact, for the payments, the void, the adjustment and the
purchase). The branch half of the same defect class is measured in
`tests/unit/branchIdentityBoundary.test.ts` — **34 tests, green** in the unit run below — which asserts:

* `void_sale` and `process_return` on a sale that lives in another branch are refused with
  `record branch access denied`, **before any side effect** (the sales table is compared before/after);
* a `create_sale` retry whose ledger row belongs to another branch is refused with
  `another branch or record`;
* the same replay refusal on **every other guarded ledger** — `record_customer_payment`,
  `record_supplier_payment`, `adjust_stock`, `create_purchase` — because each RPC has its own ledger
  lookup and the untested ones are exactly how a migration could silently drop the guard's ordering;
* each planted key still exists **exactly once** afterwards, so a refusal that wrote cannot pass.

`0192` injects `guard_operational_request` as the first statement after `BEGIN` and re-injects it at
every retry-return site; those assertions are the measurement of that.

### 3.2 The matrix cannot silently stop describing the system — new guard

`tests/unit/securityMatrixCoverage.test.ts` (**7/7, exit 0**) closes the loop the matrix opened: the
seven reachable consequential RPCs are derived from the migration that owns them — the `CASE p_rpc
WHEN …` mapping inside `0192`'s `guard_operational_request`, minus the endpoint the same file REVOKEs
(`void_sale_v1`) — and the guard fails when any of them is not both **called by name** in the matrix and
asserted with **the permission code its guard raises**. It also fails if the matrix stops asserting the
guard's refusal text at all, so "the permission appears" cannot be satisfied by a mention. No
hand-maintained list exists: adding an eighth guarded RPC changes what the guard requires without anyone
editing a second file.

**Non-vacuous, measured:** injecting `WHEN 'qa_probe_rpc' THEN 'qa.probe'` into the ledger's CASE mapping
fails it with *"qa_probe_rpc (never called in the matrix)"*; the migration file was then reverted
byte-clean (`git status` for `supabase/migrations/` empty) and re-verified green with the replay and
schema guards (**23/23**). `securityMatrix` grew by the four rows this required — `create_purchase`,
`process_return`, `record_customer_payment` and `create_sale` refused with `purchases.create`,
`returns.create`, `customers.payments` and `sales.create` — taking it to **19/19, exit 0**.

## 4. TypeScript, migrations, QA baseline

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **exit 0** |
| Unit guards (incl. the definer-boundary suite) | `npx vitest run tests/unit/{branchIdentityBoundary,canonicalRoles,fixtureIdCollision,featureRegistryGuard,rpcContractGuard,productionDataPolicy,microcopy}.test.ts` | **7 files, 132 passed, exit 0** |
| New coverage guard, and the migration guards after its injection was reverted | `npx vitest run tests/unit/{securityMatrixCoverage,migrationReplayability,schemaBaseline}.test.ts` | **3 files, 23 passed, exit 0** |
| Migration ledger | `node scripts/migrate.mjs verify --env staging` | **VERIFY: PASS**, 198 files ↔ 198 rows, every hash matching |
| QA baseline (independent) | `npm run qa:baseline` | **exit 0 — BASELINE OK**, every row declared, every fixture present, isolated tenant empty |
| Feature registry | `npm run registry:build` | guard **14/14 passed**; `SCREEN-INDEX.md` unchanged; `dependency_graph.json` left at HEAD (see §5) |

The baseline check is what proves the new suite leaves nothing behind: `customers 10`, `products 5`,
`product_variants 5`, `companies 3`, `sales 2` — exactly the declared fixture floor — with
`audit_events` reported as history rather than bounded. It ran **after** `securityMatrix` and the
13-file set, i.e. on the database they had just written to.

## 5. Records updated

* `feature-registry.json` — `employees-roles` now lists `securityMatrix` and carries the matrix as
  measured evidence (with the injection transcript); `branch-tenant-scope` lists the additional test
  files, gains the 2026-10-16 tenant/branch measurement, and its stale
  *"0188–0195 are local, unapplied … Live QA/API evidence is BLOCKED"* caveat is replaced with the
  measured position: the migrations are in the QA ledger and the boundaries are measured live. What
  stays `BLOCKED` is only the **browser-driven branch-removal flow**, which this pass did not run.
* `device-evidence/staging-checklist-status-2026-10-15.md` — §3 rows re-marked, §11 row updated, the
  counts line recomputed from the label grep.
* **`dependency_graph.json`** was regenerated by `registry:build` (241 added / 21 removed lines — it was
  also catching up entries for `customerDeletionSecurity`, `qaExcessCriteria` and
  `branchIdentityBoundary` that predate this pass). It was **reverted to HEAD** and the registry guard
  re-run: **14/14, exit 0**. A generated artifact should not carry this pass's unrelated catch-up inside
  its diff; the file is reproduced by `npm run registry:build` whenever the registry owner wants it.

## 6. What is still not measured — stated, not smoothed

1. **The browser leg of branch removal** (create → rename → archive in a real browser, the archived
   state and fallback branch the UI shows, and that a reload keeps it). Database contract measured;
   UI flow not. `BLOCKED` by nothing but not being in this pass's scope — and it is the one item the
   registry still carries as `BLOCKED`.
2. **The E2E lanes of the pushed run are still executing** (§8) — unaffected by a test-and-docs change,
   and reported as such rather than as a result.
3. ~~`securityMatrix.test.ts` is uncommitted~~ — **closed:** the suite and its coverage guard were
   committed as **`d0bfaece`** and pushed, and CI measured them (§8).
4. **Two 2026-10-06-era documents still describe the gate as unpassed.**
   `docs/RBAC_GATE_READINESS_REPORT.md` and `RBAC_BRANCH_IMPLEMENTATION_STATUS.md` say
   *"RBAC + BRANCH SCOPE + ACCOUNTABILITY: NOT PASSED"* and *"the live per-role matrix … does not
   exist yet"*. Those statements were true when written and are now superseded by measurement; they were
   **left in place deliberately** rather than rewritten, because they are dated reports of what was true
   on their date. The live status is the checklist and the registry.

## 7. Verdict per gap

| Gap (checklist §3) | Verdict |
|---|---|
| Per-role backend matrix (Owner/Admin/Manager/Employee, allowed + denied RPC) | **FIXED + VERIFIED** — `securityMatrix` 19/19, non-vacuous by injection, and green in CI (`38816842445`) |
| Direct API/RPC bypass | **FIXED + VERIFIED** — anon RPC/reads, direct ledger writes, self-escalation, all refused and re-measured |
| Sensitive fields (cost/margin, customer, supplier) | **PASS** — `securityMatrix` read gate + `variantIsolation` + `tenantBoundarySweep` |
| `SECURITY DEFINER` early-return / retry paths | **PASS** — `branchIdentityBoundary` (34) + `duplicateActionSafety` + `createOnceSafety`; no assertion was missing except the ones the new coverage guard required (§3.2) |
| The matrix keeps describing the system as it changes | **FIXED + VERIFIED** — `securityMatrixCoverage` 7/7, non-vacuous by injection (§3.2) |
| Cross-branch reads and writes | **PASS** — `securityMatrix` + `branchScopeEnforcement` (12) |
| Cross-tenant leakage | **PASS** — `tenantBoundarySweep` + `tenantIsolationOps` + the tenant leg of `rbacEnforcement` |
| Revocation, sessions and cached permissions | **PASS** — `rbacLifecycleAndSessions` + `employeeAccessOverrides` |
| Audit actor/branch context | **PASS** — `auditIntegrity` |
| Browser branch-removal flow | **BLOCKED** — not run in this pass; see §6.1 |

**SECURITY & DATA ISOLATION: PASS for every gap that was identified in §3 except the browser-driven
branch-removal flow, which is the single remaining blocker and is labelled `BLOCKED`, not passed.**

## 8. The push, and CI's own result

Committed **`d0bfaece`** (5 files: the two new test files, the registry, this record and the checklist)
and pushed to `origin/ci-proof/full-tree`; `git rev-list --left-right --count HEAD...@{upstream}` = `0 0`.
The PR run it fired is **`38816842445`**:

| Job | Result | What it executed |
|---|---|---|
| Gates (tsc · unit guards · safety proofs · build) | **✓ success** | includes the new `tests/unit/securityMatrixCoverage.test.ts` |
| QA (migration ledger · integration suites) | **✓ success** | includes the new `tests/integration/securityMatrix.test.ts` against the QA project |
| E2E lanes against QA | in progress at the time of writing | unaffected by this change (test-only + docs) |

The two jobs that execute the new artifacts are **green in CI**, not only locally. The lanes' own
verdict is left to the job rather than predicted.

## Constraint compliance

Production untouched (0 requests, no production credentials, tools refuse production by name). **The
commit and push were explicitly requested** ("commit … then push so CI runs it") and are the only
repository-state changes this pass made: `d0bfaece` on `ci-proof/full-tree`, nothing staged that
another session had touched, no deploy, no reset, no stash. No feature added; no working fix rebuilt;
no assertion weakened — the guide's own rule was honoured by injecting a failure into both new guards
and watching each catch it.
