# AGENTS.md — engineering workflow

**Goal: the same verification quality with far less wasted work.** Speed comes from reusable
project knowledge, targeted discovery, and avoiding repeated context loading — never from
skipping tests, database checks, or browser verification.

Read this file, then `ARCHITECTURE.md` (project map), `DESIGN-SYSTEM.md`, `LANGUAGE-SYSTEM.md`.

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
