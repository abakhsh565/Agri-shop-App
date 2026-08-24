# Definition of Done

A feature/task is only "complete" when every applicable item below is true. The AI agent should check this list explicitly before reporting a task finished — not just when tests pass.

## Every Feature
- [ ] Matches `docs/product/PRD.md` / `docs/product/BUSINESS_RULES.md` exactly — no invented behavior.
- [ ] Relevant rows in `docs/DECISION_REGISTER.md` respected; no LOCKED decision silently overridden.
- [ ] Implementation plan was checked against `docs/LEARNINGS.md` before coding started.
- [ ] Server-side validation exists for anything the client sends (price, quantity, role, totals) — nothing trusted as-is from the client.

## If the Feature Touches Money or Inventory
- [ ] Implemented as a Postgres RPC/Edge Function, not a raw client table write.
- [ ] Wrapped in a single transaction — no partial-write states possible.
- [ ] Corresponding row added in `docs/testing/ACCEPTANCE_CRITERIA.md` if not already covered, and the relevant checkbox(es) verified.
- [ ] Historical/immutability rules respected (no hard delete, no retroactive price change).

## If the Feature Touches Access/Permissions
- [ ] RLS policy written and tested for every affected table — both the "should see" and "should NOT see" cases.
- [ ] In-function role check present even where RLS also applies (defense in depth).
- [ ] Negative test performed: an unauthorized role's direct API/RPC call is rejected, not just hidden in UI.

## UX Completeness
- [ ] Loading state handled.
- [ ] Empty state handled.
- [ ] Error state handled with a clear, non-technical message.
- [ ] Matches the finalized UI design for the relevant screen(s).

## Documentation & Memory
- [ ] Any mistake made and fixed during the task is logged in `docs/LEARNINGS.md` (mandatory, per `AGENTS.md`).
- [ ] Any new consequential decision is added to `docs/DECISION_REGISTER.md`.
- [ ] Any architecture change has a new/updated ADR in `docs/decisions/`.

## Before Marking a Roadmap Phase (not just a single feature) Complete
- [ ] All acceptance criteria for that phase's flows are checked in `docs/testing/ACCEPTANCE_CRITERIA.md`.
- [ ] Tested on a real Android device, not just an emulator.
- [ ] No secrets/service-role keys present in client code (manual grep check before phase sign-off).
