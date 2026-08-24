# Agri Shop Management System — Complete Handoff Package

This is the full set of documents required before handing this project to an AI coding tool (Claude Code, Codex, Cursor, etc.). Mapped to the standard pre-development checklist:

| # | Item | File |
|---|---|---|
| 1 | Project Brief | `00_PROJECT_BRIEF.md` |
| 2 | PRD (complete + out-of-scope) | `docs/product/PRD.md` |
| 3 | Decision Register | `docs/DECISION_REGISTER.md` |
| 4 | Tech Stack | `docs/TECH_STACK.md` |
| 5 | Business Rules | `docs/product/BUSINESS_RULES.md` |
| 6 | Data Model | `docs/database/DATABASE_MODEL.md` |
| 7 | Auth & Security Spec | `docs/security/AUTH_SPEC.md` + `docs/security/SECURITY.md` + `docs/security/THREAT_MODEL.md` |
| 8 | Architecture Document | `docs/architecture/ARCHITECTURE.md` |
| 9 | API/RPC Contract | `docs/api/API_CONTRACT.md` |
| 10 | Screens/UI Specification | `docs/product/PRD.md` §34–38 (full screen inventory, navigation map) |
| 11 | Acceptance Criteria / Test Plan | `docs/testing/ACCEPTANCE_CRITERIA.md` |
| 12 | AI Development Rules | `AGENTS.md` |
| 13 | Definition of Done | `docs/DEFINITION_OF_DONE.md` |
| 14 | Implementation Roadmap | `docs/ROADMAP.md` |
| 15 | Git repo + scaffold | `REPO_SCAFFOLD.md` (action to take, not just a doc) |

## Supporting Documents (beyond the core 15)
- `docs/decisions/` — ADRs, full reasoning behind each LOCKED decision.
- `docs/LEARNINGS.md` — living mistake/fix log the AI agent must consult and update.
- `docs/FUTURE_VISION.md` — post-MVP direction (franchise mode, iOS, multi-business, Farmer App/Marketplace) — context only, not built now.
- `docs/MONETIZATION.md` — placeholder, no pricing logic exists yet.
- `docs/BARCODE_INTEGRATION.md` — Phase 8 plan, committed next step after MVP.
- `docs/CHANGELOG.md` — history of package revisions.
- `docs/operations/DEVELOPMENT.md` — environments, CI, deployment, observability.
- `AI_START_PROMPT.md` — the literal first message to give your AI coding tool.

## ⚠️ One Open Decision Before Phase 1 Starts
**D18 in `docs/DECISION_REGISTER.md`** — SMS/OTP provider choice for phone-based login. This has a small real cost that isn't $0. See `docs/security/AUTH_SPEC.md` for the three options. Resolve this and mark it LOCKED before Auth implementation begins.

## Start Here, In Order
1. `00_PROJECT_BRIEF.md`
2. `docs/product/PRD.md`
3. `docs/DECISION_REGISTER.md` — resolve D18 first
4. `AGENTS.md`
5. `REPO_SCAFFOLD.md` — set up the actual repository
6. `AI_START_PROMPT.md` — hand this to your AI coding tool

## Important
The PRD (`docs/product/PRD.md`) remains the single authoritative product/business specification. `docs/LEARNINGS.md` becomes equally authoritative for this project's own history once it has entries. Nothing in this package expands MVP scope — it documents and organizes what was already decided, plus flags the one thing that genuinely still needs a decision (D18).
