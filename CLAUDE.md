# CLAUDE.md

> **Project rule — read `AGENTS.md` §9 first.** Work only on `dev`, one small batch per commit,
> run `npx tsc --noEmit` and `npx vitest run tests/unit` (0 failed) before every commit, record a
> `docs/PRODUCTION_MIGRATION_PLAN.md` §5 disposition for every new migration in the same commit,
> and never push directly to `staging` or `main` — promotion is a gated pull request along
> `dev -> staging -> main`. The guidelines below apply on top of that chain, not instead of it.
Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.
**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.
## 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
## 2. Simplicity First
**Minimum code that solves the problem. Nothing speculative.**
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.
## 3. Surgical Changes
**Touch only what you must. Clean up only your own mess.**
When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.
## 4. Goal-Driven Execution
**Define success criteria. Loop until verified.**
Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
---
**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Permanent System Requirements
**RTL/LTR + Urdu support is mandatory for all user-facing UI.**

This project serves English (LTR) and Urdu (RTL) users. Any new or modified user-facing UI must automatically satisfy:
- Use `ps-*`/`pe-*` (not `pl-*`/`pr-*`) and `ms-*`/`me-*` (not `ml-*`/`mr-*`) for directional padding/margins
- Use `text-start`/`text-end` (not `text-left`/`text-right`) for text alignment
- Use `start-*`/`end-*` (not `left-*`/`right-*`) for CSS positioning where possible
- Use `useT()` from `@/lib/i18n` for ALL user-facing text
- Add EN and UR translations for every new i18n key before merging
- Use `direction: isUrdu ? "rtl" : "ltr"` on page root divs
- Test in both English/LTR and Urdu/RTL modes before declaring PASS
- Do not ask for permission to support Urdu/RTL — it is a permanent requirement

Exceptions require explicit human approval and must be documented as approved exceptions.
