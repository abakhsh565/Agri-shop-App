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
3. **No production credentials exist in this checkout** — `environments.json` sets production's
   `localEnvFile: null` on purpose, and `PROD_*` values are absent from `.env.qa` / `.env.local`
   (the names appear only as GitHub secret references and in tooling that reads a file outside the repo).
   Nothing here can connect to production even to read it.
4. **The owner's own checklist header says so:** *"Production database aur configuration ko abhi untouched
   rakhein"* — release only after staging verification and the owner's approval, neither of which exists yet.

**Current facts this file rests on:** branch `ci-proof/full-tree` @ `e986aa0d` (= origin) ·
working tree **dirty** (3 files) · CI run `38645773012` on that SHA **failed** at the integration step,
`Build APK` **skipped** · CI run `38645769443` on that SHA: *Gates* success, *QA* failed, *E2E* skipped.

---

## 1. Staging se pehle production readiness

| Item | Status | Evidence |
|---|---|---|
| CI integration failures resolve aur verify hon | **DONE (local) — CI leg still red** | **corrected 2026-10-15 (later pass).** All four CI-named files are green on `e986aa0d`: whole folder **42 files passed (42) · 493 tests passed (493) · 0 failures · 856.5 s**, exit 0 (`device-evidence/logs/integration-full-2026-10-15.log`) — `branchScopeEnforcement` 12/12, `customerDeletionSecurity` 13/13, `marketplaceContract` 28/28, `resolutionMemory` passed. The CI job is still red because the ordering fix is **uncommitted and unpushed**, not because a test fails |
| Required unit, integration, E2E pass · evidence reuse | **DONE (local) — CI leg still red until pushed** | **the whole suite re-ran green on `e986aa0d`: `149 passed · 0 failed · 0 did not run (38.2 m)`, exit 0** — every lane, so the invalidation caused by editing `tests/e2e/helpers.ts` is settled by measurement rather than by reuse. Unit **842/842** · integration **493/493 (42 files)** · `npx tsc --noEmit` **0** · `npm run build` **0**. The first full run found two real failures, both fixed and re-verified: `dashboardScope` test 1 (1500 ms hydration race) and `doubleTapSafety` test 1 (the lane leaked its own supplier payment). The recorded *142 passed / 5 failed* was **wrong** — the authority is `backups/e2e-final-2.log` = 146 · 1 · 2. CI itself is still red because the approved step-order fix is uncommitted |
| Tenant isolation, branch-level access | **PARTIAL** | `branchScopeEnforcement` **12/12** on live QA incl. cross-tenant write refusal; the four-persona live dataset is still missing (audit R3 = UNKNOWN) |
| RLS, RPC/API permissions, direct-access security | **PARTIAL** | read-only schema audit (see below) + `rpcContractGuard`; the per-role matrix against the real API does not exist |
| Employee roles, branch scope, permission revocation | **PARTIAL** | `0183` (deleting a role revokes access) + `rbacLifecycleAndSessions`; live end-to-end leg missing |
| Sales, payments, returns, refunds, inventory, balances integrity | **PARTIAL** | **corrected 2026-10-15 (later pass).** `crossScreenSync` and `dashboardScope` are **not red** — both re-ran green on `e986aa0d` (**19 passed, 6.3 m**), and `dashboardScope` reconciles every rendered figure against aggregate queries over the same tenant. The rest of the integrity suites inside the green integration run (**493/493**) are reused, not re-measured individually |
| Audit logs: real actor + relevant branch | **PARTIAL** | `auditIntegrity` / `securityAudit` green; live rows for the full action list not verified |
| Data-leakage risks resolved | **PARTIAL** | `PRODUCTION_READINESS_AUDIT.md` lists B1–B16; only **B5** is marked RESOLVED (2026-10-01, staging only). The rest carry their recorded status there — not re-measured today |
| QA cleanup + baseline independently verified | **PARTIAL** | two independent tools agree at **1794** rows; the baseline is **not clean** — 3 findings stand |

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
| Fresh production backup + verified restore | **PARTIAL** | artifact `backups/backup-production-gkswcfljxlutkfdvvqng-2026-10-01T11-21-48.sql` exists (340,654 bytes) but is **14 days old**; the restore was verified 2026-10-01 (`docs/RECOVERY.md`). A *fresh* backup needs credentials this checkout deliberately does not have |
| Every pending migration's impact reviewed | **NOT DONE** | blocked behind the §D schema-strategy decision; a replay is explicitly refused as the wrong answer |
| Rollback / recovery plan documented | **PARTIAL** | `docs/RECOVERY.md` exists; the production schema decision is written in `PRODUCTION_READINESS_AUDIT.md` §C–§D |
| Production vs QA credentials clearly separated | **DONE** | no `PROD_*` values in `.env.qa` / `.env.local`; no credential literals in source (guard, 111/111); QA tooling refuses the production ref **by name**; `migrate`/`release-gate` refuse production |
| No test data or QA fixtures on production | **DONE in code, not measured on the database** | guard *"no fixture id, QA phone or fixture name on any production surface"* and *"no migration outside the frozen set inserts a row under a demo/QA identity"* — both pass; nothing here can read production to confirm the live state |
| Explicit approval for destructive migration/cleanup | **NOT GIVEN** | the release gate refuses without `--owner-approved`; no approval exists |

## 3. Release build

| Item | Status | Evidence |
|---|---|---|
| Staging APK + release source verified | **PARTIAL** | local release APK verified (package `com.agrishop.app` v1.0(1), minSdk 23 / targetSdk 35, release keystore `CN=AgriShop`, QA ref packaged, bundle byte-identical to `dist/`); **no CI APK exists**; `RELEASE SOURCE COHERENCE: BLOCKED` in `ENGINEERING_OS_STATE.md` |
| Production configuration explicitly reviewed | **NOT DONE** | no production build has ever been produced; the vite environment gate would require `VITE_APP_ENV=production` with production credentials |
| Signing identity + keystore safe | **PARTIAL** | keystore present locally; four secrets present in Actions; an **off-machine** backup of the .jks is not verifiable from here |
| Package name, version, build metadata verified | **DONE (local artifact)** | measured with `aapt2` / `apksigner` |
| Release APK from `.github/workflows/build-apk.yml` | **NOT DONE** | *Build APK* **skipped** in the only runs on this SHA. Note the tension: the staging checklist's "no local APK path" item was closed by owner decision, so this production item is the one that still requires the workflow to run |
| Artifact matches the intended commit | **DONE for the local artifact / N/A for CI** | packaged bundle SHA-256 equals the `dist/` built from this commit |
| Secrets not exposed in logs or artifacts | **DONE** | credential-literal guard 111/111; keys read from files and never echoed; the production ref appears in the bundle only as the refusal constant |

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
| QA data cleanup complete | **PARTIAL** — 1794 rows, 3 findings stand |
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

| Area | Status |
|---|---|
| Branch-scope core test | **PASS** — 12/12, live QA |
| Production-safety guards | **PASS** — 111/111 (no production reach, no credential literals, no QA fixtures on production surfaces, no scheduled purges, no demo-data migrations) |
| Production hygiene (secrets separated, tools refuse production) | **PASS** |
| CI integration failures | **NOT RESOLVED** — red on `e986aa0d` |
| QA baseline | **NOT CLEAN** — 3 findings |
| Security / data isolation | **PARTIAL** — live per-role matrix and full bypass battery missing |
| Production schema / migration readiness | **REFUSED** — ledger 0016, schema-strategy decision §D outstanding |
| Fresh production backup | **NOT TAKEN** — newest is 2026-10-01 |
| Production deployment approval | **NOT GIVEN** |

**Nothing was deployed, no production row was read or written, and no production-related approval was
invented.** A release from this machine is blocked by the repository's own gates, by policy, and by the
absence of credentials — four refusals that are working as designed.
