# Changelog

## Initial Architecture Package
- Created portable AI-agent instructions.
- Defined cross-platform/mobile architecture baseline.
- Defined backend/database/API/security baselines.
- Added threat model.
- Added ADR system.
- Added implementation roadmap.

Future entries must record meaningful product, architecture, security, and operational changes.

## v2 — Solo-Builder Stack + Self-Learning
- Replaced Flutter + self-hosted NestJS/Postgres/Redis with React Native + Expo + Supabase (ADR-006, supersedes ADR-001/002).
- Added `docs/LEARNINGS.md` as a permanent, structured mistake/fix log the AI agent must consult and update.
- Added Token/Context Efficiency Protocol to `AGENTS.md`.
- Clarified server-authoritative enforcement model under Supabase (RLS for reads, RPC/Edge Functions for all financial/inventory writes).
- Added multi-tenancy (`shop_id`) from the first migration, anticipating future sale to other shops.
- Reordered roadmap: basic security present from Phase 1; advanced hardening (offline sync, export, load testing) moved to Phase 7, not deferred entirely.
