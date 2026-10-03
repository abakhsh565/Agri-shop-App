# Learnings Log — Project Memory of Mistakes and Fixes

## Purpose
This is the single most important file for keeping AI-agent-built software from repeating its own mistakes. Every time a bug, wrong assumption, or bad pattern is caught and fixed, it gets logged here — permanently. Future agents (and future sessions of the same agent) read this before touching a module, so the same class of mistake doesn't happen twice.

This is not a changelog and not a bug tracker. It is specifically a **mistake → root cause → rule** record, kept short so it stays cheap to read.

## How to Use This File
- **Before starting work on a module**, scan the entries tagged with that module.
- **After fixing any mistake**, add an entry using the format below — before marking the task done.
- **If the same category of mistake appears 2+ times**, propose promoting the rule into `AGENTS.md` → Non-Negotiable Rules (per the AI Self-Improvement Safety rule — propose, don't self-approve), and mark the entries here `[RESOLVED — folded into Non-Negotiable Rules]`.
- Never delete entries. History of *why* a rule exists is as valuable as the rule.

## Conceptually, This File Covers
This log is effectively the project's **failure memory** — one of several kinds of memory a mature AI-agent workflow benefits from: working memory (current task context, held in-session), episodic memory (what was tried before and what happened, partly this file, partly commit history), semantic knowledge (validated business rules — lives in `AGENTS.md`/PRD, not here), and failure memory (this file, specifically). Keeping this as one lightweight log rather than four separate files is a deliberate choice for a solo-builder project — split it out only if it genuinely becomes unwieldy, not preemptively.

## Entry Format
```
### [YYYY-MM-DD] <short title>
- Module: <e.g. Sales / Inventory / Auth / Reports>
- Mistake: <what went wrong, one line>
- Root cause: <why it happened, one line>
- Fix/Rule: <the rule that prevents recurrence>
```

## Categories in Use
Auth · Employees · Companies · Products · Inventory · Purchases · Customers · Sales · Payments · Returns · Reports · Settings · Infra/Build · Security

---

## Log

### [2026-10-04] A form that writes a new field must also read it — or a save silently reverses it
- Module: Products / Farmer Marketplace
- Mistake: the farmer-marketplace switch was added to the product form and to the write RPC, but the product list mapper (`productsStore`) was not taught the new column. On an edit the form could not see the stored value, defaulted to `false`, and sent it on every save — so opening a listed product and saving an unrelated edit would have quietly unlisted it.
- Root cause: the field was wired on the write path and its read path was assumed rather than verified. A boolean with an "unset" default makes this failure silent in both directions.
- Fix/Rule: when a form gains a field, prove the round trip in a browser test (open the saved row and read it back) — and when the RPC distinguishes "not mentioned" from `false`, send the value only when the person actually changed it, so an unrelated save cannot reverse a stored decision. Guarded by `tests/e2e/marketplaceListing.spec.ts`, whose read-back assertion was proven non-vacuous by reintroducing the defect and watching it fail.

### [2026-10-04] A failing assertion in a shared-fixture suite must not leave the shared row mutated
- Module: Infra/Build (QA tests)
- Mistake: the marketplace integration suite set a location on the shared QA branch inside individual tests, so the first failing assertion skipped the restore and left that branch pinned — the next tests then failed for a state the earlier failure created, and the failures read as product bugs.
- Root cause: setup/restore was per-assertion rather than per-test, and a failure path had no `finally`.
- Fix/Rule: any suite that mutates a shared fixture row must do the write and the restore inside one `try/finally` per test, and must assert the restored value. A cascade of failures in a shared-fixture suite is investigated as test state first, never labelled flaky.

### [2026-10-04] Fixture UUIDs must come from a namespace nobody else owns
- Module: Infra/Build (QA tests)
- Mistake: the new marketplace suite declared ids under `d7000000-…`, three of which (`a1`, `b1`, `b2`) `appSettingsIsolation.test.ts` already owned; whichever suite cleaned up first would delete the other's rows mid-run.
- Root cause: ids were chosen for being "obviously fake" rather than for being unique to the file.
- Fix/Rule: before seeding fixtures, pick a namespace not present anywhere in `tests/` and let `tests/unit/fixtureIdCollision.test.ts` confirm it. Run the FULL vitest suite before declaring a stage green — a targeted run cannot see a collision that only exists between two files.
