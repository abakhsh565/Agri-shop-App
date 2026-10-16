# Production release checklist — status, with the evidence, 2026-10-15

**This file does not report a completed production release, because there has not been one and there
will not be one from this machine.** It marks every item of the production checklist with what is
actually proven, and quotes the repository's own gates where they refuse.

**Why the answer is not "100% done":** the release is blocked at four independent layers, three of them
inside this repository:

1. **The repository's release gate refuses it.**
   ```
   $ node scripts/release-gate.mjs --commit e986aa0d --env production
   REFUSED
     ✗ no owner approval: pass --owner-approved only after the exact migration plan below has been
       reviewed by the owner. The flag is deliberately separate from --commit so approving a plan
       and releasing a different commit are two different actions.
   exit 2
   ```
   (Run without flags it also refuses `--commit must be a commit SHA`. Its documented refusal list is:
   unknown environment · missing/ mismatched owner approval · **a dirty working tree** · no CI run for
   that exact SHA, one still running, or one that failed · no successful staging job in that run ·
   absent production credentials, or credentials naming a project the configuration does not call
   production.)
2. **Production is not a target of the migration tooling — by policy.**
   ```
   $ node scripts/migrate.mjs verify --env production
   [MIGRATE REFUSED] production is not a target of this tool. Its schema does not yet match this
   directory (the ledger says 0016; the membership model is absent), so what production needs is the
   schema-strategy decision in PRODUCTION_READINESS_AUDIT.md §D — not a replay.
   Nothing was read and nothing was written. This refusal is deliberate and is not a bug.
   exit 2
   ```
3. **No production credentials exist in this checkout — by design, and the intended path is now
   configured and measured (2026-10-16).** `environments.json` keeps production's `localEnvFile: null`
   and no `PROD_*` value is in `.env.qa` / `.env.local`; the values live only in GitHub Actions secrets
   and in `~/.agrishop/production.env`, outside the repo. What was actually missing was one secret —
   `PROD_DB_PASS` — and it is now set: the CI preflight passes, production backs up **and
   restore-verifies** in CI (run `38826369696`), and the local read-only path produced a fresh,
   restore-verified artefact (`device-evidence/production-credentials-and-backup-2026-10-16.md`). So a
   **read-only** connection to production is possible — through `run-with-production-credentials.mjs`,
   and only that way. It is not a deploy path.
4. **The owner's own checklist header says so:** *"Production database aur configuration ko abhi untouched
   rakhein"* — release only after staging verification and the owner's approval, neither of which exists yet.

**Current facts this file rests on:** branch `ci-proof/full-tree` @ `e986aa0d` (= origin) ·
working tree **dirty** (3 files) · CI run `38645773012` on that SHA **failed** at the integration step,
`Build APK` **skipped** · CI run `38645769443` on that SHA: *Gates* success, *QA* failed, *E2E* skipped.

---

## 1. Staging se pehle production readiness

| Item | Status | Evidence |
|---|---|---|
| CI integration failures resolve aur verify hon | **DONE — CI leg green (2026-10-16)** | **corrected 2026-10-15 (later pass).** All four CI-named files are green on `e986aa0d`: whole folder **42 files passed (42) · 493 tests passed (493) · 0 failures · 856.5 s**, exit 0 (`device-evidence/logs/integration-full-2026-10-15.log`) — `branchScopeEnforcement` 12/12, `customerDeletionSecurity` 13/13, `marketplaceContract` 28/28, `resolutionMemory` passed. **Superseded 2026-10-16:** the ordering fix is committed and pushed, and the CI job is green — **CI leg closed 2026-10-16 (evidence reused, not re-run):** `ci.yml` run **38800530725** — Gates ✓ 1m 19s, QA (migration ledger · integration suites) ✓ 14m 6s; `build-apk.yml` run **38802733453** — *Run Tests* ✓ 41m 39s including the E2E lanes and *Build APK* ✓. Later runs `38816842445` and `38818865304` re-ran Gates + integration on the test and docs commits — see `device-evidence/release-artifact-verification-2026-10-16.md`. |
| Required unit, integration, E2E pass · evidence reuse | **DONE — CI leg green (2026-10-16)** | **the whole suite re-ran green on `e986aa0d`: `149 passed · 0 failed · 0 did not run (38.2 m)`, exit 0** — every lane, so the invalidation caused by editing `tests/e2e/helpers.ts` is settled by measurement rather than by reuse. Unit **842/842** · integration **493/493 (42 files)** · `npx tsc --noEmit` **0** · `npm run build` **0**. The first full run found two real failures, both fixed and re-verified: `dashboardScope` test 1 (1500 ms hydration race) and `doubleTapSafety` test 1 (the lane leaked its own supplier payment). The recorded *142 passed / 5 failed* was **wrong** — the authority is `backups/e2e-final-2.log` = 146 · 1 · 2. **Superseded 2026-10-16:** the approved step-order fix is committed and pushed, and CI is green — **CI leg closed 2026-10-16 (evidence reused, not re-run):** `ci.yml` run **38800530725** — Gates ✓ 1m 19s, QA (migration ledger · integration suites) ✓ 14m 6s; `build-apk.yml` run **38802733453** — *Run Tests* ✓ 41m 39s including the E2E lanes and *Build APK* ✓. Later runs `38816842445` and `38818865304` re-ran Gates + integration on the test and docs commits — see `device-evidence/release-artifact-verification-2026-10-16.md`. |
| Tenant isolation, branch-level access | **DONE (local, 2026-10-16)** | The "four-persona live dataset" this row was waiting for now exists: `securityMatrix` (**19/19**) puts owner, admin, manager and employee in ONE tenant on the same consequential RPCs, and it runs inside the live 13-file security set (**146 tests, exit 0**). Alongside it, `tenantBoundarySweep` (11/11 as a real authenticated session), `tenantIsolationOps` and `branchScopeEnforcement` (12/12, incl. the cross-tenant write refusal). Audit R3's `UNKNOWN` is closed by that matrix, not by a policy call. |
| RLS, RPC/API permissions, direct-access security | **DONE (local, 2026-10-16)** | The per-role matrix against the real API now exists — `tests/integration/securityMatrix.test.ts` **19/19**, non-vacuous by injection (granting `sales.void` to the employee role flips exactly that assertion; the grant was removed and the file re-run green) — plus the bypass battery in the same file (anon RPC refused, direct ledger `INSERT` refused, self-granted permission refused) and `tests/unit/securityMatrixCoverage.test.ts` (**7/7**) which fails when a consequential RPC reaches the ledger without a matrix row. `rpcContractGuard` and `securityAudit` stay green inside the CI Gates job; the read-only schema audit below is unchanged. |
| Employee roles, branch scope, permission revocation | **DONE (local, 2026-10-16)** | `0183` (deleting a role revokes its access rather than refusing) + `rbacLifecycleAndSessions` (the change applies at the next authorization boundary and the server reports effective permissions from itself, not from the client's cache) + `employeeAccessOverrides` (a reset clears every exception) all ran inside the live 13-file set; the `roleInUseDeletion`, `roleDeleteSafety` and `employeeStatusSafety` lanes cover the screens in CI's green E2E step. The browser reload proof inside a session now exists for displayed data, effective route access and the active branch (`sessionRefresh`, **2 passed**, 2026-10-16); the *revoked-access* reload remains an integration-level claim (`rbacLifecycleAndSessions`) and is not claimed in a browser. |
| Sales, payments, returns, refunds, inventory, balances integrity | **DONE (local, 2026-10-16)** | `crossScreenSync` (**13 passed**) and `dashboardScope` (**6 passed**) re-ran green on `e986aa0d` and again as part of the whole E2E suite (**149 passed · 0 failed**); the integrity suites — `financialIntegrity`, `inventoryIntegrity`, `paymentIdempotency` (**15/15**), `saleIdempotency`, `returnIntegrityGuards`, `stockLedgerAndDueDateGuard` — ran inside the live **493/493** integration folder run. `dashboardScope` reconciles every rendered figure against aggregate queries over the same tenant. |
| Audit logs: real actor + relevant branch | **DONE (local, 2026-10-16)** | `auditIntegrity` passed inside the live 13-file security set, and `branchIdentityBoundary` asserts the Activity RPC reads only the selected branch's events with immutable person/role labels while a member without `activity.view` is refused. Live rows for the full browser action list remain a **browser** leg. |
| Data-leakage risks resolved | **PARTIAL — unchanged this review** | `PRODUCTION_READINESS_AUDIT.md` lists B1–B16 and only **B5** is marked RESOLVED (2026-10-01, staging only). Several items that were open when that register was written were measured on 2026-10-16 — the five rows above — but **the register itself has not been re-walked**, so this row does not borrow those results. |
| QA cleanup + baseline independently verified | **DONE — measured clean (2026-10-16)** | Two independent tools agree and the baseline is clean: `npm run qa:baseline` → **exit 0, BASELINE OK** (every row declared, every fixture present) and `npm run qa:count` → **3,141 business rows — `audit_events` 3,116 (declared history, unbounded), `customers` 10, `product_variants` 5, `products` 5, `companies` 3, `sales` 2**, i.e. the declared fixture floor plus history. The 3 findings that previously stood were a marketplace cluster whose *cause* was fixed (the lane registered its product with the cleanup registry after the assertions on it). `qa:count`'s own exit 1 is by design (it is an is-it-empty gate) and is not a pass/fail signal. |

**Read-only schema audit, run today** (`node scripts/audit-production-readiness.mjs` — it runs against
QA, *"because QA is the only database this repo has credentials for"*; log in
`backups/production-readiness-2026-10-15/audit.log`):

```
Production-readiness audit — READ ONLY — project bpybjrjenwccowvtrevu
1. RLS coverage      RLS OFF (world-readable via anon key): 0 · RLS ON but ZERO policies (deny-all): 15
2. Policy inventory  roles referenced: {anon,authenticated} · {authenticated} · {public}
3. SECURITY DEFINER  public functions: 187 · SECURITY DEFINER: 164 · without pinned search_path: 0
```

## 2. Production database safety

| Item | Status | Evidence |
|---|---|---|
| Production schema + migration history verified | **NOT DONE — refused** | `migrate verify --env production` → **REFUSED, exit 2** (ledger 0016, membership model absent). The recorded production baseline is `supabase/baseline/production-baseline.json` (8 ledger rows, latest `0016`) |
| Fresh production backup + verified restore | **TAKEN + VERIFIED (2026-10-16)** | `PROD_DB_PASS` was the missing piece and was the recorded cause of run `38696121562` dying at the preflight; it was set 2026-10-16T23:54Z from the validated out-of-repo file (stdin only — never argv, env, a temp file, or chat). **Local path:** fresh artefact `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-15T23-57-01.sql` (**333,989 bytes**, sha256 `ceb62aa9…`), manifest **30 tables · 249 rows · 56 FKs · 104 policies**, cluster **`7666007964130682852`** = the enrolled fingerprint; `restore-verify --compare-with production` → **RESTORE VERIFICATION: PASS** (integrity · replay: 769 statements, 0 failures · counts · structure · digests · auth 2/2). **CI path:** run **38826369696** — *Preflight* ✓, *Take the backup* ✓, *Verify the backup against the environment it names* ✓, *Confirm the artefact* ✓ — red only on the **Summary step's own bug** (a relative-path `require`, root-caused and fixed; `verify:workflow` **24/24** after the fix), which skipped *Upload*. **The fix is proven on the branch:** run **`38828524870`** (dispatch with `--ref ci-proof/full-tree`) is ✓ end to end — *Summary* ✓, *Upload* ✓ — and the artefact is now stored off-machine and retention-governed: `database-backup-production-36`, **53,237 bytes**, digest `sha256:1c8d0abd…`, **expires 2026-11-15** (the agreed 30 days); the merge (`92a8802a`, PR #1) now only moves the *scheduled* run onto the fix. Production stays **Free plan: no managed backups, no PITR** — these artefacts are the coverage. |
| Every pending migration's impact reviewed | **NOT DONE** | blocked behind the §D schema-strategy decision; a replay is explicitly refused as the wrong answer |
| Rollback / recovery plan documented | **PARTIAL** | `docs/RECOVERY.md` exists; the production schema decision is written in `PRODUCTION_READINESS_AUDIT.md` §C–§D |
| Production vs QA credentials clearly separated | **DONE** | no `PROD_*` values in `.env.qa` / `.env.local`; no credential literals in source (guard: **111 checks at the 2026-10-14 run**, and the production-safety set re-run **2026-10-16 → 5 files, 121 tests, exit 0**); QA tooling refuses the production ref **by name**; `migrate`/`release-gate` refuse production |
| No test data or QA fixtures on production | **DONE in code, not measured on the database** | guard *"no fixture id, QA phone or fixture name on any production surface"* and *"no migration outside the frozen set inserts a row under a demo/QA identity"* — both pass; nothing here can read production to confirm the live state |
| Explicit approval for destructive migration/cleanup | **NOT GIVEN** | the release gate refuses without `--owner-approved`; no approval exists |

## 3. Release build

| Item | Status | Evidence |
|---|---|---|
| Staging APK + release source verified | **DONE (2026-10-16)** | local release APK verified (package `com.agrishop.app` v1.0(1), minSdk 23 / targetSdk 35, release keystore `CN=AgriShop`, QA ref packaged, bundle byte-identical to `dist/`) **and the CI APK now exists**: `build-apk.yml` run **38802733453** published release **`apk-build-389`** with `app-release.apk` — 44,046,488 bytes, sha256 `34d12b3d…0676be`, downloaded and matching GitHub's digest; packaged app source identical to HEAD (`31641ecf..HEAD` empty over `src/`, `index.html`, `vite.config.ts`, `package.json`, `public/`). *(The earlier "no CI APK exists" was a wrong endpoint: the workflow publishes the APK as a Release asset, not a workflow artifact.)* `RELEASE SOURCE COHERENCE: BLOCKED` in `ENGINEERING_OS_STATE.md` remains open. `device-evidence/release-artifact-verification-2026-10-16.md` |
| Production configuration explicitly reviewed | **NOT DONE** | no production build has ever been produced; the vite environment gate would require `VITE_APP_ENV=production` with production credentials |
| Signing identity + keystore safe | **PARTIAL** | keystore present locally; four secrets present in Actions; an **off-machine** backup of the .jks is not verifiable from here |
| Package name, version, build metadata verified | **DONE (local artifact)** | measured with `aapt2` / `apksigner` |
| Release APK from `.github/workflows/build-apk.yml` | **DONE (2026-10-16)** | *Build APK* now runs: run **38802733453** on `31641ecf` — *Run Tests* ✓ (unit, integration, E2E) → *Build APK* ✓ (keystore decoded, signing injected, `assembleRelease`) → *Create GitHub Release with APK* ✓. Earlier runs had it **skipped** because the *Run Tests* step failed first. **Scope note:** this is a staging-configuration APK; a production build has still never been produced (next row) |
| Artifact matches the intended commit | **DONE for the local artifact; DONE — EVIDENCE REUSED for CI (2026-10-16)** | local: packaged bundle SHA-256 equals the `dist/` built from this commit. CI: the run built `31641ecf`, and `git diff --stat 31641ecf..HEAD -- src/ index.html vite.config.ts package.json public/` is empty, so the packaged app source is identical to HEAD. The release's `targetCommitish` field reads `main` (the release action's default) and is **not** the built commit — the run's `headSha` is |
| Secrets not exposed in logs or artifacts | **DONE** | credential-literal guard (111 checks on 2026-10-14; the set re-run 2026-10-16 → 5 files / 121 tests exit 0); keys read from files and never echoed; the production ref appears in the bundle only as the refusal constant |

## 4. Final acceptance

Every item is either the owner's device step or dependent on §1 being green — **none of it can be
claimed from this machine** (`adb devices` empty):

| Item | Status |
|---|---|
| APK installs and starts | **OWNER** — not done here |
| Owner/employee authentication and permissions | **OWNER** (lane evidence only) |
| Core sale flow + double-tap duplicate protection | **OWNER** (`doubleTapSafety` lane covers the logic) |
| English/LTR and Urdu/RTL | **OWNER** (lane half done: `adminMicrocopy` 4 passed, `overlayRtl`, `designLanguage`) |
| State persists after reopen | **OWNER / UNKNOWN** |
| QA data cleanup complete | **DONE — measured clean (2026-10-16)**: `qa:baseline` exit 0, 3,141 rows all declared (fixture floor + audit history); no finding stands |
| Remaining blockers documented | **DONE** — the blockers doc §1–§10 and the staging checklist |
| Owner completes real-device testing and approves | **NOT GIVEN** |

## 5. Production deployment

**All six items: NOT STARTED.** No approval, no frozen commit or artifact, no confirmed recovery
readiness for the current schema, no approved migration sequence, no post-deployment smoke test, and
`PRODUCTION_READINESS_AUDIT.md` B9 records that **nothing is monitored** — so the "monitor production
logs, errors and security events" item has no mechanism behind it. The rollback decision-maker and
process are named in `docs/RECOVERY.md`, not in an approved plan.

---

## The honest summary

| Area | Status | Evidence |
|---|---|---|
| Branch-scope core test | **PASS** | `branchScopeEnforcement` 12/12 against live QA, inside the 13-file security set (146 tests, exit 0) |
| Production-safety guards | **PASS — re-measured 2026-10-16** | 5 guard files, **121 tests, exit 0** (no production reach, no credential literals, no QA fixtures on production surfaces, no scheduled purges, no demo-data migrations) |
| Production hygiene (secrets separated, tools refuse production) | **PASS** | `environments.json` sets production's `localEnvFile: null`; no `PROD_*` values in `.env.qa` / `.env.local`; QA tools and `migrate` refuse the production target by name |
| CI integration failures | **RESOLVED — green in CI (2026-10-16)** | `ci.yml` run `38800530725` on `31641ecf`, dispatched alone: *Gates* ✓ 1m 19s and *QA (migration ledger · integration suites)* ✓ 14m 6s. `build-apk.yml` run `38802733453`: *Run Tests* ✓ 41m 39s including the E2E lanes. Later runs `38816842445` and `38818865304` re-ran Gates + integration on the test and docs commits. |
| QA baseline | **CLEAN — measured (2026-10-16)** | `qa:baseline` exit 0 with every fixture present; 3,141 rows, all declared (fixture floor + audit history). No finding stands. |
| Security / data isolation | **MEASURED (2026-10-16) — no leg blocked** | The live per-role matrix and the full bypass battery both exist now: `securityMatrix` 19/19 (non-vacuous by injection), the 13-file security set **146 tests, exit 0**, and `branchIdentityBoundary` **34 tests** proving the `0192` guard sits before every early return and at every retry-return site. **No leg is `BLOCKED` any more:** the **browser-driven branch-removal flow** (`security-data-isolation-2026-10-16.md` §6.1) was measured on 2026-10-16 — `tests/e2e/branchRemoval.spec.ts` (**2 passed**) drives the archive screen against live QA and reads the resulting row back, and `tests/e2e/sessionRefresh.spec.ts` (**2 passed**) holds data, route access and the active branch across a reload and a reopen (`device-evidence/session-and-branch-removal-live-2026-10-16.md`). |
| Production schema / migration readiness | **REFUSED — and now quantified** | `supabase/baseline/production-baseline.json` records the server's own bookkeeping as **`{count: 8, latest: "0016"}`** against **198** migration files in `supabase/migrations/` — production is **182 ledger entries behind the repository**, with measured mismatch examples already recorded (0177 fails on that schema: neither `public.get_my_shop_request(text)` nor `public.process_reminders()` exists there; 0176 applies cleanly). `migrate verify --env production` **REFUSES, exit 2**, by policy: what production needs is the §D schema-strategy decision, not a replay. |
| Fresh production backup | **TAKEN + VERIFIED (2026-10-16)** | `PROD_DB_PASS` set (the exact missing credential); fresh 333,989-byte production artefact, cluster `7666007964130682852`, **RESTORE VERIFICATION: PASS** including the live comparison; CI run `38826369696` passes preflight + backup + restore-verify and loses only the upload to a workflow reporting bug that is fixed in the working tree (`device-evidence/production-credentials-and-backup-2026-10-16.md`) |
| Production deployment approval | **NOT GIVEN** | `scripts/release-gate.mjs` refuses without `--owner-approved`; no approval is recorded anywhere |

---

## 6. Production against an industry baseline

What a production deployment is normally expected to have, versus what this repository has today. The
right-hand column is the measurement, not an opinion; §8 lists the commands behind the new rows.

| # | Practice (what the industry expects) | This repository today | Evidence |
|---|---|---|---|
| 1 | **Environment separation and no production reach.** Separate projects, production credentials never in a developer checkout, tooling that refuses the wrong target | **Stronger than typical — kept as the model to build on** | `environments.json` is the single target map; `environmentContract.ts` refuses a foreign project; `productionReachGuard` fails if the automated surface even names production; QA tools refuse production **by name**; `migrate` and `release-gate` refuse production. Re-measured: **5 guard files, 121 tests, exit 0** |
| 2 | **A release path that is the ONLY path to production** — every promotion is a pipeline run with gates, nobody deploys by hand | **Gap.** `scripts/release-gate.mjs` fails closed on unknown env · missing owner approval · dirty tree · no CI run for that exact SHA · a run still going or failed · no successful staging job · missing or foreign production credentials. But `.github/workflows/` contains only `backup-database.yml`, `build-apk.yml` and `ci.yml` — **no release workflow invokes it**, so the gate is a manual script | `ls .github/workflows/` → 3 files; `grep -rn release-gate` → `PIPELINE.md`, this document and the script itself, nothing that runs it |
| 3 | **Pinned, reproducible artefacts** — deploy the digest CI verified, not "whatever `main` is" | **Done for the APK path, never for production** | Release `apk-build-389` from run `38802733453`: 44,046,488 bytes, sha256 `34d12b3d…0676be`, packaged source identical to HEAD — but built with `VITE_APP_ENV: staging`. No production artefact has ever been produced |
| 4 | **Backups: automated, restore-verified, with an agreed RPO/RTO** | **Coverage and the objectives now both exist.** Run in production for real on 2026-10-16: the missing `PROD_DB_PASS` was set, CI passes preflight → *Take the backup* → *Verify the backup* (run `38826369696`), and the local path produced a fresh 333,989-byte artefact whose restore verification is **PASS** end to end. Production is on Supabase **Free** (no managed backups, no PITR), so this artefact is the coverage. **The objectives were agreed on 2026-10-16 and recorded in `docs/RECOVERY.md` §9: RPO 24 h** (conditional on the daily 02:00 UTC run — a failed or missing run means the RPO is *exceeded* until a manual dispatch succeeds), **RTO 4 h** from the restore *decision* for the database at its current size (an agreed target, **not a drilled result** — PGlite was the stand-in), **retention 30 days** of daily artefacts, and **time-to-notice unbounded** until monitoring exists (B9). The figures are guarded: `tests/unit/backupTargeting.test.ts` fails when the workflow's cron or retention default drifts from §9 — proven non-vacuous by injecting each side | Run `38826369696` (the failure that preceded it: `38696121562`, credential preflight); `gh secret list` (`PROD_DB_PASS` set 2026-10-15T23:54Z); artefact `backup-production-gkswcfljxlutkfdvvqng-2026-10-15T23-57-01.sql` + `restore-verification-production.json`; the workflow takes the backup, replays it into a throwaway Postgres, checks the cluster fingerprint and re-checks the artefact's own environment/project fields before upload |
| 5 | **Forward-only migrations with a production-safe pre-flight and a rollback/forward-fix plan** | **Partial, and currently unfit.** The pre-flight exists (`verify:forward-on-baseline` against a frozen production schema); production itself is **182 ledger entries behind** and no rollback has ever been rehearsed against the production schema | `production-baseline.json` → `ledgerOnServer {count: 8, latest: "0016"}` vs 198 files; measured mismatch examples 0177/0176; `migrate verify --env production` → REFUSED |
| 6 | **Observability: error tracking, logs, metrics, alerting, uptime checks** | **None at all — measured, not assumed** | `grep -rniE "sentry\|posthog\|datadog\|newrelic\|new relic\|bugsnag\|logrocket\|mixpanel\|amplitude\|opentelemetry"` over `package.json`, `src/`, `scripts/`, `.github/` → **no matches**. No crash reporting, no APM, no log aggregation, no synthetic check on the sale flow — so no production alert has anything to fire from |
| 7 | **Incident response: runbook, severity, on-call, comms** | **Partial.** `docs/RECOVERY.md` names the rollback decision-maker and the restore procedure; there is no severity matrix, no on-call, no status/comms channel, and the restore has not been rehearsed on the current production schema | `docs/RECOVERY.md`; §5 of this file |
| 8 | **Staged rollout: canary/percentage, feature flags, kill switch** | **None.** The install paths are "install the APK" or "publish to the store" — no percentage rollout, no feature flag, no remote kill switch; stopping a bad release needs a new build | No flag or remote-config dependency in `package.json`; §5 |
| 9 | **Secrets management: rotation, least privilege, no long-lived superuser** | **Partial.** No credential in the repository (guard-enforced) and secrets are scoped per environment — but the missing `PROD_DB_PASS` is exactly blocker (5), no rotation policy is recorded, and the backup path must use the `postgres.<ref>` role because the pooler hides the project identity | `gh secret list`; `environments.json`'s `clusterId` note; guards 121/121 |
| 10 | **Security review: dependency scanning, SAST, threat model, penetration test** | **Partial.** RLS coverage audit, RLS-deny-all report (15 tables ON with zero policies), `rpcContractGuard`, `securityAudit` and the live 2026-10-16 matrix; but **no dependency-scanning or SAST workflow** and no threat model or pen-test artefact | §1 and the read-only schema audit; `.github/workflows/` has no scan job |
| 11 | **Privacy and data lifecycle: PII inventory, retention, deletion rights** | **Strong on paper and in code — and production still holds seeded demo rows.** 23 rows keyed by demo identities, 4 logins on demo phone numbers, 2 demo-named records, 79 rows merely scoped to the demo tenant (52 of them sales). Deletion is final; the owner-recoverable trash is recorded as *not built* | `docs/PRODUCTION_DATA_POLICY.md` + `productionDataPolicy` guard (43 tests); `npm run audit:production-data` on the 2026-10-01 artefact |
| 12 | **Release engineering: versioning, release notes, store metadata** | **None.** `versionName 1.0`, `versionCode 1`, no changelog, no release-notes step, no Play Console data-safety or listing artefacts in the repository | §3; `capacitor.config.ts` |
| 13 | **Performance and capacity validation** | **Not measured.** No load test, no latency budget, no index review (production holds 47 indexes over 28 tables) | `production-baseline.json`'s `structure` |
| 14 | **Mobile specifics: crash/ANR reporting, keystore custody, upgrade migrations** | **Partial.** Keystore plus four signing secrets exist in Actions (minSdk 23 / targetSdk 35 verified); an **off-machine keystore backup is unverifiable from here and losing it ends all future updates**; no crash/ANR reporting; the offline queue's behaviour across a real version upgrade is untested | §3; `android-assetlinks` step in `build-apk.yml`; §10 of the staging checklist |

## 7. The production path, in order

Each step is a precondition of the next, and none of them has happened:

1. **Owner decides the production schema strategy** (`PRODUCTION_READINESS_AUDIT.md` §D). Production is 182
   ledger entries behind the repository; nothing downstream can be planned before this.
2. **Configure production credentials.** `PROD_DB_PASS` for the backup path (it is missing today), and the
   production app build's Supabase URL/anon-key pair under the `PROD` prefix — neither exists in repository
   secrets, which is why no production build can even be produced right now.
3. **Take a fresh, restore-verified production backup** — the newest artefact is from 2026-10-01.
4. **Decide the demo-data question** (`PRODUCTION_DATA_POLICY.md` §6: remove only the demo identities · reset to
   an empty migrated schema · leave it and enforce the rule from here on). It is destructive, owner-run, and
   needs step 3 first. **The executable version is `docs/PRODUCTION_DEMO_DATA_CLEANUP.md`**: Plan A empties every
   table (verified offline — all 30 tables → 0, and it names every table that holds rows), Step 2b removes the
   uploaded files the SQL cannot, and **Plan R is the one that matters here** — a wipe alone leaves production on
   migration `0016`, while `branches`, `roles`, `user_permissions` and `user_active_shops` (created by 0094–0149)
   do not exist there at all, so the current app cannot read the database it would be left with.
5. **Approve the migration plan and its rollback/forward-fix path** for the frozen production schema, and
   rehearse the rollback once.
6. **Build a production-configured APK** through `build-apk.yml` with `VITE_APP_ENV=production` — never done —
   and verify its packaged target exactly the way the staging artefact was verified (release asset, digest,
   packaged project ref).
7. **Stand up observability before any rollout:** crash/error reporting, an uptime or synthetic check on the
   critical flow (a sale), and a destination a human actually watches. Today there is none.
8. **Make the release gate the only promotion path:** a workflow that runs
   `scripts/release-gate.mjs --env production --owner-approved` and refuses on any of its documented conditions.
9. **Post-deploy smoke test on production** (read-only checks plus one real business operation) with
   pre-agreed rollback thresholds.
10. **Owner acceptance on the real device against the production build**, then the rollout — which, with item 8
    of §6 absent, is currently all-or-nothing.

## 8. What was re-measured for this review

Everything the new rows rest on, so none of it is inherited prose:

| Check | Result |
|---|---|
| `npx vitest run tests/unit/productionReachGuard.test.ts tests/unit/productionDataPolicy.test.ts tests/unit/backupTargeting.test.ts tests/unit/environmentSafety.test.ts tests/unit/authSafetyGuard.test.ts` | **5 files passed, 121 tests passed, exit 0** (6.09 s) |
| `gh run list --workflow=backup-database.yml` | **three runs, and the difference between them is the measurement.** Plus `38828524870` — `workflow_dispatch` on `ci-proof/full-tree` (the ref that carries the fix): **all steps ✓**, *Summary* ✓, *Upload* ✓, artefact `database-backup-production-36` stored with a 30-day expiry. **two earlier runs, and the difference between them is the measurement.** `38696121562`, 2026-10-15T07:02:29Z, event `schedule`, **failure** — failed step *Preflight — the selected environment must have credentials*, with *Take the backup*, *Verify…*, *Confirm the artefact…* and *Upload…* **skipped**. `38826369696`, 2026-10-15T23:54:32Z, event `workflow_dispatch`, **in_progress→completed** on `ca1e0c2b` — *Preflight* ✓, *Take the backup* ✓, *Verify the backup against the environment it names* ✓, *Confirm the artefact names the environment it was asked for* ✓, and only *Summary* ✗ (the relative-path `require` bug, fixed in the working tree) which skipped *Upload* |
| `gh secret list` | `PROD_DB_HOST`, `PROD_DB_USER`, **`PROD_DB_PASS`** (all three re-set 2026-10-15T23:54Z from the validated out-of-repo file) · four `ANDROID_*` signing secrets · the `QA_*` set · **no production Supabase URL/anon-key pair** (unchanged: the backup path needs the database trio only) |
| `grep -rniE "sentry\|posthog\|datadog\|newrelic\|bugsnag\|logrocket\|mixpanel\|amplitude\|opentelemetry" package.json src/ scripts/ .github/` | **no matches** |
| `ls .github/workflows/` and `grep -rn release-gate` | `backup-database.yml`, `build-apk.yml`, `ci.yml` — **no release workflow**; `release-gate` appears only in `PIPELINE.md`, this document and the script |
| `supabase/baseline/production-baseline.json` | `ledgerOnServer {count: 8, latest: "0016"}`; `structure` 28 tables / 37 functions / 56 FKs / 47 indexes; 198 files in `supabase/migrations/` |
| Reused, not re-run (unchanged files) | the live security set 13 files / 146 tests exit 0 · `qa:baseline` exit 0 with 3,141 rows · `apk-build-389` byte-verified · `verify-workflow-safety.mjs` 24/24 |

**Verdict unchanged by all of it: production is NOT DONE, and it is not deployable today.** Five independent
refusals stand in the way — the release gate's own conditions, the migration policy, the owner's approval, the
absent **deploy** path (the §D schema-strategy decision, not a replay), and the absence of any monitoring to
release into. Four of those are working as designed; the observability gap is the one that is simply not built
yet. The **backup path left that list on 2026-10-16**: the missing credential (`PROD_DB_PASS`) was set, a fresh
production artefact was taken and restore-verified end to end, and CI now passes preflight, backup and
restore-verify — with one reporting bug in the workflow fixed (`92a8802a`), published in **PR #1** and
**proven green on the branch**: run **`38828524870`** uploaded the artefact (`database-backup-production-36`,
53,237 bytes, expires 2026-11-15). Coverage now exists off-machine; the merge is what moves the nightly run
onto the fix (`device-evidence/production-credentials-and-backup-2026-10-16.md` §4 and §6).

**Nothing was deployed, no production row was read or written, and no production-related approval was
invented.** A release from this machine is blocked by the repository's own gates, by policy, and by the
absence of credentials — refusals that are working as designed.
