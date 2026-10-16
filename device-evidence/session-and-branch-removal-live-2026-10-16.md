# Reload/session persistence and branch removal — live browser evidence, 2026-10-16

**Branch** `ci-proof/full-tree` @ **`8ee19eb3`** (0 ahead / 0 behind `origin`) · **QA project**
`bpybjrjenwccowvtrevu` — every run below printed `[EnvGuard] Environment verified: bpybjrjenwccowvtrevu`.
The server was started as the repository's own QA server
(`npx vite --mode qa --host 0.0.0.0 --port 5173`), whose log reads
`[EnvGuard] serving STAGING → bpybjrjenwccowvtrevu (otp: demo, key verified)`. **Production was never
read or written.**

**The two rows this answers, verbatim:**

* `staging-checklist-status-2026-10-15.md` §4 — *"Reload and session refresh preserve correct state"*
  (`UNKNOWN`, *"the reload leg is what workstream item 10 is blocked on"*).
* the same checklist's §11 security row and `feature-registry.json`'s `branch-tenant-scope` evidence —
  the **browser-driven branch-removal flow**, the one leg the security pass left `BLOCKED`
  (`security-data-isolation-2026-10-16.md` §6.1).

**What was written.** Two lanes, nothing rebuilt and no product flow changed:

| File | Tests | What it drives |
|---|---|---|
| `tests/e2e/sessionRefresh.spec.ts` | 2 | the QA shop's own owner on real business rows: a customer's name and balance, and a permission-gated route, read from the database and compared with what is on screen — before, after `page.reload()`, and after a **new page in the same profile** (the app opened again); then the isolated tenant's active branch, switched through the app's own switcher, checked in the database and in the switcher's selected row across the same reload and reopen. |
| `tests/e2e/branchRemoval.spec.ts` | 2 | the owner archiving a branch in a real browser: no archive action on the main branch, the confirmation naming the branch and stating the real consequence, the confirm button refusing to proceed until a reason is typed, the archive itself, and the resulting row (`is_active = false`, row still present, main branch and the business untouched); and an employee never being offered that surface at all. |

One source change, for the lane only: the archive dialog's reason field in
`src/pages/admin/more/BranchDetailPage.tsx` now carries `data-testid="branch-archive-reason"`. The
shared `Input` renders a bare `<input>` with **no `type` attribute**, so a `input[type="text"]`
selector matches nothing — that is what the first run below found.

---

## 1. Run 1 — both files, all four tests

```bash
npx playwright test tests/e2e/sessionRefresh.spec.ts tests/e2e/branchRemoval.spec.ts --reporter=list
# 1 passed · 3 failed (1.1 m)
```

`device-evidence/logs/session-branch-lanes-2026-10-16-run1.log`. The three failures were classified,
not retried blindly:

1. `branchRemoval.spec.ts:80` — **test bug.** `locator.fill` timed out waiting for
   `input[type="text"]:visible`: the reason field exists, but the shared `Input` renders
   `<input>` with no `type` attribute, so the selector matched nothing at all. Fixed by giving the
   dialog's field its own testid and asserting on that. (The lane's other assertions before that
   line — the confirmation copy and the disabled-before-a-reason state — had passed, so the
   confirmation contract itself was already measured.)
2. `sessionRefresh.spec.ts:93` and `:152` — **environment, not product.** Both failed at
   `page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/login`: the QA dev server had
   gone away mid-run (`curl` → HTTP 000; log `grep -c ERR_CONNECTION_REFUSED` = 2, i.e. exactly the
   two opposite ends of the run that had lost the server). The cause of the missing server was
   itself measured rather than guessed: the restart command first used was `npm run dev:qa`, which
   **does not exist** in `package.json` (`npm error Missing script: "dev:qa"`); the repo's own
   server is `npx vite --mode qa --host 0.0.0.0 --port 5173` (`scripts/dev/preflight.mjs:47`). It
   was started that way and readiness was proven by `HTTP 200` on `/login` plus the EnvGuard stamp
   above, not by a startup banner.
4. `branchRemoval.spec.ts:133` (an employee is never offered the archive surface) **passed in run 1
   and was not run again** — a green result is not re-measured because a neighbour failed.

## 2. Run 2 — only the three tests that had failed

```bash
npx playwright test tests/e2e/sessionRefresh.spec.ts tests/e2e/branchRemoval.spec.ts \
  --grep "owner archives a branch|Session refresh" --reporter=list
# 2 passed · 1 failed (1.1 m)
```

`device-evidence/logs/session-branch-lanes-2026-10-16-run2.log`. `branchRemoval:80` and
`sessionRefresh:93` are now green. The remaining failure — `sessionRefresh:152`, *the branch the
server says is active survives a reload and a reopen* — is a **bug in the lane's own precondition,
found by reading the schema instead of assuming it**:

> `expect(await activeBranchInDb(ISO_OWNER.id)).toBe(defaultBranch.id)` → received **`null`**,
> message *"the fixture did not start on its default branch"*.

The lane set that precondition with `UPDATE user_active_shops SET branch_id = … WHERE user_id = …`,
which matched **0 rows**: `user_active_shops` is one row per user (`user_id` PRIMARY KEY, 0149) whose
`branch_id` arrived in 0188, and it is created only by the server's own writers
(`set_active_branch` / `create_shop_for_me`) — the isolated tenant's owner had never had a row. The
read then reported `null`, which would have read as the app having lost the branch. The precondition
now uses the same UPSERT shape `set_active_branch` itself uses (`INSERT … ON CONFLICT (user_id) DO
UPDATE`), and the assertions after it are unchanged.

## 3. Run 3 — only that test again

```bash
npx playwright test tests/e2e/sessionRefresh.spec.ts \
  --grep "the branch the server says is active" --reporter=list
# 1 passed (25.3 s · 33.9 s wall)
```

`device-evidence/logs/session-branch-lanes-2026-10-16-run3.log`. **Net across the three runs: 4/4
green**, and the only tests ever re-run are the ones that failed.

## 4. What each test now proves, and against what

* **Data on screen survives a reload and a reopen** — the customer row's name and `Rs.` balance are
  recomputed from `customers` in QA and required to be on `/admin/customers` before the reload, after
  `page.reload()`, and in a freshly opened page in the same profile; the fixture count is re-read
  afterwards, so a screen that silently changed data fails too.
* **Effective access survives a reload and a reopen** — the owner still reaches the permission-gated
  `/admin/settings` route by URL after both.
* **The working branch is server-owned and survives both** — after switching to a second branch
  through the app's own switcher (the real `set_active_branch` RPC), `user_active_shops.branch_id` is
  asserted to be the new branch, then re-asserted after `page.reload()` and after a new page; the
  switcher's own row must carry `aria-selected="true"` for it. The lane's `afterAll` restores the
  default branch and deletes its branch by id, reading back **0 rows left behind**
  (`[sessionRefresh] extra branch rows left behind: 0` in all three logs).
* **Archiving a branch through the screen** — the confirmation is asserted by its own copy, the
  confirm button by its disabled state, and the outcome in the database: `is_active = false`, the
  branch row still exists (`archiving must not erase the business`), the tenant's main branch
  untouched, and the `shops` row still present. The success toast is asserted before the database
  read, so the screen and the rows cannot disagree silently.

**Ownership.** Both lanes write only inside their own scope: the isolated tenant (`WRITE_TENANT`) for
everything branch-related, and one branch row each that is deleted by id with a read-back. They
register no `trackOwned` rows because they create none through the app's write RPCs; the harness says
so itself — `[QA CLEANUP] nothing owned by this run — no deletes issued`.

**What these lanes deliberately do NOT repeat** (they consume it instead): the archive refusals
(`BRANCH_HAS_STAFF`, `MAIN_BRANCH`, foreign branch) and the RPC half of branch removal are measured in
`tests/integration/accountDeletion.test.ts` and `branchIdentityBoundary`; the cross-branch read/write
boundary in `branchScopeEnforcement`; the per-role matrix in `securityMatrix`. The mocked-transport UI
contract lives in `branchFlowCorrections.spec.ts`; these lanes are the live half that file could not
be, which is also why `docs/BRANCH_FLOW_CORRECTIONS_VERIFICATION.md` is left as the dated report it is.

## 5. The guards the new specs touch — one run, green

```bash
npx vitest run tests/unit/playwrightReuseGuard.test.ts tests/unit/featureRegistryGuard.test.ts \
  tests/unit/e2eCleanupOwnership.test.ts tests/unit/qaFixtureKeepList.test.ts
#  Test Files  4 passed (4)      Tests  63 passed (63)      exit 0
```

`playwrightReuseGuard` (the lanes must reuse the running certified QA server rather than start their
own — both logs show `[e2e] reusing the running server … verified this app in QA mode`),
`featureRegistryGuard` (registry ↔ router / tests / dependency graph coherence),
`e2eCleanupOwnership` and `qaFixtureKeepList`. `scripts/dev/lane-map.json` was deliberately **not**
edited: its `_note` makes an unmapped or newly added spec run whenever any source changed, and the
map's explicit entries are narrower than these two lanes' real surface — a wrong narrow entry could
skip a lane that should run, which is the failure mode the note exists to prevent.

## 6. Limits, stated rather than smoothed

* **Chromium, one profile, one viewport (Playwright's default).** Nothing here is device evidence; the
  Android pass remains the owner's step (§10 of the checklist, `adb devices` empty on this machine).
* **Urdu/RTL is not exercised by these two lanes.** Copy is asserted in English; the bilingual
  behaviour of both screens is covered by the language lanes and guards elsewhere.
* **No manual/interactive session was driven** — every result above is a lane run, and each one is
  reproduced here with its command and outcome. The raw logs are written to `device-evidence/logs/`,
  which `.gitignore` excludes (`logs/`, line 13) — the same convention the earlier security logs follow —
  so the transcripts in this record are what travel with a commit; the log files stay on this machine.
* `sessionRefresh` test 1 asserts the *owner's* access survives; it does **not** claim that a
  *revocation* survives a reload, which is a different claim already held by
  `rbacLifecycleAndSessions` at the integration level.

## 7. Records updated by this pass

* `feature-registry.json` — `branch-tenant-scope`: the two lane files added to `tests`, the
  `BLOCKED` browser-leg evidence entry replaced with the measured one, and the risk caveat that still
  named the browser flow as unmeasured corrected.
* `device-evidence/staging-checklist-status-2026-10-15.md` — §4's reload/session row, §4's archive
  caveat, §11's remaining-gap sentence, the "still open" list and the recomputed counts.
* `device-evidence/security-data-isolation-2026-10-16.md` — §0's summary and §6 item 1 (the leg it
  named as unmeasured) closed with this record.
* `device-evidence/staging-blockers-2026-10-15.md` — a dated note under the workstream's own 11-item
  list, whose rows 2, 7 and 10 were blocked on exactly this browser/reload window.
