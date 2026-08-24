# Agri Shop Management System — AI Engineering Instructions

## Purpose
This repository is the implementation of the Agri Shop Management System defined by the Final PRD and finalized UI designs. This file is the operating manual for any AI coding tool working in this repo (Claude Code, Cursor, Windsurf, Codex, Gemini, etc.). It is designed so that a solo, non-technical founder can direct AI agents to build a production-grade app without an in-house engineer, while still following real-world engineering discipline.

## Source of Truth — Read in This Order
1. `00_PROJECT_BRIEF.md` — what/why/who, and explicit out-of-scope items.
2. `docs/product/PRD.md` — locked product/business requirements, including full screen/navigation spec (§34–38). Never contradicted.
3. `docs/DECISION_REGISTER.md` — every LOCKED/OPEN/FUTURE decision. **Check for OPEN items relevant to your task before proceeding — do not guess on an OPEN decision.**
4. `docs/product/BUSINESS_RULES.md` — consolidated business logic quick-reference (PRD remains authoritative if they ever disagree).
5. Finalized UI/design assets supplied with the project.
6. `docs/LEARNINGS.md` — **read this before touching any module you've touched before.** This is the project's memory of past mistakes. Skipping this is how the same bug gets reintroduced.
7. `docs/architecture/ARCHITECTURE.md` and `docs/TECH_STACK.md` — approved technical architecture and locked technology choices.
8. `docs/security/AUTH_SPEC.md`, `docs/security/SECURITY.md`, `docs/security/THREAT_MODEL.md`.
9. `docs/decisions/` (ADRs) — check status field; superseded ADRs are historical record only, not active rules.
10. `docs/testing/ACCEPTANCE_CRITERIA.md` and `docs/DEFINITION_OF_DONE.md` — what "done" actually means for the task at hand.
11. Existing production code and tests.
12. This file.

Do not invent business rules that conflict with the PRD.

## Token / Context Efficiency Protocol
Real teams don't re-read the whole codebase for every change, and this repo shouldn't force an AI agent to either. Follow this discipline:
- **Never re-read a full doc you've already read in this session** unless it may have changed. Keep a running mental model instead of re-fetching.
- **Read only the relevant section of a doc**, not the whole file, when the task is narrow (e.g. touching Sales only needs the Sales section of the PRD/DB model, not Suppliers).
- **Consult `docs/LEARNINGS.md` by category** (see its structure) — don't read the whole file if only the "Inventory" category is relevant to the current task.
- **Prefer targeted diffs over full-file rewrites.** Only rewrite a whole file when the change is structural.
- **Write short implementation plans** (bullet points, not essays) before coding. A plan's job is to catch mistakes before they're written, not to be documentation.
- **Batch related questions** rather than going back to the product owner turn-by-turn. If three things are ambiguous, ask all three at once.
- **Do not restate requirements back verbatim** before implementing — reference them by section number instead (e.g. "per PRD §12.1") so context isn't duplicated.

The goal: same correctness, fewer tokens, fewer round trips.

## Self-Learning Protocol (Mandatory)
This project must get smarter over time, not repeat mistakes. Every AI agent working in this repo follows this loop:

1. **Before starting a task**, check `docs/LEARNINGS.md` for entries tagged with the module/area you're about to touch.
2. **When a bug, regression, or incorrect assumption is found and fixed** — whether caught by the product owner, a test, or the agent itself — the agent MUST append an entry to `docs/LEARNINGS.md` before considering the task done. No exceptions, even for "small" fixes.
3. **Entry format** (keep it short — this file is read often, so verbosity costs everyone tokens later):
   ```
   ### [YYYY-MM-DD] <short title>
   - Module: <e.g. Sales / Inventory / Auth>
   - Mistake: <what went wrong, one line>
   - Root cause: <why it happened, one line>
   - Fix/Rule: <the rule that prevents recurrence — this is the part future agents must obey>
   ```
4. **If a mistake reveals a systemic gap** (not a one-off typo, but a pattern — e.g. "agent keeps forgetting server-side stock validation"), promote it from `LEARNINGS.md` into a new bullet under **Non-Negotiable Rules** below, so it's enforced structurally, not just remembered.
5. **Never delete a `LEARNINGS.md` entry.** Superseded entries get marked `[RESOLVED — folded into Non-Negotiable Rules]` rather than removed, preserving the history of why a rule exists.

This turns every mistake into a permanent, reusable asset instead of a one-time correction that gets forgotten next session.

## Loop and Runaway-Cost Prevention (Mandatory)
An AI agent stuck repeating the same failed approach wastes tokens/credits and can quietly corrupt work. Every agent follows this discipline:
- If an approach fails twice, change strategy on the third attempt — do not repeat the same fix a third time hoping for a different result.
- If 3+ attempts produce no meaningful progress on a task, stop and escalate to the product owner with a short summary of what was tried and why it didn't work, rather than continuing to burn tool calls/tokens.
- Treat "no diff in outcome between attempt N and attempt N-1" as a stop signal, not a reason to try the exact same thing again.
- Long-running or open-ended tasks should have an implicit budget in mind (a handful of tool calls for a small fix, more for a full feature) — if a task is taking dramatically more calls than its scope suggests, pause and reassess rather than continuing indefinitely.

## AI Self-Improvement Safety (Mandatory)
Mistakes get logged and turned into rules (see Self-Learning Protocol above) — but the agent never grants itself new authority based on its own learnings. Specifically:
- An agent may never autonomously change database schema, RLS/security policies, core business rules, or permission logic as a "learned improvement" without an explicit ADR and explicit product-owner approval first — even if the agent is confident the change is correct.
- A lesson logged in `docs/LEARNINGS.md` for one module/domain must not be silently generalized to a different module without checking it's actually relevant there (e.g. a lesson learned building Sales does not automatically apply to a future unrelated vertical/module).
- The model is: mistake → evaluate → propose → get approval → THEN it becomes a rule. Never: mistake → agent unilaterally rewrites the rule.
- This keeps the project's foundation trustworthy as it grows, rather than quietly drifting based on one agent's unverified judgment calls.

## Before Any Coding Task
1. Read this file (if not already in context this session).
2. Read the relevant PRD section only.
3. Check `docs/LEARNINGS.md` for the relevant module.
4. Read the relevant part of `ARCHITECTURE.md`.
5. Check relevant security/ADR documents.
6. Inspect existing code/tests before changing anything.
7. Produce a short implementation plan.
8. Implement the smallest coherent change.
9. Run relevant tests/checks.
10. Update `docs/LEARNINGS.md` if any mistake was made and corrected during the task.
11. Update documentation/ADR only when architecture or business behavior actually changed.

## Non-Negotiable Rules
- Never expose secrets, service-role keys, or provider credentials in the mobile client. Only the Supabase anon/public key belongs on-device, and only because Row Level Security and RPC functions — not the key — are the actual security boundary.
- Never bypass authentication or authorization.
- Never trust client-supplied role, price, cost, balance, profit, stock, or permission values.
- All financial or inventory-mutating operations (sales, purchases, payments, adjustments, returns) MUST go through a server-side Postgres function (RPC) or Edge Function that recalculates and validates everything — never a raw client table insert/update for these entities.
- Server-side business rules are authoritative.
- Never allow inventory to become negative.
- Never hard-delete completed financial, sales, purchase, payment, return, or inventory movement records.
- Never overwrite historical transaction facts.
- Never retroactively change the selling price stored on a historical sale.
- Employees must never receive supplier financial information, purchase/base cost, or gross profit — enforced via Row Level Security policies, not just hidden UI.
- Admin-only operations must be enforced at the database/RPC layer, not only hidden in the UI.
- Inventory adjustments require a reason and an auditable record.
- Returns must originate from an eligible original sale.
- Voids (v1.1) are Admin-only, time-windowed, and never hard-delete — they flag and reverse.
- Database schema changes require migrations, never manual production edits.
- Do not introduce a dependency without a clear reason.
- Do not rewrite architecture without an ADR.
- Do not remove tests to make a change pass.
- Do not silently change product behavior to resolve ambiguity; document the ambiguity in `LEARNINGS.md` or flag it to the product owner and ask for a decision.

## Coding Workflow
PRD/design → check LEARNINGS.md → plan → implementation → tests → security check → docs/ADR/LEARNINGS update → commit.

## Definition of Done
A feature is complete only when implementation, validation, authorization, error handling, tests, documentation, and relevant security checks are complete — AND any mistakes made along the way are logged in `docs/LEARNINGS.md`.

## Tool Portability
The repository is the persistent project memory. Do not rely on chat history. Any AI coding tool must be able to onboard by reading this repository, including `docs/LEARNINGS.md`, cold.
