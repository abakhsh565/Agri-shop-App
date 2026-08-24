# ADR-005 — Modular Monolith First

Status: Accepted

Decision: Start with a modular monolith and clear domain boundaries.

Reason: The initial shop has approximately 3–4 employees and the product is an internal retail/POS system. Microservices would add operational complexity without a demonstrated need.

Future: Extract a module only when scale, reliability, team boundaries, or deployment requirements justify it.

Implementation note (added with ADR-006): "modular monolith" here means domain-organized Supabase Postgres RPC/Edge Functions (see `supabase/functions/` structure in `REPO_SCAFFOLD.md`), not a self-hosted server process. See ADR-006's "On 'Modular Monolith' Terminology" section for the full clarification.
