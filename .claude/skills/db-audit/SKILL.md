---
name: db-audit
description: Verify a change is enforced at the database/security layer, not just the UI — idempotency, tenant isolation, RBAC, historical data, destructive-action safety.
---

# /db-audit

**Purpose.** Answer one question: **is this enforced at the correct layer?**

The UI showing the right thing proves nothing about what the database will accept.

## Activate for

Supabase, migrations, RPCs, constraints, tenant isolation, RBAC, money, inventory, payments,
returns, voids, reminders, destructive actions, idempotency, historical records, audit history.

## Check

- **Authorization** — can the operation be reached by a direct RPC/PostgREST call, bypassing
  the UI? Is the caller's permission and tenant checked inside the function?
- **Tenant leakage** — can a row belonging to another shop be read or written?
- **Idempotency** — is a repeated or double submission safe? Does the same idempotency key
  produce exactly one effect?
- **Duplicates and orphans** — can a retry create a second row? Can a parent be deleted while
  children remain?
- **Historical data** — do past records keep the prices and costs used at the time? Nothing may
  recalculate retroactively.
- **Destructive safety** — does a delete/archive/void confirm, stay recoverable where required,
  and refuse when the record is in use?
- **Migrations** — does the chain still apply from zero? (`migrationReplayability` guard.)

## Evidence

Show the actual query result, the actual function body, or the actual row before and after. Use
a real authenticated session (JWT → PostgREST → RPC → DB), not the client's own claim.

Report `PASS` / `FAIL` / `UNKNOWN`, with the query and its output. `UNKNOWN` is never `PASS`.
