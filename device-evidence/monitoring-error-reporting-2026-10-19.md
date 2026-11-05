# Production error reporting — evidence record, 2026-10-19

Requested outcome: **a broken release is seen by the team rather than a customer.** This file records
what was built, what was run, what the measurements were, and what is still blocked on a person.

Nothing here is a plan. Every row is a command that ran or a measurement that was read.

---

## 1. What was built

| File | Purpose |
|---|---|
| `src/lib/errorReporting.ts` | the decision (configured or not), the scrubbing rules, the SDK options, and the one install point |
| `src/main.tsx` | installs before the first render; both global handlers now report to the record **and** the alert channel |
| `vite.config.ts` | injects the release id from `VERCEL_GIT_COMMIT_SHA` / `GITHUB_SHA`; uploads source maps only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` are all present |
| `scripts/deploy/mark-release.mjs` | records a verified release and its deploy boundary in the vendor's timeline (idempotent, refuses without configuration) |
| `.github/workflows/release-timeline.yml` | runs the marker after a deploy that concluded `success` — separate from the deploy workflow so a vendor outage cannot colour a release's verdict |
| `tests/unit/errorReporting.test.ts`, `tests/unit/releaseMarker.test.ts` | 55 guards |
| `docs/MONITORING.md` | what the owner must do (§2), what is proven (§3), how to operate it (§4) |

`docs/PRODUCTION_DATA_POLICY.md` is unchanged: the alert path reads nothing from production.

---

## 2. The browser proof (the claim that matters)

Not a unit test and not a source reading: a **built bundle**, served, driven by a real browser,
reporting to a local ingest.

```
VITE_APP_ENV=staging VITE_SUPABASE_URL=https://<staging-ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=… VITE_OTP_DELIVERY=demo \
VITE_SENTRY_DSN=http://0123456789abcdef0123456789abcdef@127.0.0.1:8787/1 \
VITE_RELEASE=testsha123 npx vite build            # exit 0, 6.18s
node device-evidence/tmp/sentry-sink.mjs 8787     # same-origin ingest + static server
# browser: http://127.0.0.1:8787/ → throw from a timeout, then reject unhandled
```

Measured from the captured envelopes (`device-evidence/tmp/sentry-envelopes.log`):

| Observation | Measured value |
|---|---|
| Envelopes received | **1 per error**, both `type: event` |
| Session envelopes | **0** — the `BrowserSession` integration is filtered out |
| Release | `agrishop-app@testsha123` (from `VITE_RELEASE`; in CI it is the commit sha) |
| Environment | `staging` |
| Exception message | `sale failed for customer [redacted-number] / [redacted-email], id 123e4567-e89b-12d3-a456-426614174000 at 2026-10-19 13:27:04` |
| Original phone `03001234567` present? | **no** |
| Original e-mail `ali@example.com` present? | **no** |
| Token `sb_publishable_abc…` (second run) present? | **no** |
| uuid present? | **yes** — deliberately, it is how an operator finds the row |
| Timestamp present? | **yes** — deliberately, it is when the error happened |
| `user` / `request` / `breadcrumbs` / `ip_address` / `user_agent` in the payload? | **none** |

Two defects were found *by this measurement* and fixed before it was accepted:

1. the phone-shaped rule redacted ISO-8601 timestamps and the tail of every uuid — fixed to ten-or-more
   digits, with uuids lifted out and restored, and cases pinned in the guard;
2. the SDK sent **session** envelopes carrying `user_agent` and `ip_address: {{auto}}` even with
   `autoSessionTracking: false` — fixed by filtering the `BrowserSession` integration, and pinned by a
   test that fails if the filter is removed.

---

## 3. Checks run

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run tests/unit/errorReporting.test.ts tests/unit/releaseMarker.test.ts` | **55 passed** |
| `npx vitest run tests/unit` (whole guard tree) | **94 files, 1307 tests, 0 failed** — exit 0. On the first run 1 test failed and it was right to: `productionDeployGate.test.ts` refuses `continue-on-error` anywhere in `deploy-production.yml`, which is how the marker step was first written. The marker was moved to its own workflow (`release-timeline.yml`) rather than the guard being relaxed, and the guard is now green with no suppression |
| Build with **no** DSN (the unconfigured path) | exit 0, **0 source maps emitted**, and in a real browser an error thrown on the page fetched **no Sentry chunk at all** (`performance.getEntriesByType('resource')` filtered for `esm-`/`sentry` = `[]`) — the SDK is a lazy import behind the decision, so an unconfigured deployment pays nothing |
| `node scripts/verify-workflow-safety.mjs` | **24 checks: 24 passed, 0 failed, 0 skipped** — including the new workflow's YAML and shell blocks |
| `node scripts/verify-targeting-refusals.mjs` | **ALL 8 CASES PASS** |
| `npx vite build` with the local DSN | exit 0; release id and DSN present in `dist/`; no source maps emitted (no token configured) |
| `gh secret list` / `gh variable list` | no `SENTRY_*` exists yet — §4 |

---

## 4. Blocked, with the exact action

| Blocker | Exact action | Who |
|---|---|---|
| No alert has ever fired from production | Create the Sentry project, put `VITE_SENTRY_DSN` in Vercel for **Production**, add `SENTRY_AUTH_TOKEN` (secret) + `SENTRY_ORG` + `SENTRY_PROJECT` (variables) in GitHub, then create the alert rule in `docs/MONITORING.md` §2d | owner |
| The release timeline has never recorded a real deploy | same credentials, then it runs by itself after the next successful `Deploy production` run | owner |
| Source maps have never been uploaded | same `SENTRY_AUTH_TOKEN` | owner |

Until then the honest statement is: **the app reports, the record works, and nobody is notified yet.**

---

## 5. Registry

`feature-registry.json` gained `monitoring-release-health` (status `PARTIAL`, one `BLOCKED` evidence
entry for the production claim), and `FEATURE-MAP.md` §A lists it.
