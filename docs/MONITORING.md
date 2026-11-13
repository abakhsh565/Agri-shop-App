# Monitoring — the record, the alert and the release timeline

**Effective 2026-10-19.** Enforced by `tests/unit/errorReporting.test.ts`,
`tests/unit/releaseMarker.test.ts`, `tests/unit/monitoringPrivacy.test.ts` and the registry entry
`monitoring-release-health`. None of them is advisory.

The rule this document exists for: **an error that only the customer can see is not monitored.**
Until 2026-10-19 production had a private record of client errors and nothing that told a person
about them.

---

## 1. What exists, and what each part proves

| Part | What it is | What it proves | Where |
|---|---|---|---|
| The record | `public.client_error_events` (migration `0203`) | that an event happened, with the environment it happened in; write-only for clients, readable by the service role only | `src/lib/monitoring.ts`, `src/main.tsx` |
| The alert | Sentry, via `src/lib/errorReporting.ts` | that **somebody is told** — a new issue, an e-mail, a release with a first-seen timestamp | this document §2 |
| The timeline | `scripts/deploy/mark-release.mjs` + `release-timeline.yml` | that a given commit became production at a given moment, so "since when?" is answerable | `.github/workflows/release-timeline.yml` |

Both destinations receive the *same* handler in `src/main.tsx`: `window.onerror` and
`unhandledrejection`, registered before the first render, so the errors that happen on the way in —
including before sign-in — are reported.

**No production read path was added.** The vendor receives an allow-listed payload from the browser;
nothing in CI reads production, and `docs/PRODUCTION_DATA_POLICY.md` is unchanged. That is why the
alert channel is a vendor and not a watchdog querying the table: a watchdog would need a new
production credential and a new exception in that policy.

---

## 2. What the owner has to do (nothing below is done by an agent)

**a. Create the Sentry project.** Sign in at <https://sentry.io> → *Projects* → *Create project* →
platform **React**. Note the **organization slug** and the **project slug**.

**b. Copy the DSN** — *Settings → Projects → &lt;project&gt; → Client Keys (DSN)*. It looks like
`https://<public key>@o123456.ingest.sentry.io/1234567`. A DSN is a write-only ingest address; it is
not a credential for reading anything.

**c. Put the DSN in the app's environment**, in the Vercel project (`agri-shop-app`) for the
**Production** environment (and Preview/QA separately if you want staging alerts):

```
VITE_SENTRY_DSN=https://<public key>@o123456.ingest.sentry.io/1234567
```

Naming the repository secret/variable (GitHub → Settings → Secrets and variables → Actions):

| Name | Kind | Value | Used for |
|---|---|---|---|
| `SENTRY_AUTH_TOKEN` | **secret** | an org token with `project:releases` | uploading source maps at build time; the release timeline |
| `SENTRY_ORG` | variable | organization slug | same |
| `SENTRY_PROJECT` | variable | project slug | same |

Without the three, builds are byte-identical to before (no maps, no upload) and
`release-timeline.yml` reports *not configured* instead of pretending.

**d. Turn on the alert.** Sentry → *Alerts* → *Create alert* → **Issues**:

- **When:** *A new issue is created*
- **If:** `environment` equals `production`
- **Then:** e-mail, plus Slack if the org has it
- **Action interval:** as it happens

That single rule is what turns a broken release into a page.

**e. Optional, and worth it:** *Settings → Releases* shows each release with its deploy marker from
`release-timeline.yml`, so a spike can be read against the deploy that caused it.

---

## 3. What is proven, and what is not

| Claim | Status | Evidence |
|---|---|---|
| A real built bundle reports an uncaught error and an unhandled rejection | **PROVEN** | browser run against a local ingest, 2026-10-19: one event envelope per error, `release: agrishop-app@testsha123`, `environment: staging` — `device-evidence/monitoring-error-reporting-2026-10-19.md` |
| Nothing customer-shaped leaves the browser | **PROVEN for the events measured**: phone, e-mail and token redacted; uuid and timestamp preserved; no `user`, `request`, `breadcrumbs`, `ip_address` or `user_agent` in the payload; session envelopes suppressed | same file §2, plus 55 guard tests including a control that the raw payload did carry those values |
| An unconfigured reporter is *disabled*, not silently dropping | **PROVEN** | `errorReportingStatus()` returns `enabled:false` with a reason for a missing/unknown environment, a missing DSN or a malformed DSN |
| A deploy is recorded on the timeline | **NOT PROVEN** — no token exists, so the workflow has never run against the real API | `release-timeline.yml` has never executed; the plan and idempotency rules are unit-tested only |
| An alert reaches a person from production | **NOT PROVEN** — no DSN, no project, no alert rule yet | §2 is the exact action needed |
| Stack traces are readable | **NOT PROVEN** — the source-map upload has never run with a real token | `vite.config.ts` uploads only when the three values exist; proven absent-path only (build succeeds, no maps emitted) |

**No claim of production monitoring is made until a real release produces a real alert.**

---

## 4. Operating it

```bash
# What would the reporter do with a given environment? (pure decision, installs nothing)
npx vitest run tests/unit/errorReporting.test.ts -t 'missing configuration'
npx vitest run tests/unit/errorReporting.test.ts tests/unit/releaseMarker.test.ts

# Prove the browser path end to end without touching a vendor: build with a DSN pointing at the
# local sink, then open the built app and force an error.
node device-evidence/tmp/sentry-sink.mjs 8787
VITE_APP_ENV=staging VITE_SUPABASE_URL=https://<staging-ref>.supabase.co \
  VITE_SUPABASE_ANON_KEY=<staging key> VITE_OTP_DELIVERY=demo \
  VITE_SENTRY_DSN=http://<32 hex chars>@127.0.0.1:8787/1 VITE_RELEASE=localtest \
  npx vite build
# then http://127.0.0.1:8787/ and throw from the console; envelopes appear in
# device-evidence/tmp/sentry-envelopes.log

# Rehearse the timeline without an outage (dispatch with dry_run=true is the default)
gh workflow run release-timeline.yml -f sha=<live commit> -f dry_run=true
```

The automatic path records a release only for a deploy workflow run that **itself was triggered by a
green CI run** — a run that created a deployment and had it verified. A manual deploy
(`gh workflow run deploy-production.yml -f sha=<commit> -f dry_run=false`) is live but not recorded
automatically, because the deploy workflow's manual trigger also carries its dry-run rehearsals; it
is recorded by dispatching `release-timeline.yml` with the same sha and `dry_run=false`. That is the
one path where a person asserts "this commit is live".

A red `release-timeline.yml` means **the timeline is incomplete**, not that production is broken: the
release it names was already verified by `deploy-production.yml`.

---

## 5. The privacy rules, and where they are enforced

`scrubEvent()` is the only function that decides what leaves the browser:

* removed outright — `request`, `user`, `extra`, `breadcrumbs`, `modules`, `server_name`;
* context limited to `browser` / `os` / `runtime` (a device model, a carrier and a locale are not
  needed to fix a stack trace);
* tags limited to `screen`, `error_code`, `app_env`, `release_stage`, `component`;
* every surviving string is redacted: e-mails → `[redacted-email]`, ten-or-more-digit runs →
  `[redacted-number]`, `Bearer …` → `[redacted]`, Supabase/JWT-shaped keys → `[redacted-token]`;
* uuids and ISO timestamps are deliberately **preserved** — the first is how an operator finds the
  row, the second is how they know when it happened. Both are pinned by tests, because an earlier
  version of the pattern redacted them;
* no session tracking: the `BrowserSession` integration is filtered out. Measured before the filter,
  the SDK also sent session envelopes carrying `user_agent` and `ip_address: {{auto}}` — data the
  scrubber was removing from events;
* sampling: error events only. No performance traces, no replays, no logs (all rates at 0).

---

## 6. Limits, stated rather than discovered later

* Sentry's free tier drops events above the monthly quota; when that happens the **record** in
  `client_error_events` is unaffected, and the quota notice is itself a visible state in Sentry.
* A page blocked by an extension that blocks `*.sentry.io` sends nothing — the record still exists.
  Sentry's *tunnel* option (a same-origin relay) would close this; it needs a server path this app
  does not have, and is deliberately not built.
* `client_error_events` has `service_role` SELECT but no DELETE grant, so retention pruning still
  requires SQL (recorded in `PIPELINE.md` §D6).
