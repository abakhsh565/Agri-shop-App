# Browser E2E unblocked, duplicate-sale protection verified end-to-end

**Date:** 2026-10-01 · **Verdict:** browser E2E `UNKNOWN` resolved — the suite runs in real Chrome
against QA, and the sale double-click is proven at both layers. Four failures in the run were
triaged to other threads' in-flight UI/copy work with evidence (§5); none is a protection regression.

---

## 1. Exact tasks

1. Resolve the browser E2E `UNKNOWN` using the existing tooling, without new dependencies.
2. Target the areas affected by recent work: auth/session, RBAC, sale creation, duplicate-click,
   payment/split payment, destructive actions, EN/LTR, UR/RTL.
3. Verify duplicate-sale protection end-to-end: UI guard, RPC idempotency, exactly one sale row,
   stock/inventory once, customer balance once, reload shows one, retry after a lost answer safe.
4. Restore the QA baseline afterwards and check nothing was orphaned.

## 2. Why the browser lane was UNKNOWN, and what unblocked it

Two independent blockers, both real:

1. **No browser was installed.** `~/AppData/Local/ms-playwright` was empty. Installed Chromium with
   `npx playwright install chromium` (`chromium-1243`, `INSTALLATION_COMPLETE`). Only the optional
   FFmpeg download timed out (video recording only; no test needs it). The lane itself uses the
   **system Chrome** (`playwright.config.ts` → `channel: 'chrome'`), which is installed.
2. **The Playwright config/test graph could not load at all.** Playwright (and Vite when spawned as
   its webServer) failed with:
   `TypeError: Module ".../environments.json" needs an import attribute of "type: json"`.
   Root cause: on Node 22+/24, a native ESM JSON import must be written
   `import x from "…" with { type: "json" }`; the in-flight environment-contract refactor
   (`src/lib/environmentContract.ts`, untracked) imported it without the attribute, and the
   test/CI guard chain now reaches that file through `tests/setup/env-guard.ts`. Playwright reported
   it as **"No tests found"**, which is why the lane had looked like a tooling absence rather than a
   one-line module error.
   **Fix applied:** added the import attribute (one line) in `src/lib/environmentContract.ts`.
   `tsc` 0, unit lane 854/854, `npm run build` exit 0 afterwards. *This file belongs to another
   thread's active work; the edit is additive and is called out here and in §6.*

The QA dev server was started as `npx vite --mode qa --port 5173` (HTTP 200) and reused via
`reuseExistingServer: true`. Commands and logs: `backups/e2e-*.log`.

## 3. Duplicate-sale verification — the reported failure, reproduced and pinned

The owner's report ("double-click confirm → created twice but it is only one sale") already had
protections in the codebase; what was missing was **evidence that exercises them**. Two layers were
verified, and one guard gap and one missing suite were fixed:

| Layer | What was checked | Result |
|---|---|---|
| UI (live screen) | The routed confirm screen is `CartPage` (`sale/cart`), not `SaleReviewPage` (not routed). `CartPage` has `completingRef` (synchronous, blocks the second tap in the same task) and a per-attempt `submissionKeyRef` sent as `idempotencyKey`. | Present; asserted now |
| **Guard gap fixed** | `tests/unit/reentrancyGuard.test.ts` asserted the ref only on the **unrouted** `SaleReviewPage`, so deleting `completingRef` from the live screen would have been invisible. | `CartPage → completingRef` added; guard 3/3 |
| RPC (database is the authority) | `0134_sale_idempotency.sql`: `sale_submissions` keyed `(shop_id, idempotency_key)`, claimed with `INSERT … ON CONFLICT DO NOTHING`; the real implementation renamed `create_sale_unchecked` with EXECUTE revoked. | Verified (§3.1) |
| Browser double click | Real Chrome: cart flow → double-tap "Complete Sale" in one JS task → DB judged. | **PASS** (§3.2) |

### 3.1 New integration suite — `tests/integration/saleIdempotency.test.ts` (4/4)

The migration's closing comment pointed at this filename; it did not exist. Now it does, and it runs
against QA with the real JWT a browser gets:

1. **Two simultaneous confirms, one key** → exactly ONE sale; stock `100 → 98` once; customer
   `total_purchases 0 → 1000` once; the loser is either resolved to the winner's id or refused with
   `DUPLICATE_SUBMISSION` (the deliberate in-flight refusal), never a second sale.
2. **Retry after success** (the lost-answer path) → same sale id, `duplicate: true`, still one sale,
   stock and purchase total unchanged.
3. **No key** → behaves exactly as before (scripts/tests depend on it).
4. **`create_sale_unchecked`** called as an authenticated client → refused
   (`permission denied`): the guard cannot be bypassed by naming the inner function.

Log: `backups/sale-idempotency-integration.log` (+ re-run `backups/sale-idem-recheck.log`).
(The suite initially collided with `tenantIsolationOps.test.ts` on `d1000000-…`; the repo's
`fixtureIdCollision` guard caught it, and the suite now uses its own `d9000000-…` prefix.)

### 3.2 New browser test — `tests/e2e/doubleTapSafety.spec.ts` (3/3)

Added to the existing double-tap spec, using the same one-task double click that a real tap is
(awaiting two Playwright clicks is *not* a double tap — the UI re-renders in between):

- real flow: customer → product → variant → cart → **two clicks on "Complete Sale" in one task**;
- asserted against QA: **exactly one sale row**, one sale line, stock deducted once (`99`),
  customer purchase total raised once (`80500`), and the reloaded sales list shows exactly one row
  for that customer.

Log: `backups/e2e-double-tap-sale.log` (single) and `backups/e2e-batch1.log` (with the payment
double-taps and split payment). **PASS.**

## 4. Browser runs executed (real Chrome, QA database)

| Batch | Specs | Result |
|---|---|---|
| 1 | `doubleTapSafety` (customer payment, supplier payment, **sale**) + `splitPayment` (UI→DB lifecycle + RBAC refusal) | **5/5 PASS** (`backups/e2e-batch1.log`) |
| 2 | `rtlLtr` (16 tests: EN/LTR + UR/RTL, logical spacing, overflow, dialogs) + `accessUx` + `voidSaleSafety` | 16 PASS, 2 FAIL, 6 skipped (serial) — triaged in §5 |
| 3 | `otpResume` (auth/session resume) + `adminFullAccess` (admin RBAC + deletion gate) | 4 PASS, 2 FAIL — triaged in §5 |

The destructive-action *database* proofs were run separately and are green 7/7:
`tests/integration/duplicateActionSafety.test.ts` — double supplier payment pays once, double void
voids once and restores stock once, double stock adjustment adjusts once, retries return the
original (`backups/dup-action-safety.log`).

## 5. Failures found and triaged (with proof, not assumption)

All four browser failures are **committed tests asserting UI that another thread is actively
changing** — proven by the file states and the captured page snapshots:

1. `accessUx` "Adding an employee … no RBAC jargon" — the page no longer renders the
   "Access from this role" panel; the captured snapshot shows the new role-description screen.
   `src/pages/admin/employees/AddEmployeePage.tsx` is **modified in the working tree** (another
   thread). Remaining 6 tests skipped because the file is serial. Classification: **test ↔ in-flight
   UI redesign mismatch**, not a protection regression.
2. `voidSaleSafety` "…double-tapping voids once" — the button label moved from `Cancel Sale` to
   **"Delete this sale"** (`admin.voidSale` in `src/lib/i18n.ts`, **modified**), so the selector
   times out before the dialog. The void's double-fire protection itself is proven by integration
   test 4 (§4). Classification: **copy change vs committed test**.
3. `adminFullAccess` (both failures) — the account-deletion gate is now a **4-step wizard**
   ("Step 1 of 4", checkbox, continue) per the Urdu snapshot; the committed test expects the
   immediate typed-name dialog (`data-testid="confirm-typed-name"`). `AdminSettingsPage.tsx` and
   `i18n.ts` are **modified**. Classification: **in-flight redesign vs committed test**.

These need the owning workstreams to update the tests (or restore the tested affordances); I did not
edit their pages, neither did I rewrite their tests to chase a moving UI. They are listed as OPEN in
`PRODUCTION_READINESS_AUDIT.md`.

## 6. QA discipline

After the browser + integration runs, `npm run qa:count` reported **97 business rows**. `npm run
qa:clean` removed 132 rows (including 6 test users) and the independent re-count reported
**0 business rows**, users 4, fixtures intact (`backups/qa-clean-after-browser.log`). No orphaned
sales/payments/products remain; no production database was contacted at any point.

## 7. Regression after these changes

- `npx tsc --noEmit` → 0.
- `npx vitest run` → **78 files / 854 tests pass** (`backups/unit-final-2026-10-01.log`).
- `npm run build` → exit 0.
- `npm run migrate:verify` → PASS (ledger 169↔169).
- Browser: batch 1 5/5; `rtlLtr` 16/16; the four failures triaged in §5.
- Targeted suites: `saleIdempotency` 4/4, `duplicateActionSafety` 7/7, `reentrancyGuard` 3/3,
  `fixtureIdCollision` 1/1.

## 8. Files changed by this workstream

- `tests/integration/saleIdempotency.test.ts` — **new** (the suite 0134 always referenced).
- `tests/e2e/doubleTapSafety.spec.ts` — sale double-click test added; helper generalised.
- `tests/unit/reentrancyGuard.test.ts` — the live confirm screen (`CartPage`) is now guarded too.
- `src/lib/environmentContract.ts` — one-line `with { type: "json" }` import attribute so the
  Playwright config/test graph loads on Node 24. **Another thread's active file — additive change,
  flagged here.**
- `PHASE_2_BROWSER_SAFETY.md` (this report), audit update.

## 9. Remaining uncertainty (stated, not rounded up)

- The two in-flight mismatches (§5) are open until their owning workstreams land; until then those
  specs cannot be green.
- The other lanes (`imageSync`, `dashboardScope`, `actionCenter`, `crossScreenSync`) were **not run
  in this session**; they were green before and are untouched by these changes, but "not run" is
  not "pass".
- Playwright's **own webServer spawn was not re-tested** after the import fix; the runs used a
  manually started `vite --mode qa`. The first spawn failure had the same root cause, so it should
  be fixed — but that is inference, not measurement.
- "Retry after a lost answer" is proven at the RPC layer (integration) and by the UI keeping the key
  across failures; simulating a genuine network timeout in the browser was not attempted.

---

# Phase 2 — the remaining lanes, the four reds, and one real app regression

Phase 2 took the four tests that were red, the lanes that had never been run, and the two
questions this report left open (§9). Everything below is from a run whose log is in `backups/`.
The production database was never contacted; every run is against QA `bpybjrjenwccowvtrevu`
(`[EnvGuard] Environment verified` on every worker).

## 10. The four reds — each one triaged to its real layer

| Red | What it actually was | Layer | Result |
|---|---|---|---|
| `accessUx` 2 (Add Employee) | The invitation hint moved to `auth.invitedToShop` ("You were invited to {shop}") and the role editor became a sheet (`role-modify-{id}` → `emp-access-context`) | test | **PASS** (Run G 7/7) |
| `voidSaleSafety` | The app says **"Delete this sale"** (`admin.voidSale` is in HEAD) and the dialog reads "Sale {n} will be deleted" | test | **PASS** (Run A) |
| `adminFullAccess` deletion ×2 | Deletion became a **4-step wizard** (`DeleteTargetSheet`: `delete-step-1..4`, `delete-understand`, OTP) | test | **PASS** 4/4 (Run A) |
| the 27 `waitForURL` timeouts from batch 6 | **One phone, one door** (an employee's number must be typed on the employee tab) **and a second door requirement that had not been seen before: the employee door now needs the shop code** (`shop-id-input`, migration 0169) | test | **PASS** (see 10.2) |

**The single biggest finding** is the shop code. The employee tab asks two questions — number *and*
shop — and `Send Code` refuses to spend a code until both are answered. Reproduced by hand in a
real browser: the same number that produced a silent no-op produced `/login/otp` as soon as the
shop id was filled. That one fact explained every employee-side `waitForURL` timeout in the suite
(dashboardScope 2 & 4, education 3 & 4, dependencyContinuity, interactionLayer …). `loginViaUi`
now takes the side *and* the shop (`helpers.ts`), and `dashboardScope`'s own login helper does the
same. Employee lanes after the fix:

- `dashboardScope` **6/6** (Run E) — tests 2 and 4 were two of the reds.
- `education` **9/9** (Run G) — including the two employee cases and the first-run welcome.

## 11. One real app regression — found, fixed, and proven

`src/pages/admin/employees/EmployeeDetailPage.tsx` declared `loginFixing`/`loginFixed` **below**
its `if (!emp) return (…)` early return. Any deep link to an employee page therefore crashed with
React's "Rendered more hooks than during the previous render" as soon as the store loaded — the
page worked only when it was reached *with* the employee already in the store. That is why
`overlayRtl` (2 tests) and `employeeStatusSafety` (3 tests) were red. Both hooks now sit with the
other state at the top of the component; the lanes turned green on the next run:

- `overlayRtl` 2/2, `employeeStatusSafety` **3/3** (Run C), `logicalDirection` **3/3**, `productOpeningStock` **PASS**.

Fixing the crash then exposed a **stale fixture uuid** in `accessUx` (`2603007e-…`, a seeding that
no longer exists): the page now rendered its honest "not found" state. The spec resolves the id
from the phone in `beforeAll` (test-layer fix), and test 4 passes.

## 12. Lanes that had never been run — now run

| Lane | Result | Log |
|---|---|---|
| `imageSync` + `actionCenter` | **22/22** (6.1m) | `e2e-runF-lanes.log` |
| `dashboardScope` | 6/6 | `e2e-runE.log` |
| `setupCompletion` | 5/5 | `e2e-runE.log` |
| `dependencyContinuity` | 4/4 | `e2e-runH-dependency.log` |
| `education` | 9/9 | `e2e-runG-education.log` |
| `accessUx` | 7/7 | `e2e-runG-rest.log` |
| `roleDeleteSafety` | PASS | `e2e-runF-rest.log` |
| batch 10 (interactionLayer, crossScreenSync, overlayAboveNav, skeletonCoverage, systemDrive, designLanguage + the above) | 44 passed / 9 failed, **all 9 triaged** | `e2e-batch10.log` |

## 13. The two open questions from §9 — closed

- **Playwright's own webServer spawn was verified**, not inferred: the manual `vite` on 5173 was
  killed, the suite was run with the config's `npx vite --mode qa --port 5173`, and the
  `[WebServer]` boot lines appeared. `navigationTimeout` was raised to 90s for the cold transform
  that spawn pays once.
- **Retry after a lost answer is now proven in a real browser**: `tests/e2e/retryAfterTimeout.spec.ts`
  fails the first `create_sale` RPC with a 504, lets the retry through, and asserts two calls with
  the **same** `idempotencyKey`, exactly **one** sale, one line, one `sale_submissions` row for that
  key, stock 99, `total_purchases` 80500, a receipt showing the database's `sale_number`, and one row
  in the list.

## 14. Harness defects found on the way (hardened, never weakened)

- `dependencyContinuity`'s "empty shop" cleanup deleted `products` before the rows that reference
  them (`inventory_movements`, `stock_adjustments`, `product_barcodes`, line items…). The first
  foreign key threw, the error was swallowed, and the screen kept showing last case's product while
  the assertion blamed the app's empty state. Children now go first, and the empty premise is
  **asserted** (products + variants + companies = 0) instead of assumed. 4/4 after the change.
- `setupCompletion` compared the count chip to one exact string; the card's copy is now
  `"0 / 3 completed"`. The assertion compares the **numbers** (copy-proof) and a missing block
  reports *where* it is missing (`no block @ /login`) rather than "still loading".
- `education`: the shell gates the welcome on the **persisted** `user.firstLoginAt`, so the fixture
  re-states it there as well as in the database; the welcome sheet deliberately has **no third close
  button**, so the test asserts the two exits that do exist; the console assertion now prints the
  failing resource's URL instead of the browser's one-line complaint.
- `roleDeleteSafety` read a sentence that legitimately appears twice (the delete row and the sheet
  body) and failed on strict mode; it reads through the row now.
- `productOpeningStock` and `dependencyContinuity` were pointed at the old single-pack product form;
  both now use the shipped one-card-per-pack contract (`product-pack-size|cost|sell|stock-0`,
  `product-save`).

## 15. Regression gate after all of this

- `npx tsc --noEmit` → 0.
- `npm run build` → see §7 (re-run in this phase; log `backups/final-build.log`).
- `npm run migrate:verify` → PASS (169 files ↔ 169 ledger rows, all hashes match) — this also closes
  the "deleted migration" question: the paths that looked removed are renamed/consolidated files.
- `npx vitest run` → log `backups/final-vitest.log`.
- QA: `npm run qa:count` before cleanup **33 business rows** → `npm run qa:clean` → independent
  re-count after cleanup (log `backups/final-qa-clean.log`); fixtures `923001122334`, `923001234567`,
  `923008888888`, `923009999999`, `923upwvg9d1` remain active.

## 16. Remaining uncertainty (stated, not rounded up)

- The batch-6 `education` console 404 did **not** reproduce once its lane was run clean (9/9, console
  clean). The test now records the failing URL if it ever comes back, so the next occurrence is
  diagnosable instead of mysterious — but "did not reproduce" is not an explanation.
- The whole-app state/safety sweep reuses the accepted evidence for the lanes that were already
  green (`doubleTapSafety`, `splitPayment`, `otpResume`, `reentrancyGuard`, `crossScreenSync` 13/13)
  rather than re-running all of them; a re-run is a rerun, not new evidence.
- No APK was built and no production database was touched in Phase 2.

---

## 17. Whole-app completion gate — the evidence matrix (2026-10-02)

The gate is the matrix, not a feeling. Every requirement area is one of **PASS** (current
evidence), **REUSED** (earlier evidence still valid — no relevant implementation, dependency or
context changed), **FIXED + VERIFIED**, **NOT APPLICABLE**, or **BLOCKED**. Reuse was decided by
dependency, not by habit: `node backups/gap-check.mjs` compares each lane's newest green log
against the newest mtime of every file its `scripts/dev/lane-map.json` globs cover, so a lane is
`REUSE` only when nothing it covers has changed since it was green.

Raw logs: `backups/gate-gap1.log`, `gate-gap2.log`, `gate-chain1.log`, `gate-vitest.log`,
`gate-lanes.log`, `gate-build.log`, plus the lane logs named below.

### Authentication, sessions, recovery

| Requirement | State | Evidence |
|---|---|---|
| One phone, one door; owner vs employee tab refuses the wrong side | REUSED | `loginDoor` + `loginWindow` unit guards; `otpResume` 2/2 (`e2e-batch3.log`); `accessUx` 7/7 (`e2e-runG-rest.log`) |
| The employee door asks for the shop code (0169) | REUSED | `tests/e2e/helpers.ts` `loginViaUi` fills `shop-id-input`; every employee lane passes with it (`gate-gap2.log`, `gate-lanes.log`) |
| OTP screen copy in Urdu (code screen, sent-to-number line) | FIXED + VERIFIED | `adminMicrocopy` 4/4 — the assertion pinned a replaced literal; now reads the shipped `auth.verifyOtp` + `auth.enterCode` pair and asserts English absent (`gate-gap1.log` red → `gate-gap2.log` green) |
| First-run gate: welcome + tour once per device/user | REUSED | `education` 9/9 (`e2e-runG-education.log`), re-run green after the shell change (`gate-gap2.log`) |
| Session resume, PIN, biometric, lock window | REUSED | `localPin`, `biometric`, `authSafetyGuard`, `loginWindow` unit guards; `otpResume`; unchanged implementations |

### Tenant, shop, branch isolation and RBAC

| Requirement | State | Evidence |
|---|---|---|
| `product_variants` scoped to the owning shop (read **and** write, cost included) | FIXED + VERIFIED | `variantIsolation` **8/8**. Before 0178: tenant A read tenant B's variant + `cost_price`, **UPDATEd its `stock_qty` 100→1 and price 700→1**, and INSERTed onto B's product. Migration 0178; baseline PASS; applied to QA; 5 reds → 0 |
| Cost price hidden from employee sessions | FIXED + VERIFIED | 0179 restores the `product_variants_public` projection (absent from both environments since 0015) without `cost_price`, shop-scoped, and narrows the base table to the owning shop's admins. `variantIsolation` asserts: employee reads base table → 0 rows; employee reads projection → 1 row, no `cost_price` column |
| `stock_adjustments` and `cash_reconciliations` scoped to the caller's shop | FIXED + VERIFIED | `tenantBoundarySweep` reproduced both cross-tenant reads (1 row returned each) → migration 0180 → green. 0180 also replaces the branch-scope policy that had no shop predicate |
| `notifications` scoped through `my_shop_ids()` | PASS | `tenantBoundarySweep` control case (unchanged policy, asserted) |
| `user_permissions` cross-tenant grant refused by RLS | PASS | `tenantBoundarySweep` asserts the refusal AND that it is an RLS refusal, not an incidental constraint |
| No table without RLS; no `anon` grant on business tables | PASS | read-only catalog probe (`backups/db-probe.json`): zero tables without RLS, zero anon grants on the 15 business tables probed |
| Roles/permissions model: overrides, denials, admin shell | REUSED | `rbacFoundation`, `rbacEnforcement`, `rbacInvariants`, `employeePermissions`, `employeeAccessOverrides` integration suites (all green in `gate-vitest.log`); `accessUx` 7/7; `roleDeleteSafety` PASS |
| Employee lifecycle: invite → accept → activate/deactivate | REUSED | `employeeInviteLifecycle`, `employeeStatusSafety` 3/3 (`e2e-batch9.log`), `accessUx` 7/7 |
| Branch scope on reads | REUSED | `branchScopeEnforcement`, `branchPlaceRead`, `placeLocation` integration suites; `logicalDirection` 3/3, `overlayRtl` 2/2 |
| Employee deep-link crash (hooks below an early return) | FIXED + VERIFIED | `EmployeeDetailPage` hook order fixed; `overlayRtl` 2/2, `employeeStatusSafety` 3/3, `logicalDirection` 3/3 green after, and again in `gate-gap2.log` |

### Money, sales, returns, inventory

| Requirement | State | Evidence |
|---|---|---|
| Confirm Sale cannot double-submit | REUSED | `doubleTapSafety` 3/3 (`e2e-batch1.log`) + `saleIdempotency`, `duplicateActionSafety`, `createOnceSafety` integration |
| Retry after a timeout does not duplicate a sale | REUSED | `retryAfterTimeout` 1/1, re-run green after the shell change (`gate-gap2.log`): first `create_sale` answered 504, retry reuses the same `idempotencyKey`, DB ends with one sale/one line/one submission, stock 99 |
| Split payment | REUSED | `splitPayment` 2/2 + `splitPayments` integration |
| Return / partial return / void integrity | REUSED | `voidSaleSafety` 1/1; `returnIntegrityGuards` integration; `copy.saleCancelled` contract asserted |
| Payment idempotency, credit requests, balances | REUSED | `paymentIdempotency`, `creditRequest`, `customerBalance`, `financialIntegrity`, `priceTraceability` integration; `overdueCredit`, `moneyInConsistency`, `profitConsistency` unit guards |
| Inventory integrity, opening stock, pack sizes | REUSED | `inventoryIntegrity`, `packSize`, `productOpeningStock` 1/1, `stockAlerts` |
| Destructive actions (delete/archive, role delete, OTP wizard) | REUSED | `adminFullAccess` 4/4, `roleDeleteSafety` PASS, `destructiveSafety`, `accountDeletion` integration |

### Screens, language and states

| Requirement | State | Evidence |
|---|---|---|
| Dashboard scope (admin vs employee; no profit/supplier on the employee home) | REUSED | `dashboardScope` 6/6 (`e2e-runE.log`); re-run green on the shell change (`gate-gap2.log` is separate; `gate-lanes2.log` re-runs it after 0180) |
| Attendance-free dashboards, setup checklist derivation | REUSED | `setupCompletion` 5/5 (`e2e-runE.log`); `dependencyContinuity` 4/4 |
| Action Center, notifications, image sync | REUSED | `actionCenter` 12/12 + `imageSync` 10/10 (`e2e-runF-lanes.log`), re-run green after the shell change (`gate-gap2.log`); `notificationScope` unit |
| Cross-screen synchronisation | REUSED | `crossScreenSync` 13/13 (`e2e-batch10.log`), re-run green after the shell change |
| EN/LTR + UR/RTL, logical properties, overlays | REUSED | `rtlLtr` 16/16 (`e2e-batch2.log`, re-run after the shell change), `logicalDirection` 3/3, `overlayRtl` 2/2, `overlayAboveNav` 3/3, `interactionLayer` 8/8, `designLanguage`, plus the `i18nCoverage`/`i18nParity`/`microcopy` guards |
| Loading / error / empty / success states | REUSED | `skeletonCoverage` 2/2 + `skeletonCoverageGuard`; `dependencyContinuity` empty-state assertions; `education` |
| Tab bar meets the 44px touch minimum on both shells | FIXED + VERIFIED | 41px targets measured on 11 routes × 5 tabs (55) against a frozen baseline of 44; fixed in `AdminLayout`/`EmployeeLayout` with `min-h-[44px]`, baseline tightened to **0**, `accessibility` 3/3 (`gate-gap2.log`) |
| Audit history | PASS | `securityAudit` integration; `audit_events` SELECT is admin-gated and was measured non-permissive |

### What this changes about the earlier "known gaps"

The accessibility baseline is now stricter (0 structural undersized targets instead of 44), and
the two lanes that had never been green (`accessibility`, `adminMicrocopy`) are green. The
security review found three more tables of the 0178 class: two were real and are fixed (0180),
one (`user_permissions` insert) is refused and is now asserted so it cannot silently change.
`audit_events_insert` (`WITH CHECK (true)`) remains the one named, unfixed item.

### Remaining uncertainty (never converted into a pass)

- `audit_events_insert` is permissive: an authenticated session can write an audit row. Append-only
  table, so the harm is forged history rather than lost data. Not covered by 0178/0179/0180.
- The batch-6 `education` console 404 still has not reproduced; the lane prints the URL if it
  returns. `<meta>`-declared security headers remain ignored by the browser (pre-existing).

### Addendum (2026-10-02, after the matrix was frozen): the two named security items are closed

The matrix above was frozen with two security items still open. Both were then investigated,
reproduced on QA through the real JWT path and fixed the same day; the full record is in
`ENGINEERING_OS_STATE.md` under "0181 — audit rows are written by the system" and "0182 — a
shop's settings belong to that shop":

| Item | State when found | Closed by | Evidence |
|---|---|---|---|
| `audit_events_insert` `WITH CHECK (true)` | **latent** — no client INSERT privilege existed, so one future `grant` was the only thing standing between the schema and forged history | 0181: `WITH CHECK (false)` + shop-scoped SELECT | `auditIntegrity` 4 red → **6/6**; chain-4 regression vitest **116/116**, lanes **8/8**, ledger **173↔173**, tsc clean |
| `app_settings` broad read + shop-blind writes | **live** — tenant A's admin *and* employee read tenant B's threshold; A's admin rewrote B's value and inserted a row tagged `shop_id = B` | 0182: all three policies scoped to `current_shop_id()` | `appSettingsIsolation` 5 red → **9/9**; ledger **174↔174**; `financialIntegrity` 19/19; final catalog: 0 permissive-true INSERT policies |

Two corrections to the frozen matrix above, now measured rather than assumed:

- the `Audit history — PASS` row: the SELECT policy was admin-gated but **shop-blind** (an admin
  of one shop read another's row — reproduced, then fixed by 0181);
- the `app_settings` classification inside the 0180 narrative ("reference data with no `shop_id`")
  was **wrong** — the table has `shop_id`, a unique `(shop_id, setting_key)` and per-shop rows,
  which is exactly why the 0180 sweep skipped it and why 0182 had to fix it.

A permanent catalog guard now fails the run if either shape returns:
`tests/integration/shopScopedPolicyGuard.test.ts` — no policy with a literal-`true` predicate on
any table that has a `shop_id` column, and no permissive INSERT policy anywhere. It was proven
non-vacuous by injecting the shape into a throwaway table and watching the same predicate catch
it before the table was dropped.

**WHOLE APP + SECURITY: PASS.** No permissive-`true` policy remains on a shop-scoped table; no
INSERT policy anywhere accepts whatever the caller sends; the only permissive policy left is
`permissions_select` on global reference data (no `shop_id`, correct there). Release has still
not been authorized and no APK was built; the release path remains
`.github/workflows/build-apk.yml` when it is.

