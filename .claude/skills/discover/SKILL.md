---
name: discover
description: Front-load project knowledge before any change — screens, entities, data layer, stores, primitives, i18n, guards. Use at the start of any non-trivial task.
---

# /discover

**Purpose.** Stop every task from re-reading the codebase. Produce one compact picture the rest
of the work consumes.

## Read, in this order — do not improvise a tree walk

1. `ARCHITECTURE.md` — the project map. If it already answers the question, stop here.
2. `DESIGN-SYSTEM.md`, `LANGUAGE-SYSTEM.md` — if the task touches UI or copy.
3. Only then open source, and only the files the map named.

## Collect

```
Routes / screens touched:
Entities + their real dependencies:     # src/lib/dependencyGraph.ts is the authority
Data: tables, RPCs, migrations, RLS
State: which store owns what
Shared components already available:    # src/components/ui/ — never hand-roll these
Design tokens that apply:
i18n keys that apply:
Guards that cover this area:            # tests/unit/*
Existing tests: unit + e2e lanes
```

## Rules

- Never assume a dependency or a business rule — read the router, the validator, or the RPC.
- Check for an **existing** implementation before proposing a new one. Most of what feels
  missing already exists somewhere; find it or prove it does not.
- Report what you did **not** find as `UNKNOWN`, never as absent.

## Output

The impact map (`/impact`), ready to hand on. Nothing is edited in this skill.
