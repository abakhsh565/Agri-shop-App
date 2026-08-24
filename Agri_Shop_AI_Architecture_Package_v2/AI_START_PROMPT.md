# AI Coding Tool — Initial Prompt

You are the implementation agent for the Agri Shop Management System.

The repository contains the product requirements, architecture, security model, database/API baselines, decisions, an implementation roadmap, and — critically — `docs/LEARNINGS.md`, a running log of this specific project's past mistakes that you must consult and contribute to.

DO NOT start coding immediately.

First check `docs/DECISION_REGISTER.md` for any OPEN items (currently: D18, SMS/OTP provider choice). If an OPEN item blocks the requested task, stop and ask the product owner to resolve it — do not assume an answer.

Then read:
- 00_PROJECT_BRIEF.md
- AGENTS.md (in full — this is your operating manual, including the self-learning and token-efficiency protocols)
- docs/LEARNINGS.md (in full, since it should still be short at project start)
- docs/product/PRD.md
- docs/product/BUSINESS_RULES.md
- docs/DECISION_REGISTER.md
- docs/architecture/ARCHITECTURE.md
- docs/TECH_STACK.md
- docs/decisions/ADR-006-solo-builder-stack.md
- docs/architecture/BUILD_INSTRUCTION.md
- docs/security/AUTH_SPEC.md
- docs/security/SECURITY.md
- docs/security/THREAT_MODEL.md
- docs/database/DATABASE_MODEL.md
- docs/api/API_CONTRACT.md
- docs/testing/ACCEPTANCE_CRITERIA.md
- docs/DEFINITION_OF_DONE.md
- docs/decisions/ (remaining ADRs — note which are superseded)
- finalized UI/design assets

Then produce an `ARCHITECTURE_REVIEW.md` containing:
1. Requirement-to-screen mapping.
2. Role/permission matrix.
3. Domain/module map.
4. Database entity map (including `shop_id` on every table).
5. RPC/read-query map (per `API_CONTRACT.md`).
6. RLS policy plan per table.
7. Security threat/control map.
8. Missing or ambiguous requirements that require product-owner decisions — batch these into one list, ask once.
9. Proposed repository structure (Expo app + Supabase migrations/functions).
10. Build order (follow `ROADMAP.md` phases).
11. Risks and assumptions.

Do not invent missing business rules. Do not change locked PRD behavior.

After the architecture review is approved, scaffold the project (Expo + Supabase) and implement the application in vertical slices, one `ROADMAP.md` phase at a time. Every feature must include: RLS policies, an RPC/Edge Function for any write with business logic, tests (including an authorization test), error/loading/empty states, and documentation updates.

**Every time you make and fix a mistake during implementation, add an entry to `docs/LEARNINGS.md` before considering the task done. This is not optional.**

The repository is the persistent source of truth. Do not rely on prior chat context, and do not keep critical decisions or lessons only in conversation history.
