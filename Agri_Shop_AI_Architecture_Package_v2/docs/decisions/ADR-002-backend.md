# ADR-002 — Backend Architecture

Status: **SUPERSEDED by ADR-006**

Original decision: Use a modular TypeScript backend with NestJS and self-hosted PostgreSQL.

Reason for supersession: Self-hosted NestJS + Postgres requires server provisioning, migration tooling, secrets management, and ops work that assumes a backend engineer. For a solo non-technical founder building via AI coding tools, this is real-world-proven to be where projects stall. Supabase (managed Postgres + Auth + Storage + auto-generated APIs + Row Level Security) gives equivalent guarantees with a fraction of the operational surface area, and is what solo/small-team builders overwhelmingly use in practice for this class of app in 2025–2026.

This entry is preserved for history, not deleted.
