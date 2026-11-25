# Failure log — what broke, why, and what stops it recurring

A failure is not closed until its entry here is complete. This file is the durable half of the CI
feedback loop; `ci.yml` seeds the five fields on every red run, and this file is where they are
answered.

## Why this file exists

A red run used to leave nothing behind but a log that expires. The only failure artifact was the
Playwright report (`tests/e2e/results.json`, 7 days); the unit and integration steps were plain
`npx vitest run` with no report at all, and the success-only step summary was skipped on failure.
Locally, `verify.mjs` wrote one line (`lastVerify.reason`) that the next run overwrote. So the
observed failure, its root cause, the prevention, and the regression that proved the fix were never
in one place — and the best catch of a session could disappear with a squashed commit.

## Rules

1. **Append, never rewrite.** A new failure gets the next id at the end. A repeat failure adds a
   `Recurrence` line to the existing entry rather than editing its history. This is a **review
   rule**: nothing here mechanically proves an older entry was not edited (see
   `tests/unit/failureLog.test.ts` for what *is* enforced).
2. **Root cause is `confirmed` or `not yet confirmed`.** `confirmed` requires named evidence (test
   output, measurement, commit, run). A hypothesis is written as `not yet confirmed` and stays
   that way until something proves it.
3. **Prevention names a change, not an intention** — a file, a rule, a guard.
4. **Regression names a real test**, and the result actually observed.
5. No secrets, no customer data, no credential values.

## Fields

Every entry has all five, in this order:

- **Observed**: what failed — test name, error text, and where the evidence lives.
- **Root cause**: `confirmed — … (evidence: …)` or `not yet confirmed — …`.
- **Prevention**: the change that stops recurrence, and where it lives.
- **Regression**: `` `path/to/test.ts` > `test name` `` — PASS | FAIL | NOT RUN.
- **Status**: one of the four below.

Statuses (reusing the evidence vocabulary in `FEATURE-MAP.md` §D):

| Status | Meaning |
|---|---|
| `OPEN — root cause not confirmed` | Failure recorded; the cause is still a hypothesis |
| `OPEN — root cause confirmed, fix pending` | Cause proven; the fix has not landed |
| `FIXED + REVERIFIED` | Fix landed and the named regression passed |
| `BLOCKED` | Cannot be fixed or verified now; the entry says why |

## Entries

## F-0001 — the rehearsal path still sent the QA identity query

- **Observed**: `tests/unit/qaRunLock.test.ts` > `skips the fingerprint only on the rehearsal path — the local stack has its own cluster` failed with `AssertionError: rehearsal must not touch the QA identity check: expected [ …(2) ] to have a length of 1` — unit run, exit 1, 2026-10-18.
- **Root cause**: confirmed — `claimVerifiedQaRunLock` evaluated `await readQaClusterId(client)` while building the argument object, so the identity query was sent before `qaClusterProblem` could short-circuit on `rehearsal` (evidence: the failing run recorded two calls where the test required one — first the identity read, then the claim; after moving the read behind `if (!options.rehearsal)` the same test observed exactly one, the claim). Fixed in `938ae2f`.
- **Prevention**: skip the read itself, not merely its result — `if (!options.rehearsal)` in `claimVerifiedQaRunLock` (`tests/setup/qa-lock.ts`). Rehearsal stays isolated anyway: `qaLockTargetProblem` limits `QA_LOCK_DB_PORT` to a loopback host.
- **Regression**: `tests/unit/qaRunLock.test.ts` > `skips the fingerprint only on the rehearsal path — the local stack has its own cluster` — PASS
- **Status**: FIXED + REVERIFIED

## F-0002 — production accepted the fixed code `123456` for a listed phone number

- **Observed**: registering a shop on the live site (`hisaabkitaab.dpdns.org`) with `03001234567` reached the shop-details form by typing `123456` — a code nobody sent. Reported by the owner, 2026-10-27; the measurements behind the cause are in `docs/PRODUCTION_PHONE_AUTH.md` §2.
- **Root cause**: confirmed — the app was **not** in demo mode: the production bundle is compiled with `VITE_APP_ENV:"production"` and `VITE_OTP_DELIVERY:"sms"` and contains the demo refusal, so `123456` cannot pass the shared-code path. The production **project** carried a test-OTP list — `sms_test_otp: 923001234567=123456,…` with `sms_test_otp_valid_until: 2026-11-29` — and `03001234567` normalises to `923001234567`, so GoTrue accepted the listed code as if it had been texted (evidence: production's own auth configuration, read 2026-10-27; the live entry bundle's inlined environment values; the owner's observed sign-in).
- **Prevention**: `docs/PRODUCTION_PHONE_AUTH.md` is the procedure — the required project settings, the two outside-the-app verification checks, and the rule that the Test OTPs list is never set in production; §5 of that document plus `tests/unit/otpPolicy.test.ts` keep the code expiry the screens display equal to the server's. The app half was already guarded (`src/lib/environmentContract.ts`, `src/lib/authMode.ts`); the project half is a human step and this repository may not write it.
- **Regression**: `tests/unit/otpPolicy.test.ts` > `the runbook and the app agree on the code expiry` — PASS
- **Verified 2026-10-27**: cleared on the production project — the configuration now reads `sms_test_otp: null`, and a live probe against the app's own target and key answers `923001234567` + `123456` with **403 `otp_expired`** and no session, as it does for `923001122334` + `123456` and for the `000000` control. The registration screen no longer reaches the code screen at all: with the provider credential still a placeholder, the send fails at Twilio and the screen says so. What remains is a *different* gap — no production sign-in is possible until the real SMS provider is configured (`docs/PRODUCTION_PHONE_AUTH.md` §2a).
- **Status**: FIXED + REVERIFIED

## F-0003 — the smoke lane waited for a customer the picker had filtered out

- **Observed**: `tests/e2e/doubleTapSafety.spec.ts` > `sale: double-tapping Complete Sale creates one sale and deducts stock once` failed twice on CI run `45082232312` (job `e2e`, commit `9a79bd3`) with `TimeoutError: locator.click: Timeout 10000ms exceeded — waiting for getByText('QA Customer A')`, 2026-11-23.
- **Root cause**: confirmed — the three QA fixture customers carried `is_archived = true` (archived `2026-11-20T01:28Z` by the QA owner profile), and `SelectCustomerPage` filters `!c.isArchived`, so the row could not render. The lane's own premises passed because they read the database, not the list (evidence: a direct read of QA's `customers` rows showing `archived_at 2026-11-20T01:28:17.866Z` for `QA Customer A`, and the page's `!c.isArchived` filter).
- **Prevention**: the lane now states its premise — it un-archives `DT_CUST_ID` alongside its stock and balance resets (`tests/e2e/doubleTapSafety.spec.ts`), so an earlier run archiving a fixture can no longer surface as a selector timeout. The three QA fixture customers were restored to active in the same pass; no assertion was removed or weakened.
- **Regression**: `tests/e2e/doubleTapSafety.spec.ts` > `sale: double-tapping Complete Sale creates one sale and deducts stock once` — PASS
- **Verified 2026-11-23**: CI run `45204962383` (commit `62ed9e0`, the commit that carries the lane fix) ran `Gates`, `QA` and `E2E lanes against QA` — all three `success`, so the restored fixture rendered and the double tap produced one sale.
- **Status**: FIXED + REVERIFIED

## F-0004 — the double-submit suite signed in twice at once and one half lost its password

- **Observed**: `tests/integration/duplicateActionSafety.test.ts` > `Duplicate action safety` > `1. supplier payment: two simultaneous confirms with one key pay once` failed on CI run `45213668252` (job `qa`, commit `255eb6b`) with `AssertionError: expected 'Auth sign-in failed for 10000000-0000-0000-0000-000000000001: Invalid login credentials' to be null`, 2026-11-23. The other 42 integration files and 522 of 523 tests passed and the `Gates` job was green, so the failure was in the harness, not in the payment path.
- **Root cause**: confirmed — the test submits both halves of the double tap through `execRpcAsUser`, so both halves call `getAuthClient(10000000-…-0001)` at the same instant. Each half derived credentials from a single pooled `SELECT phone FROM users`; when that read came back empty for one half, that half fell back to the id-scoped `qa-test-…@test.local` / `QA-test-…-2024!` pair while the other half used the app's phone-derived pair. Both then repaired the same `auth.users` row, so the half that repaired first signed in against the other half's password (evidence: a direct read of QA's `auth.users` row for that id showed the app-derived email with an `updated_at` inside the failing window, and a reproduction against QA ran the interleaved repairs — identical credential pairs signed in `ok` 4/4, mismatched pairs answered `Invalid login credentials` 4/4).
- **Prevention**: `getAuthClient` now coalesces in-flight sign-ins per user id (`authClientInflight`, `tests/setup/qa-client.ts`), so simultaneous callers share one credential repair, one sign-in and one client; the internal phone-mismatch path deliberately recurses into `getAuthClientUncoalesced` because awaiting the coalescer from inside its own promise would deadlock, and `invalidateAuthCache()` clears the in-flight map with the client cache.
- **Regression**: `tests/integration/duplicateActionSafety.test.ts` > `1. supplier payment: two simultaneous confirms with one key pay once` — PASS
- **Verified 2026-11-23**: CI run `45254641812` (commit `7d8401d`, the commit that carries the coalescing) ran `Gates`, `QA` and `E2E lanes against QA` — all three `success`; the QA job reports `43 passed (43)` files and `523 passed (523)` tests with `duplicateActionSafety.test.ts` among them, so the double submit signed in once and recorded one payment.
- **Status**: FIXED + REVERIFIED
