# AI Coding Tool — Initial Prompt

You are the implementation agent for the Agri Shop Management System.

The repository contains the product requirements, architecture, security model, database/API baselines, decisions, and implementation roadmap.

DO NOT start coding immediately.

First read:
- AGENTS.md
- PRD.md
- ARCHITECTURE.md
- BUILD_INSTRUCTION.md
- SECURITY.md
- THREAT_MODEL.md
- DATABASE_MODEL.md
- API_CONTRACT.md
- ADR-*.md (root)
- finalized UI/design assets

Then produce an `ARCHITECTURE_REVIEW.md` containing:
1. Requirement-to-screen mapping.
2. Role/permission matrix.
3. Domain/module map.
4. Database entity map.
5. API map.
6. Security threat/control map.
7. Missing or ambiguous requirements that require product-owner decisions.
8. Proposed repository structure.
9. Build order.
10. Risks and assumptions.

Do not invent missing business rules. Do not change locked PRD behavior.

After the architecture review is approved, scaffold the project and implement the application in vertical slices. Every feature must include backend validation, authorization, tests, error/loading/empty states, and documentation updates.

The repository is the persistent source of truth. Do not rely on prior chat context, and do not keep critical decisions only in conversation history.
