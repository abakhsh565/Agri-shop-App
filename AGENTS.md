# AGENTS.md — engineering workflow

**Goal: the same verification quality with far less wasted work.** Speed comes from reusable
project knowledge, targeted discovery, and avoiding repeated context loading — never from
skipping tests, database checks, or browser verification.

Read this file, then `ARCHITECTURE.md` (project map), `DESIGN-SYSTEM.md`, `LANGUAGE-SYSTEM.md`.

**Preview rule — permanent (owner's instruction, 2026-10-25).** Whenever the owner asks to open
the app or the preview, open the **DEVELOPMENT** environment: the Vite server on `.env.local`
talking to the local Supabase stack, registered as the thread's preview. Never open staging or
production as the preview unless the owner names that environment in the same request. The QA
server (`--mode qa`, staging database) belongs to Playwright lanes and QA checks only. Details:
`.freebuff/run.md`.

**Environment workflow — permanent (owner's instruction, 2026-10-26).**

```
Development  →  Staging  →  Production
local stack     approved     approved, after staging passed
```

- **Development is the only active workspace.** Features, fixes and development testing happen
  there, against the local Supabase stack. Do not modify staging or production data.
- **Staging** receives a change only when the owner approves it in that request, and only for
  pre-production verification. Opening or verifying staging without being asked is a violation of
  this rule, not thoroughness.
- **Production** is released only after the owner approves it *and* staging verification passed.
- **A push is never promotion.** Pushing to GitHub runs checks; CI may *read* staging (ledger
  `verify`) and must never deploy, apply a migration, or change any environment.
  `deploy-production.yml` is dispatch-only for this reason, and
  `tests/unit/productionDeployGate.test.ts` fails if an automatic trigger or a migration `apply`
  returns to any workflow.
- **Code promotion stays separate from environment data and database operations.** No environment
  change happens without authorization.

---

## 0. Capability disclosure — read before claiming parallelism

**This repository does not ship a sub-agent runtime.** There is no `spawn_agent`, no agent
board, and no worker pool. A single agent works the task, switching between the role lenses
below. Any report that says "ran 4 agents in parallel" **unless the environment demonstrably
provides one** is fabrication.

So the roles are **lenses on one worker**, not separate processes. They exist so that
discovery, implementation, and verification are done deliberately instead of blurred together,
and so the same checks are run every time. Where the environment *does* offer real
parallelism, the roles map onto it directly:

```
Discovery → Impact map → [DB lens ∥ UI lens ∥ QA lens] → Builder → Targeted QA → Release
```

Parallelise only genuinely independent work. `Discovery → Builder` stays serial. Never send
every lens off to rediscover the same codebase — that is the exact waste this file prevents.

## 1. The loop

```
UNDERSTAND  →  CLASSIFY  →  IMPACT MAP  →  DECIDE WORKER COUNT  →  IMPLEMENT
            →  TARGETED VERIFY  →  REGRESSION  →  RELEASE CHECK
```

### CLASSIFY

`UI` · `Business Logic` · `Database` · `Security/RBAC` · `Data Integrity` · `i18n/RTL` ·
`E2E/QA` · `Build/Release` · `Cross-system` — a task may be several.

### IMPACT MAP — the anti-waste step

Produce this **once**, in the transcript, before editing. Every later lens consumes it instead
of re-reading the repository.

```
Affected:
Dependencies:            # from src/lib/dependencyGraph.ts — do not re-derive
Files:
DB/RPC:
Shared components:
Design tokens:
i18n keys:
Tests:
Risks:
Path:
```

### DECIDE WORKER COUNT

| Task size | Effort |
|---|---|
| One label, one spacing fix, one-line bug | Builder lens only |
| Normal feature / fix | Builder + targeted verification |
| Touches money, inventory, credit, RBAC, migrations, or destructive actions | add the **DB/Security** lens |
| Touches UI | add the **Design/i18n** lens |
| Cross-system | the full set, with the loops above |

Do not run every lens on every task. Single-worker execution is a valid, often faster outcome.

## 2. The lenses

**1 — Discovery / Impact.** Map the change before making it. Nothing is implemented here. Uses
`ARCHITECTURE.md` as the entry point instead of walking the tree.

**2 — Builder.** Make the change. Reuse existing primitives, tokens, stores and RPCs. Stay on
the impact map. Report:

```
Changed: / Why: / Dependencies: / Tests: / Regression risk:
```

**3 — DB / Security / Business Rules.** Required for Supabase, migrations, RPCs, constraints,
tenant isolation, RBAC, money, inventory, payments, destructive actions, idempotency, history.
The question is not "does the UI behave" but **"is this enforced at the correct layer?"** Look
for race conditions, duplicate and orphan records, historical-data corruption, authorization
bypass, direct RPC/API bypass, tenant leakage, and destructive-action safety. Does not design UI.

**4 — UI / Design system / i18n.** Required for any user-facing change. Reuse primitives and
tokens; one font; ramp sizes only; logical properties. New UI **automatically** enters the
EN + LTR / UR + RTL verification path — never wait to be asked for Urdu. Check hardcoded
strings, missing keys, overflow, directional icons, sheet/popover positioning, and every
empty/loading/error/success state.

**5 — QA / E2E.** Real browser, real database. Report `PASS` (with evidence), `FAIL` (with
evidence), or `UNKNOWN`. **Never convert UNKNOWN into PASS.** A failure is classified as an
implementation bug, a test bug, an environment problem, or a genuine pre-existing issue — with
proof, not assumption.

**6 — Release / Verification.** TypeScript, targeted tests, vitest, Playwright lanes,
production build, migration replay, QA cleanup with an independent row count, git state. For
Android, the release path is `.github/workflows/build-apk.yml`; do not silently substitute
another build path, and never declare success from a partial artifact.

## 3. Evidence handoff

Every lens returns machine-readable evidence, so the next step does not reread prose:

```
STATUS: PASS | FAIL | UNKNOWN
FINDINGS:
FILES:
DB/RPC:
TESTS:
RISKS:
NEXT:
```

**Permanent invariant: no actual evidence = no pass = no advancement.** A success toast, a
rendered component, a compiled file, or a source reading is not evidence that behaviour is
correct.

## 4. Guard-first verification

This repo already encodes its rules as executable guards. Use them instead of re-checking by
hand:

```bash
npx tsc --noEmit
npx vitest run                     # includes the guards below
npx playwright test                # or: npm run test:e2e:lanes
npm run build
```

`tests/unit/` guards: `typeScaleGuard` (one type scale, one font), `listPrimitiveGuard` (one
list implementation), `importantShimGuard` (the `!important` compatibility layer is deleted:
it fails on a new shim, on a physical direction utility, and on a remapped literal colour),
`i18nCoverage`
/ `i18nParity` / `microcopy` (the language system), `reentrancyGuard` (repeated submission),
`migrationReplayability`, `qaFixtureKeepList`, plus the locked business rules
(`overdueCredit`, `reminderEscalation`, `signalEngine`, `signalSuppression`).

When you add a rule that a future task could silently break, **add a guard**, and prove the
guard is non-vacuous by injecting the failure once and watching it catch it.

## 5. Speed measurement

For any multi-lens task, report honestly:

```
Lenses used:  Parallel:  Sequential:  Elapsed:  Blocked:
Repeated discovery avoided:  Tests executed:
```

If a single worker was faster, say so. That is a successful outcome, not a failure.

## 6. Task-size rule

Do not manufacture process for small work, and do not skip verification for large work. The
correct shape is the smallest set of lenses that still produces real evidence for the change.

---

## 7. Speed path (tooling that enforces these rules)

```bash
npm run resume        # checkpoint: branch, HEAD, server mode, lane greens, next command
npm run preflight     # 5s: git state, --mode qa server, DB reachable, fixtures, QA row count
npm run verify:plan   # computed tier + which lanes would run or be skipped
npm run verify        # smallest sufficient gate; Tier 2 is forced, never downgraded
npm run verify:full   # force Tier 2, no lane caching
```

Tiers: **0** docs → tsc + build · **1** UI/copy → tsc + unit guards + affected lanes + build ·
**2** money/RBAC/migrations/destructive → full vitest + canonical lanes (never skipped) +
affected lanes + build + independent QA row count. A lane is skipped only when it was green and
every file its `scripts/dev/lane-map.json` globs cover is byte-identical. `--tier` may only
**raise** a computed tier. No APK during development or QA loops; when requested it is built
only through the decided GitHub Actions path. Full detail: `ENGINEERING_OS_STATE.md` §0b.

---

## 8. Feature registry & change-impact (permanent, enforced)

`FEATURE-MAP.md` + `feature-registry.json` answer *what exists, what depends on it, what could a
change affect, and what evidence proves the affected behaviour is safe*. Start any impact map
there and in the authorities it points to (`SCREEN-INDEX.md`, `dependency_graph.json`,
`scripts/dev/lane-map.json`, `PHASE_2_BROWSER_SAFETY.md` §17) instead of re-reading the tree.

Every new feature and every meaningful modification enters the workflow **automatically** —
nobody has to ask "check what this might break":

```text
1. Identify the feature being changed.
2. Identify its direct dependencies.
3. Identify the features, screens, and business rules that depend on it.
4. Identify affected database tables, RPCs, and APIs.
5. Identify affected permissions and security boundaries.
6. Identify affected EN/LTR and UR/RTL surfaces.
7. Identify affected tests and evidence.
8. Determine which existing evidence remains valid.
9. Invalidate only the evidence genuinely affected by the change.
10. Implement the change.
11. Run targeted verification.
12. Run regression for the affected dependencies.
13. Update the feature, dependency, and evidence records.
```

Evidence statuses: **VALID · INVALIDATED · REPLACED · FIXED + REVERIFIED · NOT APPLICABLE ·
BLOCKED**. Do not rerun a suite merely because a task started (reuse rule: purpose, context,
risk, implementation and dependencies unchanged). `npm run verify:plan` computes the affected
lanes; `npm run registry:build` regenerates `SCREEN-INDEX.md` and runs the registry guard.
`tests/unit/featureRegistryGuard.test.ts` fails when the registry drifts from the router,
the tests, the dependency graph or the workflow document.

---

## 9. The permanent chain — mandatory for every agent

```
dev  ->  (PR)  ->  staging  ->  (PR)  ->  main  ->  production (gated dispatch)
```

The chain is the pipeline. Nothing promotes by hand: `staging` is where the app is verified by
the real QA/E2E lanes, and `main` is what production is deployed from. `release/merge` and
`staging-snapshot` are retired names; do not push to either.

**Work only on `dev`.** One small batch per commit. A branch that is not `dev`, `staging` or `main`
runs no CI, so work parked on one is exactly how 19 guard failures accumulated unseen. If a task
arrives on another branch, land it on `dev` first.

**Before every commit, in this order:**

```bash
npx tsc --noEmit          # must print nothing
npx vitest run tests/unit # must be 0 failed — report the exact counts in the commit body
```

A commit message states what changed, why, and the counts it was verified with. "Tests pass"
without a number is not evidence.

**A migration and its disposition land in the same commit.** Every new file in
`supabase/migrations/` must have a row in `docs/PRODUCTION_MIGRATION_PLAN.md` §5 saying what
production does with it (`batch N`, gap migration, production-shaped variant, or "not applicable")
— `tests/unit/productionMigrationPlan.test.ts` fails otherwise. Never edit a migration that is
already recorded: add a forward file.

**Never push directly to `staging` or `main`.** Promotion is a pull request that carries green
`Gates (tsc · unit guards · safety proofs · build)` and, for `staging` and `main`, green `QA`
(+ `E2E lanes against QA`). A failed or missing check is not an approval, and a dispatch that
skips the gate is a release with no evidence.

**Environment writes are not part of a code batch.** Applying migrations to staging happens in
`Deploy staging — migrate, build, report URL` (push to `staging` or its dispatch), and to
production only through `Apply migrations to production (gated batch)`. Data never moves between
the three databases: dev is the Docker stack on this machine, staging is `bpybjrjenwccowvtrevu`,
production is `gkswcfljxlutkfdvvqng`, and no tool here copies rows from one to another.
