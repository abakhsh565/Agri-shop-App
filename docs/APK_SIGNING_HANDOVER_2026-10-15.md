# Handover — Android release identity + CI gate (2026-10-15)

Branch `ci-proof/full-tree` · HEAD `0755a2e7` · production untouched.

## 1. What is already done and verified

**CI / E2E gate — GREEN.** Run **38591622261** on `0755a2e7` (the commit that carries the
role-lifecycle leak fix):

| Job | Result |
|---|---|
| Gates (tsc · unit guards · safety proofs · build) | **success** |
| QA (migration ledger · integration suites) | **success** |
| E2E lanes against QA | **success** |

**Release-signed APK — built locally and verified.** `android/app/build/outputs/apk/release/app-release.apk`

| Fact | Value |
|---|---|
| Size / SHA-256 | 44,046,460 bytes · `53c8df9e8d45926e895bfb3f4c6e6aba370cd40787a8072371ff51ccaf348bb5` |
| Signature | **release key**, cert SHA-256 `8c8c85eac8c8c69c7c67b0ad00329005b311253fb56596ae961b61ba3529eab4` (not a debug key) |
| Package / version | `com.agrishop.app` · versionCode `1` · versionName `1.0` · targetSdk 35 |
| Permissions | CAMERA, USE_BIOMETRIC, INTERNET |
| Bundled configuration | QA/staging: `https://bpybjrjenwccowvtrevu.supabase.co` (see note), `VITE_APP_ENV=staging`, `VITE_OTP_DELIVERY=demo` |
| Built at commit | `0755a2e7` |

Built with the same steps as `.github/workflows/build-apk.yml`: `npm run build` with the QA
values from `.env.qa`, `npx cap sync android`, `.github/inject-permissions.cjs`,
`.github/inject-signing.cjs`, then `./gradlew assembleRelease` under Java 21
(`C:\Users\mg\.jdks\jbr-21.0.11`). QA configuration and security were not changed.

**A release keystore now exists locally** (it did not before):

```
keystore/release.jks              the app's release identity  (gitignored via /keystore/)
keystore/release.jks.base64       the same file, one line — this is ANDROID_KEYSTORE_BASE64
keystore/KEYSTORE-DETAILS.txt     alias + store/key password (gitignored)
keystore/gradle-release.log       the local assembleRelease log
```

- alias: `agrishop`
- certificate SHA-256: `8C:8C:85:EA:C8:C8:C6:9C:7C:67:B0:AD:00:32:90:05:B3:11:25:3F:B5:65:96:AE:96:1B:61:BA:35:29:EA:B4`
- **Back this folder up.** Losing it means future APKs cannot install over an installed build.

## 2. Blocker A — RESOLVED 2026-10-15

All four secrets now exist on `abakhsh565/Agri-shop-App` (`gh secret list`, set 2026-10-14T19:21Z):
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Values were piped from the local `keystore/` files and were never printed.

**Workflow dispatched on the verified commit:** run **38623008658** —
`build-apk.yml`, ref `ci-proof/full-tree`, sha `0755a2e7`, event `workflow_dispatch`.
(`main` is at `ca1e0c2b` and does NOT contain `0755a2e7`, so the dispatch deliberately targets the
branch that does.) Verify the published artifact with:

```bash
gh run watch 38623008658 --repo abakhsh565/Agri-shop-App
gh run view 38623008658 --repo abakhsh565/Agri-shop-App --json jobs \
  --jq '.jobs[] | "\(.name) => \(.conclusion)"'
```

Then confirm the release APK's signer cert SHA-256 equals
`8c8c85eac8c8c69c7c67b0ad00329005b311253fb56596ae961b61ba3529eab4`, its package is
`com.agrishop.app` v1.0, and its bundled config is the QA project. The local build in §1 already
meets those three; the CI artifact must match it.

> If a *previous* release keystore existed anywhere else, keep its backup: the secrets now carry
the key generated on 2026-10-15, and an installed build signed with an older key cannot be
upgraded by a build signed with this one.

### Original blocker description (kept for the record)

`.github/workflows/build-apk.yml` stops at **"Decode release keystore"** whenever
`ANDROID_KEYSTORE_BASE64` is empty, by design (see `.github/inject-signing.cjs`): a debug-signed
APK can never be verified as the domain owner for App Links. Nothing is being asked of you in
chat — the values are already on disk, so pick one path.

**Path 1 — I set them (no secret ever typed into this conversation).** `gh` is signed in as
`abakhsh565` with `repo` scope, so these four commands can be run for you, each reading its value
straight from the local file:

```bash
gh secret set ANDROID_KEYSTORE_BASE64   --repo abakhsh565/Agri-shop-App < keystore/release.jks.base64
PW="$(grep '^storePassword=' keystore/KEYSTORE-DETAILS.txt | cut -d= -f2-)"
gh secret set ANDROID_KEYSTORE_PASSWORD --repo abakhsh565/Agri-shop-App --body "$PW"
gh secret set ANDROID_KEY_ALIAS         --repo abakhsh565/Agri-shop-App --body "agrishop"
gh secret set ANDROID_KEY_PASSWORD      --repo abakhsh565/Agri-shop-App --body "$PW"
```

**Path 2 — you paste them yourself.** GitHub → `abakhsh565/Agri-shop-App` → Settings → Secrets
and variables → Actions → New repository secret. Names must be exactly:

| Secret | Value to paste |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | full contents of `keystore/release.jks.base64` (one line, no trailing newline) |
| `ANDROID_KEYSTORE_PASSWORD` | `storePassword=` in `keystore/KEYSTORE-DETAILS.txt` |
| `ANDROID_KEY_ALIAS` | `agrishop` |
| `ANDROID_KEY_PASSWORD` | `keyPassword=` in `keystore/KEYSTORE-DETAILS.txt` |

After either path: `gh workflow run build-apk.yml --ref main` (or Actions → Build Android APK →
Run workflow), then the artifact can be checked against the table in §1.

## 3. Blocker B — the phone (only you can do this)

`adb devices` currently lists **no device**. For items 6 / 7-device / 9-device / 12:

1. Phone → Settings → About phone → tap **Build number** 7× → Developer options unlocked.
2. Developer options → enable **USB debugging**.
3. Plug the phone in with a data-capable cable.
4. On the phone, accept the **"Allow USB debugging?"** prompt (tick "always allow").
5. Then `adb devices` shows a serial — that is the signal I need to continue.

## 4. Checklist status

| # | Item | Status |
|---|---|---|
| 1 | tsc + unit/integration suites | **DONE** (CI Gates + QA green on `0755a2e7`) |
| 2 | E2E lanes against QA | **DONE** (149 lanes green; CI E2E job green) |
| 8 | Pipeline / workflow safety | **DONE** |
| 10 | Guards + registry | **DONE** |
| 11 | Production untouched | **DONE** — no production read or write in this work |
| 7, 9 | Staging **web** | **DONE** |
| 3, 4, 5, 12 | CI-signed APK | **IN FLIGHT** — secrets set, run `38623008658` dispatched on `0755a2e7` |
| 6, 7-device, 9-device | Real-device staging | **BLOCKED on Blocker B** |
| — | Local release APK | **DONE + verified** (§1) |

## 5. Open verification thread — CLOSED (by design, one cosmetic note)

The single occurrence of the production project ref in the APK's JS was traced: it comes from
`src/lib/environmentContract.ts:41` importing the whole of `environments.json`
(`import environmentConfig from "../../environments.json"`). The guard needs the production ref in
the client to refuse a staging build that points at production (`envGuard.ts:151`), so the
reference itself is intentional and carries no credential.

Cosmetic consequence: because the entire registry file is imported, its auxiliary
`engineering_memory` notes and cluster ids ship in every install as well
(`dist/assets/authStore-*.js`). An optional slimming pass could import only the fields the contract
uses; not required for correctness.

`git status` note: the only files touched by this handover are this document and the gitignored
`keystore/` directory. No source file was modified, so no test result is invalidated.

## 6. Staging checkpoint — what is PASS and what is still open (measured 2026-10-15)

**PASS:** `npm run migrate:verify` → 197 files, newest `0205`, *"Directory and ledger agree exactly:
every file recorded, every record has a file, every hash matches."* CI gate green on HEAD (§1).

**OPEN — `npm run qa:baseline` reports BASELINE DRIFTED (4 findings).** Two of them were a race
with the CI run that was executing lanes while the check ran, and two are real residue:

| Finding | Attribution | Action |
|---|---|---|
| `customers` 11 vs 10 | the row is `QA VoidRole 1792006013771 Customer`, created **8 seconds before the check** — owned and deleted by the in-flight integration suite's own `afterAll` | re-check after the run; no cleanup while lanes run |
| `credit_limit_requests` 1 | the row **disappeared between two checks** (1 → 0) — same live race | re-check after the run |
| `supplier_payments` 1 (`2c3278a7…`, 500.00 cash, `recorded_by` = QA Admin id, 16:09:43Z) | suite-generated, not hand-entered: the criteria require all four of actor+method+amount+window, and this row matches `EXCESS_RULES.supplier_payments` exactly | `qa-prune-excess` after the run |
| `notifications` 1 (`c3f4efa2…`, actor QA Admin, `entity_type='payment'`, `entity_id` refers to a parent that no longer exists, 16:09:09Z) | orphan class: a lane cleaned its payment but not the notification it wrote beside it | `qa-prune-excess` after the run |

Two further notes for whoever finishes this:

- **Do not prune while lanes are executing.** The running CI job writes and deletes these same rows;
  the 1 → 0 change above is that happening. Re-run `npm run qa:baseline` after the run and prune only
  what survives.
- **`customers` has no entry in `EXCESS_RULES`,** so a leaked test customer is only removable by the
  suite that created it (exact-id cleanup in `tests/integration/rbacRoleLifecycleTargeted.test.ts`).
  That is fine while the suite completes; if a lane ever dies mid-run, its customer rows stay — worth a
  criterion or a name-scoped cleanup if it recurs.

Other staging/security items still open, unchanged by this work: the local tier-2 record in
`npm run resume` is stale (last attempts 2026-09-27, all failing), the QA database password and the old
service-role key found in git history are not rotated, and production's daily backup has been failing
since 2026-10-03 because `PROD_DB_PASS` is absent (production, outside the staging checkpoint).
