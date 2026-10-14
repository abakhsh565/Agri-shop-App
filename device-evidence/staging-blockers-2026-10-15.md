# Why staging is not finished — blockers, with the evidence for each

**Date:** 2026-10-15 · Branch `ci-proof/full-tree`, HEAD `cc58e982` (nothing committed by this pass)

---

## 0. One line

**Blocker 1 is fixed and re-verified (4 passed).** Three things still stand between the current
state and the checklist: **nothing is committed so the CI build cannot start, the test phone is
unplugged, and two checklist items were never run at all.** Everything else is done and verified.

---

## 1. Blocker 1 — `adminMicrocopy` failed — **FIXED, re-verified 4 passed (6.3 m, EXIT=0)**

**How it failed, repeated on three runs and two different servers:** `2 failed / 2 passed`, ~7.5 min.

| Run | Server | Where it failed |
|---|---|---|
| 1 | shared `localhost:5173` | `page.goto` timeout → `/admin/inventory/movements` |
| 2 | shared `localhost:5173` | `page.reload` timeout → `/admin/companies` |
| 3 | **fresh server, port 5199** | `page.waitForLoadState('networkidle')` timeout at spec line 201 · test 4 timeout at line 233 |

The two passing tests were the ones that assert wording on the phone/code screens. **No failure was
ever an assertion about wording** — every one was a 120 s navigation/wait timeout.

**Mechanism (evidence, not a guess):** the waiting strategy does not fit this app's live data layer.

* `src/stores/companiesStore.ts:99-105` — `.channel("companies-feed").subscribe()`: `/admin/companies`
  is one of the routes this spec walks, and it holds an open realtime connection, so
  `waitForLoadState('networkidle')` has nothing quiet to observe.
* `src/pages/admin/alerts/RemindersOverviewPage.tsx:303,333` — 5 s and 10 s `setInterval` refetches.
* the spec then does a full `page.reload()` per route to plant the Urdu dictionary, so each route is
  loaded twice in sequence.

Classified as **a test-wait problem exposed by the app behaving correctly (live)**, not as a wording
regression and not as caused by the fingerprint fix: it reproduces on a server started fresh for the
test, at three different await points, and the two tests that do assert wording pass. The fix is to
assert the Urdu text instead of `networkidle` — a stronger assertion, not a weaker one.

**What the fix actually was** (`tests/e2e/adminMicrocopy.spec.ts`, no assertion weakened):

* a `settle(page)` helper waits for the screen the spec then reads — `domcontentloaded`, then a
  bounded, optional 4 s quiet-network attempt, then a required `document.body.innerText` length
  over 20 chars (30 s ceiling, message: "the route never rendered any text"). A live channel can no
  longer fail the lane for being live, and a blank route still fails it loudly;
* all 12 `waitForLoadState('networkidle')` calls in the file now go through it;
* the two 10-route / 5-route double-load loops get `test.setTimeout(300_000)`, because 120 s was
  never enough for that loop against a dev server — raising the ceiling alone would only have moved
  the timeout, which this file now records.

**Re-run:** `E2E_PORT=5199 npx playwright test tests/e2e/adminMicrocopy.spec.ts` → **4 passed
(6.3 m), EXIT=0** (`device-evidence/lane-adminMicrocopy-fixed2.log`). The lane is off the critical
path now: it is no longer what blocks the checklist's Urdu/RTL evidence (item 9) or the CI test job.

---

## 2. Blocker 2 — nothing is committed, so the sanctioned build cannot start

* `src/lib/biometric.ts` — modified (the fix)
* `tests/unit/biometricPluginName.test.ts`, `tests/unit/biometricDeviceVerdict.test.ts` — untracked
* `device-evidence/` — untracked evidence + device scripts
* lane artifacts changed by running the design lane: `tests/e2e/results.json`, `tests/e2e/results/design--*.png`
* other sessions' files are also dirty (`.freebuff/*`, `migration-report-0202.json`) — they are not mine and must not be swept into a commit

Checklist item 1 ("changes safely committed and pushed") and item 4 ("GitHub Actions build … no
local APK build") are therefore both unmet. The APK I installed was built locally with the same
gradle task, the same `inject-permissions.cjs` and the same release keystore — but that is not what
the checklist asks for, so it does not count as item 4.

---

## 3. Blocker 3 — the phone is disconnected

`adb devices -l` → **empty**. Everything on-device stops here:

* the thumbnail/avatar probe (`thumbnail-check.mjs` upload → screenshot → `avatar-diff.mjs`) — the
  probe has **not** been uploaded, deliberately: with no phone to judge it and clean up, touching QA
  data would be a one-way change for nothing
* device business smoke test (checklist item 8)
* device Urdu/RTL pass (item 9, device half)
* employee login / role / branch-scope checks on the device (item 7)

---

## 4. Blocker 4 — two checklist items were never run

* **item 8** — the controlled sale + double-tap check was not driven on the device (the
  `doubleTapSafety` lane covers the logic, but the checklist asks for the device flow)
* **item 11** — the independent recount of affected tables was not run; each lane did its own
  cleanup and printed the count it removed, which is not an independent count

---

## 5. What *is* done and verified

| Checkpoint | Evidence |
|---|---|
| Fingerprint on the real phone | `native=false plugin=no` before → row usable → OS dialog → real finger → app unlocked; 22 s untouched → still locked (no bypass). [device pass](fingerprint-device-pass-2026-10-15.md) |
| Bundle | 842/842 unit tests, `tsc --noEmit` clean, both new guards non-vacuous by injection |
| Lanes | `fingerprintUnlock` 5 passed · `overlayRtl` passed · `designLanguage` passed |
| APK | 44,046,490 bytes, `com.agrishop.app`, minSdk 23 / targetSdk 35, **QA project id baked in** |
| Signing secrets | all four present in GitHub Actions (`gh secret list`) |
| Production | untouched — no production credentials used, no production write |

---

## 6. The shortest path out

1. ~~fix the lane's wait strategy and rerun it~~ — **done, 4 passed**
2. commit the fix + guards + the lane fix (+ evidence), push the branch (~5 min)
3. trigger `.github/workflows/build-apk.yml` on that branch → download the CI APK (~20-40 min)
4. reconnect the phone → install that APK → thumbnail probe, sale smoke, Urdu pass, independent recount (~45 min)

Steps 2-4 need the owner's go-ahead (push, workflow run) or the phone. Nothing here is mine to
do alone any more.
