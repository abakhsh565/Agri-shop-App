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

*(Empty at project start. First entry is created the first time an AI agent fixes a real mistake during implementation. Do not pre-fill this with hypothetical entries — it must reflect real project history only.)*
