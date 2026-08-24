# Development Workflow (v2)

## Environments
- Supabase **development project** — used during building/testing.
- Supabase **production project** — real shop data. Never share credentials or test against production directly.
- Local Expo dev server for the mobile app during development; EAS Build for installable APK/AAB output.

Production credentials (production Supabase URL/keys) must never be used in development, and never committed to source control regardless of environment.

## CI Checks (minimum, scaled to solo-builder reality)
- Lint/type checking (TypeScript across mobile + Postgres function definitions where applicable).
- Unit tests for RPC function logic (can be run against a local/test Supabase instance).
- Migration validation — every schema change is a tracked migration file, applied to dev before production.
- Secret scanning (prevent accidental key commits).
- Dependency vulnerability scanning (`npm audit` or equivalent, run periodically — doesn't need to block every commit for a solo project).
- EAS build check before distributing a new APK.

Full enterprise CI (load testing, chaos testing, etc.) is intentionally deferred to Phase 7 of `ROADMAP.md` — not needed at this scale yet, and revisited only when there's a measured reason.

## Deployment
- Supabase migrations applied via Supabase CLI (`supabase db push` or equivalent), not manual dashboard edits, once past initial prototyping.
- New app builds distributed as signed APK (private distribution) until Play Store publishing makes sense (see `ROADMAP.md` Phase 7).
- Rollback: Supabase supports point-in-time recovery on paid tiers — confirm this is enabled before going live with real shop data; document the rollback steps once confirmed.

## Observability
At minimum, track:
- Supabase's built-in dashboard: API error rates, auth failures, database health.
- Mobile crash reporting (e.g. Sentry free tier) once the app has real users.
- A simple manual check: does today's `create_sale_v1` failure count look normal?

Never log secrets, tokens, or unnecessary sensitive customer/financial data — including in crash reports.
