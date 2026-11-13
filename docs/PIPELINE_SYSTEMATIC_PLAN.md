# The pipeline, fixed from the root up

**What this is.** The ordered plan for making development → staging → production fast and reliable,
written after three promotion attempts in one day went red on the staging job for reasons that were
not product defects. It is a sequence of small tasks, each one removed from the *root* cause rather
than from the symptom in front of it. Every task is tiny enough to prove on its own, and no task
starts before the one below it is green and recorded.

**What it is not.** It is not a refactor of the product, and it does not change what the app does.
Every task below touches tests, tooling, or CI — never `src/`.

---

## 1. The root cause, stated once

> **The integration suites assert against state they do not own, inside one database that every run
> shares.**

Everything painful follows from that single sentence:

| Symptom seen today | Why it is the same cause |
|---|---|
| `branchScopeEnforcement` died at `expect(warehouseBranch).toBeTruthy()` | It read `branches.rows[1]` from the seeded shop. QA's second branch had been deactivated by something else, so the list was short. |
| `rbacFoundation` failed with `DUPLICATE_CUSTOMER_PHONE` | Its `?? mainBranch` fallback turned a branch-denial test into a success test, and that success created a customer the file never removed. Its *own* previous run poisoned it. |
| Eight files failing with `NOT_AUTHORIZED: tenant access denied` | A local run and a CI run were mutating the same database at the same time. The suites delete each other's fixtures mid-assertion. |
| Every attempt costs ~10–13 minutes | 43 files, one database, `--fileParallelism=false`. Feedback is the cost of a shared row store. |
| Failures read like product bugs | The error is an authorization message, not "your fixture is missing". The signal points at the wrong layer. |

**Measured today, for the record:** the CI QA job itself took **13m03s**, **10m31s** and **9m26s**
across the three promotion attempts (the last one green); three red attempts before that green;
the fixture audit (below) takes **1.3 s** and named the three files that still carry the defect.

---

## 2. Rules this plan is held to

1. **One database, one writer.** CI is the writer. A local run against QA while CI is running is a
   bug in the process, not a slow afternoon — it cost two cycles today.
2. **Own your rows.** A suite may only assert on rows it inserted in that file, under ids it declares.
   Reading the seeded tenant's live shape is borrowing.
3. **A guard per class, not a fix per file.** When a failure shape appears twice, the next task is a
   check that makes it impossible, not a third manual repair.
4. **Repeat before parallel.** Green twice in a row on the serial run is the precondition for
   sharding. Parallel tests on a flaky suite multiply flakiness.
5. **Measure, then claim.** Time saved is a measured number, before and after, or it is not reported.
6. **Small and ordered.** Each task below is a single commit with one proof. No task starts until the
   previous one is green.

---

## 3. The five stages, and where this plan touches them

| Stage | What it means here | What this plan changes |
|---|---|---|
| 1. Development | local stack, dev server, fast local checks | adds a 1-second fixture audit to the local loop |
| 2. Automated checks | tsc, unit guards, integration suites | makes the suites repeatable, then faster |
| 3. Staging / QA | the QA Supabase project + CI QA job | one writer, owned fixtures, measurable wall clock |
| 4. Production | gated Vercel deploy | unchanged — already gated on a green CI run for the exact commit |
| 5. Evidence | what proves each step | every task below names its proof; no step advances on a reading |

---

## 4. The sequence — smallest first, root upwards

Each task lists: **what**, **why it is the root**, **proof**, **cost**, **unblocks**.

### P0 — One writer for QA (stop the bleeding)
**What.** A lock/preflight that refuses to start an integration run when another run (CI or local)
holds QA. Concretely: a `qa_run_lock` row or an advisory lock taken by the runner, plus a preflight
check that prints "another run holds QA, started at …" and exits before touching a table.
**Why root.** Today's cascade of eight failures came from two writers. No amount of fixture fixing
survives concurrent deletion.
**Proof.** Start two runs; the second exits non-zero with that message, and the first's result is
unaffected. Then: one full API run with a local attempt in parallel — the local attempt refuses.
**Cost.** ~1 h. **Unblocks.** Every later measurement, because a flaky measurement measures nothing.

### P1 — The three flagged suites own their branches
**What.** Repair `rbacEnforcement`, `rbacRoleLifecycleTargeted`, `securityMatrix` the same way the
two already-fixed files were repaired: create their own branch, use its id, delete it and read back
in cleanup, delete their own customer rows at both ends.
**Why root.** These are the exact files that read a shared row list by position.
**Proof.** `npm run audit:fixtures` reports **0 RISK** (today: 3), and each file passes twice in a
row on QA — sequentially, never concurrently.
**Cost.** ~45 min. **Unblocks.** P3.

### P2 — Make the class impossible to re-introduce
**What.** Wrap `scripts/dev/audit-fixture-ownership.mjs` in a unit guard
(`tests/unit/fixtureOwnership.test.ts`) so CI's *gates* job — the cheap one — fails in seconds when a
new suite borrows a shared row. Add the patterns as they appear; keep the audit's `--strict` exit.
**Why root.** A rule that lives in a document is a preference. A rule that fails a check is a rule.
**Proof.** Inject `branches.rows[1]` into a scratch file → guard fails; remove it → guard passes.
Non-vacuous by construction, and the guard costs ~1.3 s in the gates job, not 13 minutes.
**Cost.** ~30 min. **Unblocks.** Every future feature.

### P3 — Prove repeatability before touching speed
**What.** Run the full integration directory **twice, back to back**, with no local interference, and
record both results and their durations. If anything is red, it is a P1 miss — fix it here, not later.
**Why root.** The user's real complaint is "it always ends red". Until two consecutive clean runs are
recorded, speed work is premature.
**Proof.** Two run URLs / two logs with all files green and a recorded wall clock (expected ~12 min
each).
**Cost.** ~30 min of wall clock, mostly waiting. **Unblocks.** P4, and only then.

### P4 — Parallelise, and measure the saving
**What.** Shard `tests/integration` across N jobs *by declared tenant/ownership* (safe only because P1
made ownership real), run the shards concurrently, and compare wall clock against P3's number.
**Why here.** Parallelism over borrowed state is how flaky suites become flaky pipelines.
**Proof.** Same total file count, same green result, wall clock before/after printed side by side —
the claim is the difference, not the config.
**Cost.** ~2 h. **Unblocks.** Feedback under ~4 min, which changes how work is done.

**Outcome (2026-10-19).** Sharding across *processes* is not available: the QA advisory lock is claimed once
per vitest process and a second process is refused it. The experiment therefore ran **inside one process**
(`--fileParallelism=true --maxWorkers=4`) on a group of 7 files whose writes were proven disjoint at
statement level: **51.5s vs 139.1s wall, 102/102 tests green, baseline unchanged at 6574 rows, 0 residue,
0 advisory locks held**. The serial default is unchanged — a parallel default needs a guard pinning the
per-file classification first (global-aggregate readers and the `incident_rate_limits` pair must never
overlap a writer). Detail: `ENGINEERING_OS_STATE.md`, section "P4 — bounded concurrency experiment".

### P5 — The missing end-to-end proof
**What.** Run the E2E lanes for a real promotion commit (they were skipped today because the QA job
went red first and the deploy path runs on push, where lanes do not run), fix whatever they find, and
record the run. Consider triggering them on the release branch's merge commit rather than only on PRs.
**Why separate.** They were never executed for today's release; that is an unproven stage, not a
passing one.
**Proof.** A lane run URL against QA, green, attached to the commit that is on `main`.
**Cost.** ~1 h (mostly the lane run itself). **Unblocks.** An honest claim of full-stack verification.

### P6 — The Android build failure, on its own thread
**What.** Investigate `build-apk.yml`'s failure on `d682a6d` independently. It is not on the web
release path and must not be mixed with it — that mixing is how a web hotfix becomes a 47-minute APK
question.
**Why separate.** The APK has its own signing secrets and its own failure modes.
**Proof.** A run URL, and either a green build or a named, reproduced cause.
**Cost.** ~1 h. **Unblocks.** Nothing on the web path — that is the point.

### P7 — Make the fast path the default
**What.** Tier-aware `verify`: a UI/copy change should pay for `tsc` + unit guards + the audit +
affected lanes, and *not* for the full 43-file integration directory; a money/RBAC/migration change
keeps the full run. The full run stays mandatory where it earns its 13 minutes.
**Why last.** It is only safe once the suites are deterministic and the guard is in place.
**Proof.** `npm run verify:plan` on a copy-only change lists no integration run and explains why; on
a migration change it lists the full run.
**Cost.** ~2 h. **Unblocks.** The day-to-day speed the whole plan exists for.

---

## 5. The order, in one line

```
P0 one writer → P1 three suites own their rows → P2 guard → P3 green twice
→ P4 shard & measure → P5 E2E proof → P6 APK, separately → P7 tier-aware default
```

Anything that starts before the step to its left is finished is the reactive loop this plan exists to
end: fix a file, see a different file fail, fix that, see the first one fail again.

---

## 6. What is needed from the owner

1. **A decision on QA drift.** Is the seeded shop's "Warehouse" branch meant to stay active? If yes,
   archiving it is the bug and suites may keep reading it; if no, own-your-branch is correct (this is
   what P1 assumes).
2. **Approval to spend the sequence above** — roughly one focused day end to end, with P0–P3 landing
   before any speed claim.
3. **One operational rule, accepted on both sides:** nobody runs the integration directory against QA
   while CI is running it. The lock in P0 enforces it; the rule explains it to a future reader.

Nothing else is blocked on credentials: Vercel, QA and production secrets are all present.

---

## 7. Evidence ledger for this plan

| Task | Proof artifact | State |
|---|---|---|
| Audit tool (pre-work) | `npm run audit:fixtures` → 1.3 s, 43 files, 39 OK / 1 WARN / 3 RISK | **done, uncommitted** |
| P0 | second concurrent run refuses, first unaffected | not started |
| P1 | audit reports 0 RISK; each file green twice | **done 2026-10-19** — `audit:fixtures --strict` exits 0 (42 OK / 1 WARN / **0 RISK**, was 3 RISK/exit 1); `rbacEnforcement`, `rbacRoleLifecycleTargeted` and `securityMatrix` now own their branch fixtures and ran green twice consecutively (3/3 files, exit 0); tsc exit 0, post-run baseline BASELINE OK at an unchanged 6574 rows, owned branch rows 0. Logs `backups/phase3-p1-2026-10-19-*.log` |
| P2 | guard fails on an injected `branches.rows[1]` | not started |
| P3 | two consecutive full-directory runs, green, timed | **done 2026-10-19** — `npm run test:integration` exit 0 twice (43/43 files, 519/519 tests, 759.81s then 705.17s), each followed by `qa-baseline.mjs` exit 0 with BASELINE OK; logs `backups/phase3-closeout-2026-10-19-integration.log` and `backups/phase3-p3-run2-2026-10-19-integration.log`. EC8's E2E-dependent steps remain unmet, so Phase 3 is still open |
| P4 | wall clock delta, same green result | **done as a bounded experiment 2026-10-19** — one-process file parallelism on 7 proven-disjoint files with 4 workers: **139.1s → 51.5s wall** (vitest 135.11s → 44.60s), 7/7 files and 102/102 tests exit 0 in both runs; baseline OK at an unchanged 6574 rows before and after, 11 residue probes at 0, 0 advisory locks held. Logs `backups/phase3-p4-group-serial-2026-10-19.log`, `backups/phase3-p4-group-parallel4-2026-10-19.log`. **Default stays serial** (`vitest.integration.config.ts` unchanged). The classification guard is now in place: `tests/unit/integrationParallelGuard.test.ts` (11 tests) freezes the seven approved files, names the 13 must-stay-serial files with categories and reasons, enforces the `incidentFoundation`/`resolutionMemory` exclusion, fails closed for unclassified files, and forbids any repo-owned command from enabling `--fileParallelism`; focused set 3 files / 39 tests exit 0, and an injected `securityMatrix` entry failed the guard (exit 1, named reason) before the file was restored byte-identically (sha256 match) |
| P5 | E2E lane run URL for a `main` commit | not started |
| P6 | APK run URL, green or a named cause | not started |
| P7 | `verify:plan` output on two contrasting changes | not started |

No row above may read "done" without its artifact.
