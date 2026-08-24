# ADR-002 — Backend Architecture

Status: Superseded by ADR-006 (2026-08-18)

> Superseded: the product owner chose Supabase (managed PostgreSQL + Auth +
> Realtime) instead of a self-hosted NestJS backend. The PostgreSQL and
> modular-boundary intent carries over. See ADR-006. Retained per ADR-004.

Decision (historical): Use a modular TypeScript backend with NestJS and PostgreSQL, starting as a modular monolith.

Reason: The initial product is an internal retail/POS system with a small operational team. Clear modularity keeps complexity controlled while preserving later scaling options.

Change policy: Do not move to microservices without measured operational/scaling reasons and a new ADR.
