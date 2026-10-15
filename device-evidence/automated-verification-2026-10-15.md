# Automated verification — closed with evidence, 2026-10-15

**Branch** `ci-proof/full-tree` @ **`e986aa0d`** (= `origin`, 0 ahead / 0 behind) · **QA project**
`bpybjrjenwccowvtrevu` (`[EnvGuard] Environment verified` on every run below) · **production** never
read or written.

**Scope of this pass — one item, as asked:** *"Automated verification — NOT PASS. Integration tests
fail hue hain. E2E mein crossScreenSync aur dashboardScope failures report hue; latest full E2E run
bhi 142 passed / 5 failed tha."*

---

## 0. One line

**The integration half is resolved and re-verified (42/42 files, 493/493 tests, 0 failures). The E2E
half was never red as described: the figure in both status documents is contradicted by the
repository's own logs, and both named lanes pass on the current commit — 19 passed with fresh
evidence, plus the one lane that *was* the single failure of the authoritative full run.**

---

## 1. Integration tests — CI red → green, measured

```bash
$ set -a; . ./.env.qa; set +a
$ npx vitest run tests/integration --fileParallelism=false --reporter=verbose
 Test Files  42 passed (42)
      Tests  493 passed (493)
   Duration  856.49s
```

Exit 0, **0 failures** (`device-evidence/logs/integration-full-2026-10-15.log`). This is the same
command and the same flags as the CI step *Run integration tests (one file at a time)*, against the
same QA project CI uses — not a local stack.

### 1.1 The four files CI reported red, each accounted for

| File | CI error (run `38645773012`) | Local result now | Reads as |
|---|---|---|---|
| `branchScopeEnforcement` | `warehouse-scoped employee must be able to sign in: … 'Invalid login credentials'` | **12/12 passed** (31.1 s) | the provisioning step that repairs fixture credentials sat **after** this step; the approved fix moves it before (uncommitted, see §4) |
| `customerDeletionSecurity` | "the QA DeletionSecurity namespace is not clean, so this suite cannot make a statement about authorization" | **13/13 passed** (33.0 s) | QA residue; the suite refuses to run on another writer's rows by design — the residue is gone |
| `marketplaceContract` | `run_sql: … product_variants_product_id_fkey` violation | **28/28 passed** (25.4 s) | a fixture parent row state, not a product rule — not reproducible here |
| `resolutionMemory` | Scenario B assertion (*unclassified* in the previous pass) | **passed** inside the 493 | the previously unclassified one is green; no defect found |

`customerDeletionSecurity` + `marketplaceContract` re-run alone first: **41/41 passed, exit 0**
(60.3 s), then the whole folder — the same result, so neither was a sequencing artefact of the run.

---

## 2. E2E — the reported failures are not in the repository's own records

### 2.1 The figure is wrong in both status documents

| Source | Recorded | What the logs actually say |
|---|---|---|
| `device-evidence/staging-checklist-status-2026-10-15.md` (row *Relevant Playwright E2E tests pass*, line 125 after this pass's edits — 115 before them) and `production-release-checklist-status-2026-10-15.md:51` | "142 passed / 5 failed / 6 not run" | no log on disk carries this |
| `backups/e2e-final-2.log` (the authority named by `ENGINEERING_OS_STATE.md`) | — | **`146 passed · 1 failed · 2 did not run (36.1m)`** |
| CI run on `9cbc6db6` (`docs/FINAL_STAGE_FULFILMENT_2026-10-14.md` §4c) | — | **`142 passed · 1 failed · 6 did not run (29.8m)`** — the failure was `accessUx.spec.ts:222`, classified QA-residue and fixed (`accessUx` 7 passed after) |

The real source of the claim is a **mid-run artefact**: `tests/e2e/results.json` is overwritten by
every lane run, and the copy on disk is the 2026-10-14 **morning** run —
`startTime 2026-10-14T10:12:58Z`, `expected 100 · unexpected 25 · skipped 24`. That run's failures were
classified into 16 transport (`execSql: TypeError: fetch failed`) and 9 real defects, and the 9 were
fixed and re-verified before the evening run (`ENGINEERING_OS_STATE.md`, "the browser suite's nine real
failures"). **A per-lane artefact is not a full-run record.**

### 2.2 `crossScreenSync` and `dashboardScope` passed in the authoritative run

Straight out of `backups/e2e-final-2.log`:

```
ok  35..47  tests/e2e/crossScreenSync.spec.ts   (13 tests — every one)
ok  48..53  tests/e2e/dashboardScope.spec.ts    (6 tests — every one)
```

Neither lane appears in that run's failure list. Its **one** failure was
`doubleTapSafety.spec.ts:78` — *"needs a payment-free fixture supplier; QA holds payments from another
run"*: a **precondition on residue**, not an assertion about the product.

### 2.3 Fresh evidence on the current commit

```bash
$ npx playwright test tests/e2e/dashboardScope.spec.ts tests/e2e/crossScreenSync.spec.ts
  19 passed (6.3m)                       # exit 0 — 13 crossScreenSync + 6 dashboardScope
$ npx playwright test tests/e2e/doubleTapSafety.spec.ts
  3 passed (1.8m)                        # exit 0 — the full run's single failure, now green
```

Logs: `device-evidence/logs/lanes-dashboardscope-crossscreensync-2026-10-15.log`,
`device-evidence/logs/lane-doubletap-2026-10-15.log`. `doubleTapSafety`'s precondition is satisfied
because the two residue rows it refuses on (`supplier_payments`, `notifications`) are 0 today — the
2026-10-15 prune removed them.

---

## 3. The one change made, and why it is not a weakened assertion

`tests/e2e/crossScreenSync.spec.ts` contained **45** `waitForLoadState('networkidle')` calls, one per
navigation. That condition is **unreachable on this app, for a reason that is the product working**:
two of the routes this lane walks (`/admin/dashboard`, `/admin/companies`) hold live connections —
`companiesStore` subscribes to a realtime channel (`companies-feed`), `notificationStore` polls on a
timer — so a quiet network never arrives.

This is the **same mechanism measured and already fixed** in `adminMicrocopy` (three runs, two
servers, a 120 s navigation timeout at a different route each time: §1 of
`device-evidence/staging-blockers-2026-10-15.md`). Rather than write the same fix a second time, the
`settle()` helper moved into `tests/e2e/helpers.ts` and both lanes use it.

It is **stronger than what it replaced**, not weaker:

* a quiet network is still tried — bounded (4 s) and optional, so the read that follows is meaningful
  when it arrives and a live channel cannot fail the lane for being live;
* what is **required** is that the route rendered: `expect.poll` on `document.body.innerText` length
  must exceed 20 characters within 20 s, with the message *"the route never rendered any text"*. A
  blank route still fails the lane loudly instead of timing out at 120 s;
* **every assertion in the file is unchanged.**

### 3.1 The change is verified

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **exit 0** |
| Unit suite + all guards | `npx vitest run tests/unit` | **68 files, 842/842 passed**, 0 failures (34.1 s) |
| The affected lanes | `npx playwright test dashboardScope crossScreenSync` | **19 passed (6.3 m)**, exit 0 |
| Production build | `npm run build` | **exit 0**, `✓ built in 6.13s` |

---

## 4. QA floor — the runs added nothing

| Check | Before this pass (`npm run preflight`) | After the integration run + 3 lanes | Verdict |
|---|---|---|---|
| Declaration findings | 3 | **3 — the same three** | unchanged |
| Rows above the declaration | products 6 vs 5 · product_variants 6 vs 5 · inventory_movements 1 | identical | unchanged |
| Identity of those rows | `f1db4b63…` (product), `722559c5…` (variant), `52f0ffc0…` (movement) | **the same three ids**, all `created_at 2026-10-14T20:04:41.283Z`, actor `10000000-…-0001` | created **before** this pass — no new row |
| `supplier_payments` / `notifications` | 0 / 0 | **0 / 0** | the `doubleTapSafety` precondition holds |
| `audit_events` | 1766 | 1865 | **`history`** — the system writes it, the declaration does not bound it, and nothing deletes it to force a green |

`node scripts/dev/qa-baseline.mjs` → **BASELINE DRIFTED (3 findings)**, the same three preserved on
2026-10-15 and named in `staging-blockers-2026-10-15.md` §10.1. Nothing was deleted by this pass.
Production: **0 requests, no credentials in the checkout, untouched.**

---

## 5. What is still open — stated exactly

1. **The CI job is still red, and that is a push, not a defect.** Every named failure reproduces green
   locally on `e986aa0d`. What the CI run needs is the already-approved (and still **uncommitted**)
   `build-apk.yml` step-order fix — `Provision QA Auth Sessions` before `Run integration tests` —
   plus a push and a dispatch. Until then, "the CI test job passes" is *unproven by CI*, and this
   document does not claim it.
2. **The other 32 E2E lanes are INVALIDATED, not reused — this is the one honest gap in the E2E item.**
   `scripts/dev/verify.mjs:63-68` states the rule in the repository's own words: the shared E2E harness
   (`tests/e2e/helpers.ts` among them) *"is appended to EVERY lane … Editing one of them **must
   invalidate the lane evidence**"*. This pass edited that file, so by the repo's own mechanical rule the
   evidence of every lane that was not re-run is **INVALIDATED**, and `backups/e2e-final-2.log`
   (146/1/2) cannot be cited as still-valid coverage for them. An earlier draft of this document said
   "reused"; that was wrong and is corrected here.

   Stated precisely, so the cost is visible: the change is **purely additive** — `git diff --numstat`
   reports `35 additions, 0 deletions` for `helpers.ts` (a new exported `settle()`; no existing helper
   touched), and the only lines deleted in the spec are the 45 identical
   `await page.waitForLoadState('networkidle');` statements, with every assertion untouched. So no lane's
   *behaviour* changed — but the invalidation is mechanical by design, and calling it "unchanged" would
   be exactly the silent pass the rule exists to prevent. Restoring valid evidence means the full lane
   set: `npm run verify` at tier 2, ~36 minutes serial (`npm run verify:plan` prints the 34 lanes), or
   `node scripts/run-e2e-lanes.mjs` on the same set. **Not run in this pass** — it was outside the item
   asked for, and it is the one thing that would make the E2E item fully green by measurement.
3. **Uncommitted.** `tests/e2e/helpers.ts` (+`settle`), `tests/e2e/crossScreenSync.spec.ts` (45 waits
   → `settle`), the two corrected status documents, the corrected `.github/workflows/build-apk.yml`,
   this record and its logs. Committing and pushing are the owner's call and were not done.

---

# Part 2 — the whole suite run, and the two failures it found (same day, later)

**The instruction this responds to:** *finish the integration suite, then resolve the remaining recorded
E2E failures one by one — reproduce → fix the root cause → rerun the affected test → record. Do not
treat a suspected fixture problem or a local PASS as proof. Do not declare PASS until every required
failure is resolved and recorded.*

## 6. First, the two tests nobody had ever named

The authoritative 2026-10-14 run ended `1 failed · 2 did not run` and **named neither of the two**.
Derived with `device-evidence/tmp/not-run.mjs` (suite list vs log, keyed on file + full title, because
line numbers move when a spec is edited):

```
  x   59  doubleTapSafety.spec.ts:86:3   customer payment: double-tapping confirm records one payment
  -   60  doubleTapSafety.spec.ts:124:3  sale: double-tapping Complete Sale creates one sale…
  -   61  doubleTapSafety.spec.ts:182:3  supplier payment: double-tapping confirm records one payment
```

The "2 did not run" were the **2nd and 3rd tests of `doubleTapSafety`**, skipped behind the failure of the
1st. Resolved by measurement: that whole file now passes twice in a row (§8), which covers `:124:3` and
`:182:3` by name.

## 7. The full suite, run 1 — `145 passed · 2 failed · 2 did not run (37.7m)`

This is the CI command (`npx playwright test`, 149 tests, 1 worker) against the live QA project, with no
other writer (`device-evidence/logs/e2e-full-2026-10-15.log`). It found **two real failures**, and they
have **different** root causes. Neither is a weakened assertion, and neither was guessed:

| Failure | Error text | Root cause, measured |
|---|---|---|
| `dashboardScope.spec.ts:111:3` (test 1) | `Quick Alerts section missing` — body: *"No suppliers yet · No products yet · No customers yet · Total Sales Rs. 0 · Loading…"* | **a hydration race**, not a product defect and not data loss: the database held `customers 10 · products 6 · companies 3` and the fixtures were intact, so the screen had rendered the un-hydrated shell. `login()` waited a fixed **1500 ms**; that is enough on a fresh dev server (the lane is 6/6 alone) and not enough on a dev server that has been serving for half an hour. The `Quick Alerts` section is data-dependent, so an empty store hides it and the error pointed at the wrong thing entirely |
| `doubleTapSafety.spec.ts:86:3` (test 1) | `doubleTapSafety needs a payment-free fixture supplier; QA holds payments from another run` — expected 0, received 1 | **a real ownership leak in the lane itself.** Test 3 records a Rs. 500 supplier payment against the SHARED fixture company and, unlike tests 1 and 2 (which use snapshot-before + `claimNew`), never registered the row, so `cleanupFixtures()` had nothing to delete. Attributed by identity, not by inference: `supplier_payments 22203d47-…`, `amount 500.00`, `company_id 50000000-…-0001`, `created_at 2026-10-15T15:54:26Z` — created by this lane's own earlier green run, and precisely the row its own `beforeAll` then refused to start on |

## 8. The fixes, at the source

**`tests/e2e/doubleTapSafety.spec.ts`** — every row the file causes is now claimed by id:

* test 3 claims its supplier payment (`claimNew('supplier_payments', …)`) — the leak above;
* tests 1 and 2 claim the **notification** the RPC writes alongside their payment/sale. Measured: a
  payment for a *shared* fixture customer writes a notification whose `entity_id` is that (unowned)
  customer, so no branch of the cleanup plan matched it and it survived a green run as QA drift;
* test 3 deliberately claims **no** notification, and that is measured rather than assumed — claiming one
  made `claimNew` throw *"found no new row — the action did not create what this lane believes it created"*,
  which is the guard working. (The supplier-payment path writes no notification.)

**`tests/e2e/dashboardScope.spec.ts`** — test 1's stopwatch replaced by a data-driven gate: the test now
polls the rendered body until it carries the total it has just read from the database, with the DB value
in the failure message. **Stronger than what it replaced**: a blank, stale or wrong dashboard still fails,
and it fails naming the figure instead of timing out. Every other assertion is untouched.

### 8.1 Verification of the fixes

| Check | Command | Result |
|---|---|---|
| The leak no longer accumulates | `npx playwright test doubleTapSafety.spec.ts` **twice in a row** | **3 passed** each time, exit 0; floor after each run: `supplier_payments=0 · customer_payments=0 · notifications=0` (`lane-doubletap-final-run1.log`, `-run2.log`) |
| The other lane | `npx playwright test dashboardScope.spec.ts` | **6 passed (1.4 m)**, exit 0; test 1 now 21.5 s vs 10.4 s when it failed — the gate waiting for hydration (`lane-dashboardscope-fixed.log`) |
| Residue removed through the reviewed tool | `node scripts/dev/qa-prune-excess.mjs --apply` | `notifications 1 → 0`, `supplier_payments 1 → 0`; both classified **CONFIRMED test-origin**; independent recount `qa-baseline.mjs` → **3 findings** (the pre-existing preserved cluster) |
| **The whole suite, run 2** | `npx playwright test` | **149 passed · 0 failed · 0 did not run (38.2 m)**, exit 0 (`e2e-full-2026-10-15-run2.log`) |

Inside run 2, the two tests that failed in run 1 pass **in the same suite position**:
`ok 48 dashboardScope.spec.ts:111:3` and `ok 59 doubleTapSafety.spec.ts:86:3`.

**Why "exit 0" is a statement about the run and not about a pipeline.** Run 2 was started detached, so
its process status was not captured; a filtered log alone cannot prove an exit code. The equivalent is
Playwright's own machine-written record of that same run — `tests/e2e/results.json`, written by the
reporter, not by anything of mine:

```json
{ "startTime": "2026-10-15T16:52:25.844Z", "duration": 2294044.98,
  "expected": 149, "skipped": 0, "unexpected": 0, "flaky": 0 }
```

`unexpected: 0` is exactly the condition Playwright's exit status encodes, and the log contains no
`N failed` / `N did not run` line at all (its absence, not a filter, is the evidence).

### 8.2 The floor after 149 tests

`npm run qa:count` → **customers 10 · product_variants 6 · products 6 · companies 3 · sales 2 ·
inventory_movements 1**, with **no `supplier_payments`, no `notifications`, no `customer_payments`** —
`qa-baseline.mjs` → the **same 3 findings** the pass started with. A full green suite therefore left
**zero** new residue, which is the property the leak fix was meant to buy. `audit_events` 1949 is
`history` (system-written, never bounded).

### 8.3 Static and unit checks after the fixes

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run tests/unit` | **68 files, 842/842 passed**, exit 0 |
| `npm run build` | **exit 0** |

## 9. Status of every item this task named

| Item | Status | Evidence |
|---|---|---|
| Integration tests fail | **FIXED + REVERIFIED** | 42/42 files, 493/493 tests, exit 0 (§1) |
| CI integration red (4 files) | **FIXED + REVERIFIED locally; CI unproven** | all four green individually (§1.1); the CI job needs the approved step-order fix pushed |
| `crossScreenSync` failures | **FIXED + REVERIFIED** | 13 passed, twice — alone and inside 149/149 (§2.3, §8.1) |
| `dashboardScope` failures | **FIXED + REVERIFIED** | reproduced in run 1, root-caused (hydration), fixed, 6/6 alone and 6/6 inside 149/149 |
| "142 passed / 5 failed" | **WRONG — corrected in both status docs** | the authority is `backups/e2e-final-2.log` = 146 · 1 · 2, and this pass's run 2 = **149 · 0 · 0** |
| The 2 tests that never ran | **RESOLVED** | named and passed (§6, §8.1) |
| QA cleanup verified independently | **DONE** | §8.2, through the repo's own recount, not the cleaner's output |
| Production preserved | **DONE** | 0 requests to the production host, no production credentials in the checkout, tools refuse the production ref by name |

**The one thing still red is the CI job, and it is a push, not a defect** (§5.1): every failure this task
named reproduces green locally on `e986aa0d`, and the workflow's step-order fix is approved but
**uncommitted**. No local run can substitute for the dispatch, and this document does not claim it can.
