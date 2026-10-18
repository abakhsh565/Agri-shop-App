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
