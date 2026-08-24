# Build Instruction for AI Coding Agent (v2)

You are joining an existing product with a locked PRD, finalized UI designs, and a project memory file (`docs/LEARNINGS.md`) that records past mistakes on this exact project. You are not starting cold even if this is your first session — the repo is.

## Stage 1 — Read (Efficiently)
Read fully, once per session:
- `/AGENTS.md`
- `/docs/architecture/ARCHITECTURE.md`
- `/docs/decisions/ADR-006-solo-builder-stack.md`

Read the relevant section only, scoped to the task:
- `/docs/product/PRD.md` (relevant section)
- `/docs/LEARNINGS.md` (entries tagged with the module you're touching)
- `/docs/security/SECURITY.md` and `/docs/security/THREAT_MODEL.md` (relevant section)
- `/docs/database/DATABASE_MODEL.md` (relevant entities)
- `/docs/api/API_CONTRACT.md` (relevant functions)
- finalized design assets for the screens in scope.

## Stage 2 — Analyze
Produce a short gap analysis for the task at hand only (not the whole product, unless this is the very first session):
- PRD requirement → screen(s) in scope.
- screen → role → RPC function / read query needed.
- RLS policies needed for any new/touched table.
- anything ambiguous — batch these questions, ask once.

Do not invent business rules.

## Stage 3 — Plan
Write a short bullet-point implementation plan before coding. Check it against `LEARNINGS.md` — does this plan repeat a past mistake? If unsure, say so before proceeding.

## Stage 4 — Implement by Vertical Slice
Implement one complete flow at a time: UI → RPC/query call → Postgres function → RLS check → migration → tests → error/loading/empty states.

Priority order matches `ROADMAP.md` phases — do not build Phase 4 features before Phase 1–3 are solid, even if asked for a "quick" out-of-order feature; flag the ordering risk instead and let the product owner decide.

## Stage 5 — Quality Gate
Before calling a feature complete:
- tests pass (including an authorization test: does an Employee-role call correctly fail/filter on Admin-only data?)
- no secrets/service-role keys in client code
- financial/inventory writes go through RPC functions, not direct client writes
- business invariants tested (no negative stock, no hard deletes, historical price preserved)
- UX states handled (loading/empty/error)
- documentation updated if architecture changed (new ADR)
- **`docs/LEARNINGS.md` updated if any mistake occurred and was fixed during this task**

## Stage 6 — Handoff
A new coding agent, or the same agent in a new session, must be able to continue correctly by reading the repository — including learning from mistakes already logged in `docs/LEARNINGS.md`. Never keep a decision or a lesson only in chat history.
