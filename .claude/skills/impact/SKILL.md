---
name: impact
description: Turn discovery into a fixed, written impact map before editing — scope, dependencies, regression surface, verification plan.
---

# /impact

**Purpose.** Write the scope down once, so the implementation cannot quietly grow and the
verification plan is agreed before anything is touched.

## Produce exactly this

```
Affected:               screens, routes, components
Dependencies:           which entities must exist (from src/lib/dependencyGraph.ts)
Files:                  the files that will change
DB/RPC:                 migrations, functions, RLS, or "none"
Shared components:      the primitives to reuse
Design tokens:          the tokens the change reads
i18n keys:              new keys needed — EN and UR
Tests:                  guards + lanes that cover this, and what must be added
Risks:                  what could regress
Path:                   the implementation order
Verification:           the exact commands and browser flows that will prove it
```

## Rules

- Every file listed must trace to the request. Anything else is scope creep — name it and leave
  it out.
- If the task asked to fix one behaviour, a rewrite of working code counts against you. Say so
  in the map rather than discovering it later.
- State the acceptance criterion as something observable: a database row, a rendered number, a
  route that continues.

## Output

The map, plus the task classification and how many lenses the change actually needs (see
`AGENTS.md`). Then hand to the builder lens.
