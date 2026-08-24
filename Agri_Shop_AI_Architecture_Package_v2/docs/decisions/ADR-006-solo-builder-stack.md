# ADR-006 — Solo-Builder Production Stack

Status: Accepted (supersedes ADR-001, ADR-002)

## Decision
Mobile: **React Native + Expo (TypeScript)**, distributed via EAS Build.
Backend/Data: **Supabase** — managed PostgreSQL, Auth (Phone OTP), Storage, Row Level Security, and Postgres Functions/Edge Functions for authoritative business logic.
No self-hosted servers. No Redis in MVP. No separate backend framework.

## Reason
The product owner is a non-technical solo founder directing AI coding tools, not a funded team with dedicated engineers. The chosen stack must:
1. Be heavily represented in AI training data, so coding agents make fewer mistakes and need less correction (directly serves the token-efficiency and self-learning goals in `AGENTS.md`).
2. Minimize operational surface area the founder would otherwise have to manage manually (server provisioning, migrations, secrets rotation, uptime).
3. Still meet every non-negotiable security/business rule in the PRD and `SECURITY.md` — this is not a "toy stack," it is what many real production consumer and SMB apps run on.
4. Keep a straightforward path from "designed in Figma" to "installable APK" without requiring native Android/iOS tooling knowledge.

## How Server-Authoritative Rules Are Still Enforced (Important)
Supabase allows direct client-to-database queries. This is safe for **reads** when scoped by Row Level Security (RLS) policies — e.g. an Employee's query for supplier cost data simply returns nothing, enforced by Postgres itself, not app code.

It is **not safe** for **writes** that involve business logic — a sale total, a stock deduction, a payable calculation. Those must never be raw client `INSERT`/`UPDATE` calls. Instead:
- All money- or inventory-mutating actions (new sale, purchase/stock-in, customer payment, supplier payment, inventory adjustment, return, void) are implemented as **Postgres `SECURITY DEFINER` functions** (RPC) or **Supabase Edge Functions**.
- The client calls the function with intent (e.g. "sell 3 units of X to customer Y, paid Rs. 500"); the function itself re-validates stock, recalculates totals server-side, checks role/permission, and performs the write inside a single database transaction.
- The client never sends a pre-computed total, price, or balance that gets trusted as-is.

This preserves every rule in `SECURITY.md` ("server calculates authoritative totals/prices/profit; client values are untrusted") without needing a hand-built backend server.

## What This Replaces
- NestJS backend service → Supabase (Postgres + Auth + Storage + RLS + Functions).
- Redis → not needed at this scale; revisit only if a real caching/rate-limit need appears in production (would require a new ADR).
- Flutter/Dart → React Native + Expo (TypeScript), matching the language used everywhere else in the project for consistency and AI-agent familiarity.

## On "Modular Monolith" Terminology
Some planning documents describe the desired backend as a "modular monolith" with clear domain boundaries (Auth, Inventory, Sales, Suppliers). That goal is preserved under this ADR — it does not require a self-hosted server. Achieve it by organizing Postgres RPC/Edge Functions into domain-named folders (`supabase/functions/auth/`, `supabase/functions/inventory/`, `supabase/functions/sales/`, `supabase/functions/suppliers/`, etc.), each with clear ownership of its own tables and rules. This gives the same architectural cleanliness without reintroducing server hosting, which was the exact operational burden ADR-006 exists to avoid for a solo, non-technical founder. Do not stand up a separate Node/NestJS service based on "modular monolith" language elsewhere — it means domain separation, not deployment topology, in this project.

## Change Policy
A future move to a dedicated backend service or different mobile framework requires a new ADR with a documented, measured reason (real scale/reliability pressure) — not a preference change mid-build.
