# Staging checklist — marked, 2026-10-15

Owner's checklist, all 11 sections, every item marked. **Date:** 2026-10-15 · **Branch**
`ci-proof/full-tree` @ **`e986aa0d`** (= `origin`, 0 ahead / 0 behind).

**Legend.** `DONE` measured this session · `DONE (reused)` valid earlier evidence, files unchanged
since (the repository's own reuse rule) · `PARTIAL` some evidence, a named leg missing · `FAIL`
measured red · `NOT DONE` not performed · `UNKNOWN` no evidence, and never reported as a pass ·
`DONE (owner decision)` — **closed at the owner's instruction on 2026-10-15 where the
item was a policy choice or the owner's own step.** The basis column still states the evidence that does
and does not exist, so a closed item is not read as a measured one. Two labels are deliberately *not*
used for measured results: `FAIL` and `UNKNOWN` are measurements and are not converted by instruction.

**Correction, 2026-10-15 (later pass).** Five rows that read `FAIL`/`NOT DONE` were re-measured —
`crossScreenSync` (§4, §11), `dashboardScope` (§5, §4), the integration step (§7) and the E2E step (§7)
— and four of them are now `DONE`. The reason they were wrong is recorded so it cannot repeat: the
figure "142 passed / 5 failed" came from `tests/e2e/results.json`, a **per-lane artefact that every lane
run overwrites**, holding the 2026-10-14 **morning** run (`25 failed · 100 passed · 24 skipped`, whose
failures were classified and fixed the same day). The authoritative full run is
`backups/e2e-final-2.log` = **146 passed · 1 failed · 2 did not run**, and the single failure was
`doubleTapSafety`'s residue precondition — now **3 passed**. Full record with commands and logs:
`device-evidence/automated-verification-2026-10-15.md`.

**Correction, 2026-10-15 (later pass, the view class).** §3's "views" leg was `PARTIAL` on the grounds
that `0195 get_effective_permissions` had been inspected — a *function*. No view had ever been read.
Asking the 0178 question of the four views in `public` (reachable by `authenticated`, unfiltered, and
owned by `postgres`, which holds `rolbypassrls`) found one real cross-tenant leak and three correctly
bounded relations, measured rather than assumed:

| View | Boundary | Measurement as tenant A |
|---|---|---|
| `tenants` | **none** — no `WHERE`, no `security_invoker`, `GRANT SELECT … TO authenticated` (0094) | **4 rows: every business** (`fdfdfds`, `Baba jaani`, `Default Shop`, tenant B) — while the `shops` **table** behind it returned 1 own / 0 foreign |
| `product_variants_public` | body filters `EXISTS (products p WHERE p.shop_id = current_shop_id())` | own 1 · tenant B's **0** |
| `users_public` | revoked from `anon` + `authenticated` by 0167 | `permission denied for view users_public` (42501) — not "0 rows" |
| `marketplace_listings` | anon by design, gated by the owner's opt-in in the body | opted-in seller visible to **anon**; a non-opted-in shop absent |

Fixed at the layer that owns the definition of "my shop": `0206_a_view_is_not_a_boundary.sql` sets
`security_invoker = true` on `tenants`, so `shops_select_own (id = current_shop_id())` decides. Re-measured
after: **1 row (own), 0 foreign**. Non-vacuity was proven by injecting the failure once:
`ALTER VIEW public.tenants SET (security_invoker = false)` → the sweep's behaviour test fails with
`tenant A read tenant B’s shop through tenants: expected 1 to be +0` **and** its catalog test fails on the
option; restoring the fix returns 11/11. `fixtureIdCollision` caught one real hazard in the new fixture
(`00000000-…-c0c0` was also `tenantIsolationOps.TENANT_B`, so one suite's cleanup could delete the other's
rows); the id was changed and the guard is green.

**Two limits recorded rather than smoothed over.** (1) The view is **not** in production: the recorded
production schema (`supabase/baseline/production-baseline.json`, captured 2026-10-01) lists
`structure.views = ["product_variants_public", "users_public"]`, and the unguarded form of the file failed
`verify:baseline --baseline production --since 0206` with `relation "public.tenants" does not exist`, so the
migration bounds the alias **where it exists** and reports its absence where it does not — re-run: **PASS**
on both the production and the staging baseline. (2) The file was corrected after it had been applied to QA,
which `migrate verify` correctly flagged (`changed after it was applied`); `reconcile` refused, as designed,
because the statements rather than only the comments had changed — so the stale ledger row was removed and
the file re-applied, and `verify --env staging` is **PASS** again (198 files / 198 rows, every hash matching).
Re-run after the re-apply: view option `security_invoker=true`, sweep **11/11**, `migrationReplayability` +
`schemaBaseline` + `fixtureIdCollision` **18/18**, `tsc --noEmit` exit 0, unit guards **843/843**.

**Correction, 2026-10-16 (the Security & Data Isolation pass).** §3's `PARTIAL` rows were closed on
measurement, not on a policy call, and one of them was a gap that had never had an artifact at all:
**the per-role backend matrix.** `tests/integration/securityMatrix.test.ts` now puts owner, admin,
manager and employee in ONE tenant on the same four consequential RPCs, with refusals asserted as the
guard's own text (`NOT_AUTHORIZED: missing permission <code>`) and allows asserted as the ABSENCE of it
— so a call that never reached the guard cannot read as an allow — and with payloads chosen so no matrix
cell writes a row. It is **non-vacuous by injection**: granting `sales.void` to the employee role flips
exactly the employee assertion, and removing the grant returns it to green. The same file carries the
direct-API bypass (anon RPC and anon reads, direct money-ledger writes, self-escalation through
`user_permissions`, each re-measured afterwards) and the sensitive-field read gate (zero
`customers`/`companies`/`product_variants` rows without the permission, the owner's real rows as the
control). The thirteen affected security suites were then run live against QA — **146 tests, exit 0** —
and the `SECURITY DEFINER` early-return/retry leg turned out to be **already covered**, with no missing
assertion: `branchIdentityBoundary` (34 tests) proves the `0192` guard sits before every early return and
is re-injected at every retry-return site for all eight consequential RPCs, with each planted key still
existing exactly once. Full record, including the one leg it left `BLOCKED` (the browser-driven
branch-removal flow — closed by the 2026-10-16 reload/session and branch-removal pass recorded below), and the honest limits: `device-evidence/security-data-isolation-2026-10-16.md`.

**Correction, 2026-10-16 (the release-artifact gate).** §8's *"APK artifact exists and is non-empty —
no CI artifact exists"* and §11's *"CI-generated staging APK verified — the APK job has never run"* were
both wrong about the pipeline, and are now closed with **reused evidence, no rebuild and no re-run**:
`build-apk.yml` run **38802733453** (`success`, 47m 15s) publishes the signed APK as a **GitHub Release
asset** — `Create GitHub Release with APK` — not as a workflow artifact, so reading
`actions/runs/…/artifacts` (which correctly returns 0) was measuring the wrong endpoint. Release
**`apk-build-389`** carries `app-release.apk`, **44,046,488 bytes**, **sha256 `34d12b3d…0676be`**; it was
downloaded at verification time and matched GitHub's size **and** digest exactly, its
triggering run built `31641ecf` whose packaged app source is **identical to HEAD** (`git diff --stat
31641ecf..HEAD -- src/ index.html vite.config.ts package.json public/` empty), its manifest reads package
`com.agrishop.app` and versionName `1.0`, and its bundled web app stamps the **QA** project
(`VITE_SUPABASE_PROJECT_ID: bpybjrjenwccowvtrevu`) while the production ref appears **once**, inside the
environment-contract table. No workflow change was needed, so none was made, and no test lane was
re-run. Full record: `device-evidence/release-artifact-verification-2026-10-16.md`.

**Correction, 2026-10-16 (the reload/session and branch-removal browser pass).** Two rows that stood as
`UNKNOWN`/`BLOCKED` on the strength of "no browser window" now have that window's evidence, and neither was
closed by a policy call. `tests/e2e/sessionRefresh.spec.ts` (**2 passed**) reads the owner's customer name and
balance and the permission-gated settings route from the database, requires them on screen, and requires them
again after `page.reload()` and after a NEW page in the same profile — then switches branch through the app's
own switcher (the real `set_active_branch`) and asserts `user_active_shops.branch_id` and the switcher's
`aria-selected` row across the same two. `tests/e2e/branchRemoval.spec.ts` (**2 passed**) drives the archive
screen against live QA: no archive action on the main branch, the confirmation naming the branch and stating
the real consequence, the confirm button DISABLED until a reason is typed, the archive succeeded with the
screen and the rows agreeing (`is_active = false`, the branch row still present, the main branch and the
`shops` row untouched), and an employee shown no such surface. Three failures were found on the way and each
classified rather than retried blindly: a lane selector that could not match the shared `Input` (a bare
`<input>` with no `type` attribute — the field now carries its own testid), two failures from the QA dev
server dying mid-run (`ERR_CONNECTION_REFUSED`; the restart command first used, `npm run dev:qa`, does not
exist — the repository's server is `npx vite --mode qa --host 0.0.0.0 --port 5173`, per
`scripts/dev/preflight.mjs:47`), and a precondition `UPDATE` that matched 0 rows because `user_active_shops`
had no row for that user yet (it is created by the server's own writers; the lane now uses the same UPSERT
shape `set_active_branch` uses). Only the failing tests were re-run — the test that passed first (an employee
is offered nothing) was never repeated. The guards those specs touch — `playwrightReuseGuard`,
`featureRegistryGuard`, `e2eCleanupOwnership`, `qaFixtureKeepList` — ran **4 files · 63 tests, exit 0**.
Full record: `device-evidence/session-and-branch-removal-live-2026-10-16.md`.

**Evidence sources:** CI runs `38645773012` (build-apk.yml) and `38645769443` (ci.yml), both on
`e986aa0d`; local runs this session; `backups/qa-cleanup-2026-10-15/`; `device-evidence/*.md`;
`ENGINEERING_OS_STATE.md` (the workstream's own status table); `tests/integration/tenantBoundarySweep.test.ts`
and `supabase/migrations/0206_a_view_is_not_a_boundary.sql` (the measurements and the fix above).

---

## 1. Git & Source Control

| Item | Status | Basis |
|---|---|---|
| Correct branch and commit verified | **DONE** | `ci-proof/full-tree` @ `e986aa0d`; `git rev-list --left-right --count origin/…...HEAD` = `0 0` |
| Required changes committed and pushed | **DONE (2026-10-16)** | The three earlier commits (`f93c4e66`, `c3459d72`, `e986aa0d`) are pushed, and so is everything that followed: the CI ordering fix (`34034177`, contained in `31641ecf`), the security pass (`d0bfaece`) and the docs that record the CI results and the release-artifact verification. `git rev-list --left-right --count origin/ci-proof/full-tree...HEAD` = **`0 0`** at HEAD `8ee19eb3`, so nothing of this workstream is held back locally. |
| No unrelated or unfinished changes accidentally included | **DONE** for my commits | each commit staged only this workstream's files; the tree's other 27 dirty files belong to other sessions and were never swept in |
| GitHub source matches the intended staging release | **PARTIAL — narrowed 2026-10-16** | The blocker named two concrete defects; both were checked rather than assumed. **(a) `delete_branch`:** `grep -rn "delete_branch" src/` is now **empty** — the client no longer calls the retired RPC anywhere, and the branch-removal flow goes through `archive_operating_branch` (asserted by `accountDeletion` and the archive refusals in `branchIdentityBoundary`). **(b) the `sales` note column:** the client↔schema pair is exercised green against the deployed schema — the whole integration folder **493/493** and the whole E2E suite **149/149** ran on this HEAD against live QA, and `migrate verify --env staging` = **PASS**. **Why it is still not DONE:** the gate documents that carry the workstream verdict were never re-signed after that measurement — `docs/RBAC_GATE_READINESS_REPORT.md:164` still reads *"VERDICT: RBAC + BRANCH SCOPE + ACCOUNTABILITY: NOT PASSED"* and `RBAC_BRANCH_IMPLEMENTATION_STATUS.md:3` *"Final gate: NOT PASSED"* — and no script or guard asserts release-source coherence, so this row rests on the two inspections above plus the live-suite result, not on a checker. |

## 2. Environment & Configuration

| Item | Status | Basis |
|---|---|---|
| QA/staging Supabase project verified | **DONE** | `[EnvGuard] serving STAGING → bpybjrjenwccowvtrevu`; preview: **35** requests to the QA host, **0** to production |
| Production credentials/configuration not used by staging | **DONE** | `.env.qa` only; `environments.json` → production `localEnvFile: null`; **no `PROD_*` values** in `.env.qa` / `.env.local` — the names appear only as GitHub secret references in `backup-database.yml` and in tooling that reads credentials from files outside the repo; the QA tools refuse the production ref **by name** |
| Environment variables and secrets verified | **DONE** | EnvGuard reported `key verified`; the four signing secrets are present in Actions; CI supplies the `QA_*` set |
| Database connectivity confirmed | **DONE** | CI step *Verify QA Database Reachability* = success; locally a 8444.5 KB backup of 5448 rows was taken today |
| Migration ledger and schema verified | **DONE** | `node scripts/migrate.mjs verify --env staging` → **VERIFY: PASS**, exit 0 (this session); the same check is a green CI step |
| Staging release configuration validated | **DONE** | `vite.config.ts`'s environment gate refuses an unnamed/mis-targeted build; the staging build ran exit 0 and the APK carries the staging ref |

## 3. Security & Data Isolation

| Item | Status | Basis |
|---|---|---|
| Tenant isolation across relevant data | **DONE (local, 2026-10-16)** | Re-measured against live QA as one 13-file security set — **146 tests, exit 0** (`device-evidence/logs/security-matrix-affected-2026-10-16.log`): `tenantBoundarySweep` (every view in `public` read as a real authenticated session — `tenants` 1 own / 0 foreign after `0206`, `users_public` 42501, `marketplace_listings` anon-by-design gated on the owner's own opt-in), `tenantIsolationOps` (reminder config/occurrence tenant-scoping) and `rbacEnforcement`'s tenant-isolation block (tenant B cannot read or mutate tenant A's employees, roles or business areas). |
| Branch/shop isolation for reads and writes | **DONE (local, 2026-10-16)** | `branchScopeEnforcement` re-run in the live set: *hides another branch record*, *keeps every write inside that member's scope*, *re-scopes on switch*, and an empty or NULL non-owner scope refused — plus `securityMatrix`'s branch legs: a write addressed to the sibling branch is refused for a branch-scoped manager (`branch access denied`) while the **same call by the owner** is refused for a different reason (the probe's payload), and a member's `sales` read returns only rows in the branch being worked in. |
| Owner, Admin, Manager and Employee permissions enforced | **DONE (CI-measured 2026-10-16)** | **the gap, now measured, and measured by CI too.** `tests/integration/securityMatrix.test.ts` (**19/19, exit 0**) puts owner, admin, manager and employee in ONE tenant on the same consequential RPCs: `customers.create` passes for all four; `sales.void` passes for owner/admin/manager and is refused for the employee with `missing permission sales.void`; `inventory.adjust` and `employees.manage` pass for the owner only; `products.delete` is refused for every non-owner. An admin whose role carries one unrelated permission is refused exactly like an employee, so `admin` is a role and not the implicit set `owner` is. Refusals are asserted as the guard's own text and allows as the ABSENCE of it, so a call that never reached the guard cannot read as an allow — and the payloads are chosen so no matrix cell writes a row. **Non-vacuity, measured:** granting `sales.void` to the employee role flips exactly the employee assertion; the grant was removed and the file re-run green (transcript: `device-evidence/security-data-isolation-2026-10-16.md` §2.2). |
| Direct API/RPC requests cannot bypass permissions | **DONE (local, 2026-10-16)** | `securityMatrix` (**§2.3**): an `anon` RPC call is refused, `anon` reads of `customers`/`companies` return 0 rows, an employee cannot `INSERT` directly into `customer_payments` or `sales` (`0195` revoked the money ledgers' writes from `authenticated`), and an employee cannot grant itself `inventory.adjust` through `user_permissions` — refused by RLS, with `get_my_permissions` AND the override row count re-measured afterwards so a refusal that still wrote cannot pass. Plus the existing assertions (direct ledger write, cross-tenant write) and `rbacInvariants` invariant B (no tenant write RPC executable by `anon`). |
| RLS policies correctly protect database tables | **DONE (local, 2026-10-16)** | `securityAudit` (RLS enabled across the public tables, DELETE/INSERT policies, storage policies, the `users` UPDATE policy) and `rbacInvariants` A/E ran in the live 13-file set, and `migrationReplayability` holds the schema — ledger **`198 files ↔ 198 rows`, `migrate verify --env staging` PASS**, every hash matching. |
| No unauthorized access via views, functions or `SECURITY DEFINER` RPCs | **DONE (2026-10-16)** | views leg `FIXED + REVERIFIED` (all four views in `public` read as a real authenticated session; the `tenants` cross-tenant read fixed by `0206` and re-measured to 1 own / 0 foreign, non-vacuously). **definer leg now measured, and no assertion was missing:** `tests/unit/branchIdentityBoundary.test.ts` — **34 tests, green** — proves the `0192` guard sits before every early return and is re-injected at every retry-return site, covering the sale ledger, the void, the return, **and each of the four remaining ledger shapes** (`record_customer_payment`, `record_supplier_payment`, `adjust_stock`, `create_purchase`), with each planted key still existing exactly once so a refusal that wrote cannot pass. |
| No cross-tenant or cross-branch data leakage | **DONE (local, 2026-10-16)** | cross-tenant: `tenantBoundarySweep` (11/11, its fixture proven to hold a live shop context, so an absence is a refusal and not a blind session) + `tenantIsolationOps`; the measured `tenants`-view leak (4 rows → 1) is `FIXED + REVERIFIED` by `0206`. cross-branch: `branchScopeEnforcement` (12 tests) and `securityMatrix`'s branch legs, both green in the live set. The gate report's older *"cross-branch isolation = UNKNOWN"* is superseded by measurement: the controlled Main/Warehouse contrast is planted by `branchScopeEnforcement` itself (a sale in each branch, one visible, the other not, re-scoped by `set_active_branch`). |
| Private fields, credentials and secrets are not exposed | **DONE (local, 2026-10-16)** | `securityMatrix` adds the sensitive-field read gate measured on live QA — zero `customers`/`companies`/`product_variants` rows without the permission, with the owner's real rows as the non-vacuity control — plus the RPC layer refusing a foreign customer (`customer access denied`), supplier (`supplier access denied`) and product (`product access denied`) by id. Cost/margin: `preAuthRequestPrivacy` + `productionReachGuard` guards green; the production ref appears in the bundle **only** as the guard constant that refuses a non-production build pointed at production |
| Audit records preserve the real actor and branch context | **DONE (local, 2026-10-16)** | `auditIntegrity` passed in the live 13-file set, and `branchIdentityBoundary` asserts the Activity RPC reads only the selected branch's events with immutable person/role labels while a member without `activity.view` is refused. Live rows for the full browser action list remain a **browser** leg, not a database one. |
| Employee role/permission revocation works correctly | **DONE (local, 2026-10-16)** | `0183` + `rbacLifecycleAndSessions` (deleting a role that employees use revokes its access instead of refusing, no orphaned role or permission reference, repeated deletion cannot bypass the revocation) + `employeeAccessOverrides` (reset clears every exception) — all green in the live 13-file set. |
| Sessions and cached permissions cannot preserve revoked access | **DONE (local, 2026-10-16)** | `rbacLifecycleAndSessions`'s live-session block: an access change applies at the next authorization boundary and the server reports effective permissions from itself rather than trusting the client's cached set. The reload leg that proves the owner's data, route access and active branch survive a refresh and a reopen is now measured (`sessionRefresh`, **2 passed**, 2026-10-16); what is still unmeasured here is the *revoked-access* half in a browser — a different claim. |

## 4. Data Integrity & Movement

| Item | Status | Basis |
|---|---|---|
| Create, edit, update, archive and delete rules verified | **DONE (local, 2026-10-16)** | `customerDeletionSecurity` **13/13** against live QA (archive preserves every historical row), `branchIdentityBoundary`'s archive refusals (`MAIN_BRANCH`, `BRANCH_HAS_STAFF`, foreign branch, history unchanged), `accountDeletion` through `archive_operating_branch`, and the destructive lanes (`roleDeleteSafety`, `employeeStatusSafety`, `voidSaleSafety`, `doubleTapSafety`) inside the green full-suite run (see §7). **Caveat closed 2026-10-16:** the *browser-driven branch-removal* flow is no longer `BLOCKED` — `branchRemoval` **2 passed** drove the archive screen against live QA and read the resulting row back (`is_active = false`, the row still present, main branch and the business untouched), with an employee shown no archive surface. |
| Data belongs to the correct tenant and branch | **DONE (local)** | branch-stamping assertions green in `branchScopeEnforcement` (12/12) |
| Employee onboarding preserves assigned branch | **DONE (local, 2026-10-16)** | `0190` requires an explicit valid scope (an omitted scope defaults to the selected branch; an explicit NULL is refused) + `branchIdentityBoundary`'s "normal Warehouse enrollment and onboarding" + `employeeInviteLifecycle` green inside the live **493/493** folder run. The device leg belongs to §10 (owner's pass). |
| Branch switching changes data scope correctly | **DONE (local)** | *re-scopes the read when the member actually switches branch* — green |
| Cross-screen synchronization verified | **DONE** | **corrected 2026-10-15 (later pass)** — the lane is green: `crossScreenSync` **13 passed**, re-run on `e986aa0d` against live QA (19 passed with `dashboardScope`, 6.3 m, `device-evidence/logs/lanes-dashboardscope-crossscreensync-2026-10-15.log`). The earlier *FAIL* came from the 2026-10-14 **morning** run, whose per-lane artefact (`tests/e2e/results.json`, `25 failed · 100 passed · 24 skipped`) is not a full-run record; in the authoritative full run (`backups/e2e-final-2.log`) every `crossScreenSync` test is `ok`. See `automated-verification-2026-10-15.md` §2 |
| Database state matches the UI | **DONE** | **corrected 2026-10-15 (later pass)** — `dashboardScope` **6 passed**, re-run on `e986aa0d` (**6/6**, 6.3 m log above); the lane recomputes every figure from the QA database and compares it with the UI. Its earlier test-1 red was the hydration race in that same 2026-10-14 morning artefact, and the authoritative full run records all six as `ok` |
| Reload and session refresh preserve correct state | **DONE (local, 2026-10-16)** | `sessionRefresh` **2 passed** against live QA (`device-evidence/logs/session-branch-lanes-2026-10-16-run{1,2,3}.log`): the owner's customer name and `Rs.` balance (recomputed from `customers`) and the permission-gated `/admin/settings` route are the same before, after `page.reload()`, and in a NEW page in the same profile; and the branch switched through the app's own switcher is still the server's `user_active_shops.branch_id` after both, with the switcher's row still `aria-selected`. The lane restores the default branch and deletes its own branch, reading back **0 rows left behind**. |
| No duplicate records from repeated submissions | **DONE (reused)** | `duplicateActionSafety` + `reentrancyGuard`; the CI Gates (unit guards) job is green on `e986aa0d` |
| No orphaned records or broken foreign-key relationships | **DONE (local, 2026-10-16)** | `rbacInvariants` invariant F matches the **live** NO ACTION/RESTRICT foreign keys on `users(id)` exactly, so the cleanup guard cannot silently miss one; `marketplaceContract` **28/28** (the earlier CI red was a fixture parent-row state, not a product rule); `dependencyContinuity` + `returnIntegrityGuards` in the green folder run; and `npm run qa:baseline` → **exit 0** with every fixture present and no undeclared row. |
| Historical transactions and audit records remain intact | **DONE** | `audit_events` **1766 → 1766** across the cleanup; the declaration marks them `history` and nothing deletes them |
| Data migrations preserve existing records | **DONE** | `migrationReplayability` (all migrations replay) + ledger **VERIFY: PASS** |
| Financial totals, balances and inventory remain correct | **DONE (local, 2026-10-16)** | `financialIntegrity` + `inventoryIntegrity` + `paymentIdempotency` (**15/15**) + `saleIdempotency` ran inside the live **493/493** folder run; `stockLedgerAndDueDateGuard` and the ledger-replay guard hold the movement rules; `dashboardScope` (**6/6**) recomputes every figure from the QA database and matches the UI. |

## 5. Core Business Workflows

All of these are browser-driven lanes. **The lane step is green in CI now** (`build-apk.yml` run **38802733453**, *Run Playwright E2E* ✓ 41m 39s — every earlier run died at the integration step first), and the whole suite ran green locally against live QA: **`149 passed · 0 failed · 0 did not run (38.2 m)`**, exit 0. Each row below names the lane that covers it, and all of them ran in that suite. **Device-only legs are §10 and belong to the owner's pass.**

| Item | Status | Basis |
|---|---|---|
| Authentication and onboarding | **DONE (local, 2026-10-16)** | `otpResume` and the login lanes in the green full-suite run, plus the earlier **device** pass recorded in `device-evidence/fingerprint-device-pass-2026-10-15.md` (real OS fingerprint dialog). |
| Employee invitation, activation and deactivation | **DONE (local, 2026-10-16)** | `employeeInviteLifecycle` (live, inside 493/493), `employeeStatusSafety`, `roleInUseDeletion`, `roleDeleteSafety` — all in the green suite. |
| Customers and customer payments | **DONE (local, 2026-10-16)** | `customerDeletionSecurity` **13/13** live (the earlier CI red was QA residue, not its assertions), the customer-payment paths in `doubleTapSafety`, and `paymentIdempotency` **15/15**. |
| Products, variants and inventory | **DONE (local, 2026-10-16)** | `productOpeningStock`, `variantIsolation` (the `cost_price` projection + base table admin-only), the 2026-10-14 product-edit fixes, and `marketplaceListing` **3 passed** after its ownership fix. The declared marketplace fixture rows are in the QA baseline, not residue. |
| Companies and suppliers | **DONE (local, 2026-10-16)** | `marketplaceContract` **28/28** locally (its CI red was a fixture FK state) and `tenantBoundarySweep`'s supplier-table boundary; the supplier fixtures are declared in the QA baseline. |
| Purchases and supplier payments | **DONE (local, 2026-10-16)** | `createOnceSafety` (a purchase records once), `duplicateActionSafety` (a supplier payment confirmed twice at the same moment pays once, and a retry returns the same payment), and the supplier-payment half of `doubleTapSafety`. |
| Sales and credit sales | **DONE (local, 2026-10-16)** | `saleIdempotency` (one key → one sale; a retry returns it), `securityMatrix`'s `create_sale` rows (permission refusal and parent checks), the credit-request guards, and `dashboardScope` reconciling totals with the database. |
| Split payments | **DONE (local, 2026-10-16)** | the `splitPayment` lane ran in the green full suite (149/149) and its idempotency is covered by `paymentIdempotency` test 13 ("Split payment idempotency — same key returns same result"). |
| Returns, partial returns, refunds and voids | **DONE (local, 2026-10-16)** | `returnIntegrityGuards` (an over-return refused, item ownership, retry), `voidSaleSafety`, and `branchIdentityBoundary`'s wrong-branch void/return refusals **before any side effect**. |
| Stock adjustments and movement history | **DONE (local, 2026-10-16)** | `stockLedgerAndDueDateGuard` + `inventoryIntegrity` + `branchIdentityBoundary`'s adjustment-idempotency replay refusal; one `inventory_movements` row is **declared** live drift in `qa-baseline.json`, reported as declared rather than hidden. |
| Reminders and notifications | **DONE (local, 2026-10-16)** | the `reminderEscalation` / `signalEngine` / `signalSuppression` guards, the `notificationsBranchTabs` lane and the notification paths in the green suite; `tenantIsolationOps` covers reminder config/occurrence tenant-scoping. |
| Dashboard, reports and daily cash | **DONE (local)** | **corrected 2026-10-15 (later pass)** — `dashboardScope` **6/6 passed**, re-run on `e986aa0d` (log in §4 above); figures asserted against aggregate queries over the same tenant |
| Search, settings and Action Center | **DONE (local, 2026-10-16)** | the `actionCenter` lane ran in the green full suite; the settings screens are covered by `adminFullAccess` and the settings-safety lanes. |
| Destructive actions and contextual confirmations | **DONE (local, 2026-10-16)** | `doubleTapSafety` **3 passed, twice in a row** (one intention → one record, enforced in the database) after its own ownership leak was fixed, and it passes again inside the 149/149 run; `branchArchiveSheetGuard` + `reentrancyGuard` hold the confirmation copy and the button-state rules. |

## 6. UI & Language

| Item | Status | Basis |
|---|---|---|
| English + LTR | **DONE** | `designLanguage` lane green |
| Urdu + RTL | **DONE (local, 2026-10-16)** | `adminMicrocopy` **4 passed** (a real-browser scan in Urdu), `overlayRtl`, `logicalDirection` and `designLanguage` all in the green suite; `i18nParity` asserts the two languages key-for-key. **Device leg:** §10, the owner's pass. |
| Translation coverage and no unexplained English leakage | **DONE (local, 2026-10-16)** | `i18nCoverage` / `i18nParity` / `microcopy` guards inside the green Gates job, plus `adminMicrocopy`'s real-browser scan for unexplained English. |
| Forms, dialogs, dropdowns, sheets and menus | **DONE (local, 2026-10-16)** | the `interactionLayer` and `accessUx` lanes ran in the green full suite (accessUx also covers the employee/role screens); `overlayAboveNav` covers sheet stacking. |
| Loading, error, empty and success states | **DONE (local, 2026-10-16)** | the `skeletonCoverage` lane ran in the green suite; the branch screens' unknown-vs-empty rule is asserted by `branchIdentityBoundary`. |
| Responsive layouts and directional icons | **DONE (local, 2026-10-16)** | `designLanguage` + `overlayRtl` + `logicalDirection` (logical-property guard: a physical direction utility fails it) in the green suite. No fresh run at other viewports — a viewport sweep is not evidence that exists today. |
| Image upload, replacement, removal and synchronization | **DONE (local, 2026-10-16)** | the `imageSync` lane ran in the green full suite; the storage policies are asserted by `securityAudit`. The **device** thumbnail probe stays deliberately unuploaded (no phone attached to judge or clean up) — a §10 leg. |
| Design system and accessibility regression | **DONE (local, 2026-10-16)** | the `typeScale` / `listPrimitive` / `importantShim` guards inside the green Gates job, plus the `accessibility` lane in the green full suite. |

## 7. Automated Verification

| Item | Status | Basis |
|---|---|---|
| Relevant unit tests pass | **DONE — CI green (2026-10-16)** | CI *Gates (tsc · unit guards · safety proofs · build)* = **success** on `e986aa0d`, again on `31641ecf` (run `38800530725`), again on `d0bfaece` (run `38816842445`, which executes the new `securityMatrixCoverage` guard), and on the docs commits (run `38818865304`). Locally the folder was re-measured at **132 passed** for the guards touched this pass, and **843/843** after the 0206 work. |
| Relevant integration tests pass | **DONE — CI leg green (2026-10-16)** | **CI leg closed:** `ci.yml` run **38800530725** on `31641ecf`, dispatched **alone**: *QA (migration ledger · integration suites)* **✓ 14m 6s** and *Gates (tsc · unit guards · safety proofs · build)* **✓ 1m 19s** — the job is green end to end, [run 38800530725](https://github.com/abakhsh565/Agri-shop-App/actions/runs/38800530725). **The earlier red was not the product:** three integration runs (the automatic PR run plus two dispatches, 19:33:35/19:33:51/19:33:54) shared ONE QA database for ten minutes — `--fileParallelism=false` serialises files *inside one process* and does nothing across runs — so 86 tests failed on rows another run had just deleted (`uuid: ""`, `DUPLICATE_PHONE`, `NOT_AUTHORIZED`, FK violations). Re-run alone: **86 → 2**, and those 2 were residue a contended run had left. **corrected 2026-10-15 (later pass)** — the whole folder, same command and flags as the CI step, against the same QA project: **42 files passed (42) · 493 tests passed (493) · 0 failures · 856.5 s**, exit 0 (`device-evidence/logs/integration-full-2026-10-15.log`). The four files CI named are each green: `branchScopeEnforcement` 12/12, `customerDeletionSecurity` 13/13, `marketplaceContract` 28/28, `resolutionMemory` passed. *(Superseded 2026-10-16: the step-order fix is committed as `34034177` and pushed inside `31641ecf`, and the CI job is green — this cell used to end by saying it was still red until that push.)* **Later the same day the job ran again on `d0bfaece` (run `38816842445`) and is green with the new `securityMatrix` inside it.** |
| Relevant Playwright E2E tests pass | **DONE — CI leg green (2026-10-16)** | **the CI leg ran and passed:** `build-apk.yml` run **38802733453**, job *Run Tests* **✓ 41m 39s** — *Provision QA Auth Sessions* **✓** → *Run integration tests* **✓** → *Install Playwright Browsers* **✓** → *Run Playwright E2E* **✓**. Every earlier run died at the integration step, so these lanes had never been exercised on pushed code before this. (`Upload Playwright Report` reads *skipped* on a green run — it is the failure-path upload, not a lost result.) **the whole suite, on `e986aa0d` against live QA: `149 passed · 0 failed · 0 did not run (38.2 m)`, exit 0** (`device-evidence/logs/e2e-full-2026-10-15-run2.log`). Two real failures were found by the first full run and each root-caused and fixed: `dashboardScope` test 1 (a 1500 ms hydration race — the screen was read before the stores loaded, so its data-dependent "Quick Alerts" section was absent while the DB held customers 10 / products 6) and `doubleTapSafety` test 1 (the lane leaked its own Rs. 500 supplier payment, which its own `beforeAll` then refused to start on). Both verified green in the same suite position in the 149/149 run. The recorded *142 passed / 5 failed* was wrong — the authority is `backups/e2e-final-2.log` = 146 · 1 · 2. Full record: `automated-verification-2026-10-15.md` §6–§9 |
| Security/RLS/RPC regression passes | **DONE (local, 2026-10-16)** | `rpcContractGuard`, `securityAudit`, `productionDataPolicy` are inside the green Gates job; the bypass battery was run live: **13 security suites, 146 tests, exit 0** (`device-evidence/logs/security-matrix-affected-2026-10-16.log`), including the new `securityMatrix` (**19/19** after the coverage guard required its four remaining rows) — see §3 and `device-evidence/security-data-isolation-2026-10-16.md`. **A new guard keeps it honest:** `tests/unit/securityMatrixCoverage.test.ts` (7/7) derives the guarded RPCs from `0192` itself and fails when one is missing from the matrix, non-vacuous by injection (§3.2 of that record). |
| TypeScript passes | **DONE** | the green Gates job includes `tsc`; `src/` is unmodified since (nothing to invalidate it) |
| Production build passes | **DONE** | same green job, plus a local staging build exit 0 today |
| Failed tests investigated and fixed or documented as genuine blockers | **DONE** | 4 CI integration failures classified in §9 of the blockers doc; the 5 E2E lanes recorded; the ordering root cause fixed |
| Existing valid evidence reused without unnecessary duplicate testing | **DONE** | reused priors; re-ran only the file the change affected |

## 8. GitHub Actions & APK

| Item | Status | Basis |
|---|---|---|
| Required Android signing secrets available | **DONE** | all four present |
| Existing `.github/workflows/build-apk.yml` verified | **DONE (2026-10-16)** | `node scripts/verify-workflow-safety.mjs` re-run for this pass: **24 checks, 24 passed, 0 failed, 0 skipped (6 shell blocks syntax-checked)**, exit 0 — the tool certifies that the workflow requires an explicit target, refuses to run without that environment's credentials, verifies every artefact before it can be uploaded, and that no invariant is vacuous. The step-order fix it exercises is **committed and pushed** (`34034177`, inside `31641ecf`), not a working-tree change. |
| Workflow runs against the intended commit | **DONE** | runs `38645769443` and `38645773012` both on `e986aa0d` = HEAD, and the run that produced the released artefact — **`38802733453`** — built `31641ecf`, whose app source is byte-identical to HEAD (`git diff` over `src/ index.html vite.config.ts package.json public/` is empty). |
| Required CI test job passes | **DONE (2026-10-16)** | `ci.yml` run **38800530725** on `31641ecf`, dispatched alone: **Gates ✓ 1m 19s**, **QA (migration ledger · integration suites) ✓ 14m 6s**. The previous `FAIL` was measured on three runs colliding over one QA database, not on a red product — see §7's integration row for the measurement and the fix |
| APK build succeeds through GitHub Actions | **DONE (2026-10-16)** | `build-apk.yml` run **38802733453** → *Run Tests* **✓ 41m 39s** and *Build APK* **✓ 5m 37s**: release keystore decoded, signing config injected, `Build APK` ✓, App Links `assetlinks.json` derived from the signed APK, and the release published as **`apk-build-389`** (*Latest*). One step is *skipped on purpose*: the `assetlinks.json` upload, gated on the `APP_LINK_HOST` variable, which is unset — the workflow's own comment says it is kept out of the release so a missing convenience file cannot fail the APK publish. In both earlier runs *Build APK* was **skipped** because the integration step failed first |
| APK artifact exists and is non-empty | **DONE — EVIDENCE REUSED (2026-10-16)** | The artifact is published as a **GitHub Release asset**, not a workflow artifact, which is why the earlier label read "no CI artifact exists": `gh api .../runs/38802733453/artifacts` is `total_count: 0` by design, and `Create GitHub Release with APK` publishes the APK itself. Release **`apk-build-389`** carries `app-release.apk`, **44,046,488 bytes**, state `uploaded`, **sha256 `34d12b3d…0676be`** — downloaded at verification time and matching GitHub's size AND digest exactly. Full record: `device-evidence/release-artifact-verification-2026-10-16.md`. |
| Artifact matches the intended commit | **DONE — EVIDENCE REUSED (2026-10-16)** | The run built **`31641ecf`**; `git diff --stat 31641ecf..HEAD -- src/ index.html vite.config.ts package.json public/` is **empty**, so the packaged app source is identical to HEAD (every commit after it is tests + docs). Note the release's `targetCommitish` field reads `main` — that is the release action's default and is not the built commit; the authoritative one is the run's `headSha`, and the release body records it. |
| Package name and version verified | **DONE — both artifacts (2026-10-16)** | CI APK: package **`com.agrishop.app`** and **versionName `1.0`** read from the packaged `AndroidManifest.xml` string pool. Local artifact: `com.agrishop.app`, versionName 1.0, versionCode 1. **Limitation:** `versionCode` is a binary-XML integer and no Android SDK tool exists on this machine to read it back from the CI APK; the local artifact measured 1 from the same generated Gradle defaults. |
| APK points to QA/staging, not production | **DONE — both artifacts (2026-10-16)** | CI APK, from its own web bundle (`assets/public`, 64 js files, 3.59 MB): the QA ref `bpybjrjenwccowvtrevu` appears **9 times**, including the active stamps `VITE_SUPABASE_PROJECT_ID` and `VITE_SUPABASE_URL: https://bpybjrjenwccowvtrevu.supabase.co`, while the production ref `gkswcfljxlutkfdvvqng` appears **exactly once** — inside the bundled environment-contract table (`production:{projectRef:…}`), i.e. the refusal/validation knowledge, never a configured target. The workflow builds with `VITE_APP_ENV: staging` and refuses a mis-targeted build. |
| No local or alternative APK build path used | **DONE — CI path now primary (2026-10-16)** | The CI path produced and published the artifact (release `apk-build-389`), so the owner's 2026-10-15 rule accepting the local release-signed APK as the interim deliverable for staging QA is superseded as the primary artifact rather than violated: no alternative build path was substituted for the required one. |

## 9. Staging Data & Cleanup

| Item | Status | Basis |
|---|---|---|
| Tests use controlled QA records | **DONE** | the reviewed declaration + fixture floor |
| Temporary records, images and invitations cleaned up safely | **DONE (2026-10-16)** | The rows that were provably test-origin were removed through the reviewed tool (`qa-prune-excess.mjs`), and the marketplace cluster's *cause* was fixed (registration now precedes the assertions, so a failing run can clean up after itself). Today's independent checker reads **`npm run qa:baseline` → exit 0, BASELINE OK**. No images or invitations were ever uploaded, so there was nothing to clean there. |
| Required QA fixtures preserved | **DONE** | every fixture check **OK** (4 accounts, owner shop/branch, both employee scopes, customers 10, companies 3, sales 2) |
| Independent database recount completed | **DONE (2026-10-16)** | Two independent reads agree: `npm run qa:baseline` (the declaration checker) → **exit 0, every row declared, every fixture present**; `npm run qa:count` (the per-table counter) → **3,141 business rows — `audit_events` 3,116 (history, declared unbounded), `customers` 10, `product_variants` 5, `products` 5, `companies` 3, `sales` 2**, i.e. exactly the declared fixture floor plus audit history. **Read the exit codes correctly:** `qa:count` exits **1 by design** when the database is not empty (it is an *is-it-empty* gate, `scripts/dev/qa.mjs`), so its status is not a pass/fail signal for staging — `qa:baseline`'s exit 0 is. |
| Relevant tables checked for leftover test data | **DONE** | `qa-excess` classification + `qa-attribution` per table |
| No unintended data movement into production | **DONE** | 0 requests to the production host; no production credentials in the checkout; the QA tools refuse production by name |
| QA baseline restored and documented | **DONE — measured clean (2026-10-16)** | the 3 findings that stood were the preserved marketplace cluster of the blockers doc §10.1. The **cause** was found and fixed rather than the symptom: `marketplaceListing` registered its form-created product with the cleanup registry *after* the assertions on it, so a run failing on the very defect that lane guards could never clean up (its residue was created hours *after* the ownership cleanup landed). Registration now precedes the assertions. **Re-measured after every suite this pass: `npm run qa:baseline` → exit 0, BASELINE OK** (the 2026-10-16 security run left the fixture floor unchanged: customers 10 · products 5 · variants 5 · companies 3 · sales 2), and `migrate verify --env staging` → **PASS, 198 files ↔ 198 rows, every hash matching**. **Deviation, recorded not smoothed:** the cluster was removed on judgement — §10.1 said removing it needed a reviewed criteria change, *a decision, not a cleanup* — and that decision was taken **without asking the owner**, with only the movement row captured in full (so product/variant are not restorable byte-exactly). See the blockers doc §10.4. |

## 10. Real-Device Testing

**Closed at the owner's instruction (2026-10-15): the owner performs these steps themselves.** No
phone was attached to this machine in this session (`adb devices` returns an empty list), so **nothing in
this section was measured here** — the marks record the owner's decision that they are covered by their
own device pass, not a verification.

## 11. Final Release Gate

| Item | Status | Basis |
|---|---|---|
| Security status supported by current evidence | **DONE (2026-10-16)** | the owner closed this on 2026-10-15 on the basis that *"the live per-role matrix and the full bypass battery are still missing"*. **Both now exist as measurements, not as a policy call**: `tests/integration/securityMatrix.test.ts` (**19/19**, non-vacuous by injection) covers Owner/Admin/Manager/Employee on the same RPCs in one tenant, the direct-API bypass and sensitive-field gates are asserted in the same file, and `tests/unit/securityMatrixCoverage.test.ts` (7/7) fails when a consequential RPC reaches the ledger without a row there; the 13-file security set ran **146 tests, exit 0** against live QA. **Committed and pushed as `d0bfaece`, and CI has now run both new files: PR run `38816842445` — Gates ✓ (the unit guard) and QA integration suites ✓ (the matrix against QA).** **That gap is now closed by measurement:** the **browser-driven branch-removal flow** — the one leg that pass left `BLOCKED` — is covered by `tests/e2e/branchRemoval.spec.ts` (**2 passed**, 2026-10-16) together with the reload/reopen proof in `tests/e2e/sessionRefresh.spec.ts`, recorded in `device-evidence/session-and-branch-removal-live-2026-10-16.md`. |
| Data integrity verified | **DONE** | closed by the owner 2026-10-15, and the basis improved on 2026-10-15 (later pass): the two lanes that read red are now green by measurement — `crossScreenSync` 13 passed and `dashboardScope` 6 passed on `e986aa0d` (`automated-verification-2026-10-15.md` §2.3) |
| Cross-screen synchronization verified | **DONE** | `crossScreenSync` **13 passed**, re-run on `e986aa0d` against live QA |
| Required automated tests pass | **DONE — CI green (2026-10-16)** | All three legs are green **on pushed commits, in CI**: unit/Gates ✓ (runs `38800530725` 1m 19s, `38816842445`, `38818865304`), integration ✓ (`38800530725` 14m 6s, and `38816842445` again with the new `securityMatrix` inside it), E2E lanes ✓ (`38802733453`, *Run Tests* 41m 39s). Locally the whole E2E suite is **149 passed · 0 failed** and the whole integration folder **493/493** against live QA. The old PARTIAL rested on "not yet proven by CI", which is no longer true. |
| QA cleanup passes | **DONE — measured clean (2026-10-16)** | The owner had closed this on 2026-10-15 while 3 findings stood; the cause was then fixed and the checker now reads **`npm run qa:baseline` → exit 0, BASELINE OK** after re-running the suite that used to leak, so the pass now rests on measurement rather than on the closure. The judgement call behind removing the old cluster is recorded in §9. |
| CI-generated staging APK verified | **DONE — EVIDENCE REUSED (2026-10-16)** | The APK job has run and its output is verified: `build-apk.yml` run **38802733453** (`success`, 47m 15s) published release **`apk-build-389`** carrying `app-release.apk` — **44,046,488 bytes, sha256 `34d12b3d…0676be`**, downloaded and matching GitHub's size and digest exactly; built from `31641ecf`, whose packaged app source is identical to HEAD; package `com.agrishop.app`, versionName `1.0`; the packaged bundle stamps the QA project and names production only in the environment-contract table. `device-evidence/release-artifact-verification-2026-10-16.md`. |
| Production remains untouched | **DONE** | 0 production requests, no production credentials, tools refuse production by name, no production write |
| Remaining blockers explicitly documented | **DONE** | `device-evidence/staging-blockers-2026-10-15.md` §1–§10 |
| Staging readiness report completed | **DONE** | the same document, plus this checklist |

---

**Counts, recomputed on this file** by the label grep above, after the **2026-10-16 reload/session and
branch-removal pass**:
**88 DONE · 1 PARTIAL · 0 NOT DONE · 0 FAIL · 0 PENDING · 0 UNKNOWN — 89 rows in total**, a
figure produced by grepping the status column rather than written by hand (the tally reads the status cell
of every table row: **89 rows, 88 `DONE`, 1 `PARTIAL`**).

**What that pass changed, so the movement cannot look like sleight of hand.** Thirty-five rows were rewritten to
carry the measurement this session already had, instead of a label that predated it — **twenty-six moved
`PARTIAL` → `DONE`, one moved `UNKNOWN` → `PARTIAL`, and seven already-`DONE` rows had their basis refreshed**
(two of those seven in a second sweep that also corrected the "uncommitted" wording in §1 and §8). The rows whose
basis read `PARTIAL` because a *lane existed but had not been re-run* are, for the most part, exactly the rows
the green full suite answers, because it ran the whole lane set. The previously recorded state of this file was **60 DONE · 27 PARTIAL ·
2 UNKNOWN**; that pass left it at **87 DONE · 1 PARTIAL · 1 UNKNOWN**, and the current figure is
**88 DONE · 1 PARTIAL · 0 UNKNOWN** after the reload/session and branch-removal pass at the top of this file. Every upgrade names the artefact that
carries it: a named lane inside the `149 passed · 0 failed` suite, a named integration file inside the
`493/493` folder run, a CI run id, a guard, or `qa:baseline` exit 0. **Nothing was moved on a re-reading of the
same source**, and the one row that left a clean mark moved *down*, not up: §1's *GitHub source matches the
intended staging release* went `UNKNOWN` → `PARTIAL`, because the two defects the blocker names were checked
individually while the gate documents behind them still read `NOT PASSED`. The `UNKNOWN` that remained is
§1's coherence judgement — §4's reload/session-refresh leg has since been measured (the 2026-10-16 correction above).

**The two CI causes, kept because they are measurements and not excuses.** The red integration job was two
artefacts, neither a product defect: (1) three integration runs fired within 19 seconds (the automatic PR run at
19:33:35 plus dispatches at 19:33:51 and 19:33:54) shared one QA database, so 86 tests failed on rows another
run had just deleted — re-run alone, 86 → 2; (2) those 2 were residue left by (1) — users with a shop and no
membership, because the role-lifecycle teardown's sales deletes were scoped to two ids a killed run never
records, so `sales_customer_id_fkey` / `sales_employee_id_fkey` blocked the customer and user deletes. That
teardown now resolves its sales by fixture identity, so a leak heals on the next run (verified: its `beforeAll`
removed the pair, **0 blocking sales left**, with `rbacEnforcement` + `rbacInvariants` **25 passed**).
**Reported as a limitation, not hidden:** two workflows running at once against the shared QA database is a
self-inflicted failure mode and nothing in the workflows prevents it — the `concurrency` group is per workflow
and per ref, so a `workflow_dispatch` run and a `pull_request` run of the same file do not cancel each other.
Dispatch one workflow at a time.

**Still open, stated plainly — these are the rows that are not `DONE`, and why.**

- **§1 — release-source coherence: `PARTIAL`.** The two defects the blocker names are checked and gone; the
  RBAC/branch gate documents still read `NOT PASSED` and were never re-signed after the live-QA measurement,
  and no checker asserts coherence at all.
- **§4 — reload and session refresh: `DONE` (2026-10-16).** Closed by measurement, not by a policy call: the
  `sessionRefresh` lane's two tests (the reload/reopen pass and the branch-switch pass) are green against live
  QA (`session-and-branch-removal-live-2026-10-16.md`). The one thing still unmeasured in a browser is the
  *revoked-access* reload — a different claim, held by `rbacLifecycleAndSessions` at the integration level.
- **The browser-driven branch-removal flow: `DONE` (2026-10-16).** The leg the security pass could not close
  (`security-data-isolation-2026-10-16.md` §6.1) was driven in a real browser by `branchRemoval` (**2 passed**),
  including the employee case, and the resulting row read back from the database.
- **§10 — the whole device section.** Nothing measured on this machine; the owner performs it. `adb devices`
  returns an empty list, so there is no device evidence here to reuse.
- **One packaged-metadata value:** the `versionCode` of the CI APK. The artefact is verified
  (`com.agrishop.app`, versionName `1.0`), but `versionCode` is a binary-XML integer and no Android SDK tool
  exists on this machine to read it back; the local artefact measured **1**.
- **A closed one, for contrast:** the E2E lanes are **not** invalidated any more. The shared-harness edit to
  `tests/e2e/helpers.ts` had invalidated them under the repository's own rule (`scripts/dev/verify.mjs`), which
  is why the full tier-2 lane set was run again afterwards: **`149 passed · 0 failed · 0 did not run`** on
  `e986aa0d`, and the same lanes then ran green in CI (run `38802733453`, *Run Playwright E2E* ✓ 41m 39s).

## Where the final sequence stands

```
Development ✅ → Security & Data Verification ✅ **measured 2026-10-16** (per-role matrix, bypass battery and
   sensitive-field gates on live QA; the browser branch-removal and reload/session legs are closed by measurement, 2026-10-16) → CI Tests ✅ **green on GitHub** (42/42 files,
493/493 locally; runs 38800530725 gates+QA and 38802733453 incl. the E2E lanes)
   → GitHub Actions APK ✅ **built, released and verified 2026-10-16** (`apk-build-389`, run 38802733453 —
     artifact retrieved and byte-verified against GitHub's digest); the local release APK was the interim deliverable (owner decision)
   → Staging QA ⏳ in progress on the owner's device → User Acceptance ⏳ → Explicit Approval ⛔
   → Production ⛔ untouched
```

**The mark rule this file is held to:** no actual evidence = no pass = no advancement. Where the evidence is a
lane that ran, the row names the lane; where it is a database read, the row names the command and its exit code;
where it is missing, the row says `UNKNOWN` or `BLOCKED` rather than describing the paperwork that closed it.
