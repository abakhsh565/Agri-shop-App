# Build Instruction for AI Coding Agent

You are joining an existing product with a locked PRD and finalized UI designs.

## Stage 1 — Read
Read:
- `/AGENTS.md`
- `PRD.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `THREAT_MODEL.md`
- `DATABASE_MODEL.md`
- `API_CONTRACT.md`
- `ADR-*.md (root)`
- finalized design assets supplied separately.

## Stage 2 — Analyze
Produce a gap analysis:
- PRD requirement → screen.
- screen → role → use case/API.
- API → domain module → database entities.
- security permission matrix.
- missing/ambiguous requirements.

Do not invent business rules.

## Stage 3 — Architecture Review
Before production implementation:
- confirm stack
- confirm module boundaries
- confirm database model
- confirm authorization matrix
- confirm transaction boundaries
- confirm testing plan
- confirm deployment plan

If a decision conflicts with the PRD, stop and document the conflict rather than silently changing behavior.

## Stage 4 — Scaffold
Create the agreed repository structure, CI checks, environment templates, database migrations, API/OpenAPI foundation, mobile foundation, and test foundation.

## Stage 5 — Implement by Vertical Slice
Implement one complete business flow at a time, including:
UI → API → domain logic → database → authorization → tests → error/loading/empty states.

Priority:
1. authentication/roles
2. company/product/customer foundation
3. inventory/purchases
4. sales/credit
5. payments
6. returns
7. dashboards/reports

## Stage 6 — Quality Gate
Before calling a feature complete:
- tests pass
- authorization tests pass
- no secrets exposed
- business invariants tested
- UX states handled
- documentation updated
- ADR added if architecture changed

## Stage 7 — Handoff
A new coding agent must be able to continue by reading the repository. Never keep critical decisions only in chat.
