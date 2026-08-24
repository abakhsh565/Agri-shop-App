# ADR-006 — Web PWA + Supabase (Supersedes ADR-001 and ADR-002)

Status: Accepted

## Context
The product owner confirmed the delivery target is the existing React + Vite
application (option A), not a ground-up rebuild. The core requirements are:
- Runs on both Android and iPhone seamlessly.
- Data synchronized in real time across devices.

## Decision
Deliver AgriShop as an installable **Progressive Web App (PWA)** built with
React 19 + Vite + Tailwind CSS v4, using **Supabase** (hosted PostgreSQL,
Auth, and Realtime) as the backend-as-a-service.

- Cross-platform mobile is achieved via the PWA (web app manifest + service
  worker), installable on Android and iOS from the browser — a single codebase.
- Real-time sync is achieved via Supabase Realtime (Postgres change streams
  over websockets).
- Server-side business rules, authorization, and financial invariants are
  enforced with Supabase Row-Level Security and Postgres constraints/functions.

## Consequences
- No separate Flutter mobile codebase (supersedes ADR-001).
- No self-hosted NestJS backend or self-managed Postgres (supersedes ADR-002);
  Supabase provides the managed equivalent.
- The security requirements in SECURITY.md and THREAT_MODEL.md still apply and
  map onto Supabase primitives: RLS = server-side authorization, column-level
  grants = hiding cost/profit from employees, Postgres constraints = the
  non-negative-stock and append-only invariants.
- ADR-004 (no hard delete) and ADR-005 (modular boundaries within one codebase)
  remain in force.

## Change policy
Moving off Supabase or to a native mobile framework requires a new ADR
documenting rationale, migration impact, and effect on existing code.
