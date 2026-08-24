# Tech Stack — Locked

All entries here are LOCKED per `docs/DECISION_REGISTER.md` (D1–D4) unless marked OPEN.

## Mobile
| Layer | Choice |
|---|---|
| Framework | React Native + Expo (managed workflow) |
| Language | TypeScript |
| Build/distribution | EAS Build (cloud, no local Android Studio/Xcode required) → signed `.apk` (private distribution first) |
| State/data | Supabase JS client SDK; React state/hooks for local UI state (no Redux needed at this scale) |
| Navigation | React Navigation (standard for Expo apps) |
| Camera/Barcode (Phase 8) | `expo-camera` built-in barcode detection (EAN-13/UPC + QR) |

## Backend / Data Platform
| Layer | Choice |
|---|---|
| Database | PostgreSQL, managed via Supabase |
| Auth | Supabase Auth — Phone + OTP (see `docs/security/AUTH_SPEC.md`; SMS provider is **OPEN**, D18) |
| Authorization | Row Level Security (RLS) policies, per table, scoped by `shop_id` and role |
| Business logic / writes | Postgres Functions (`SECURITY DEFINER` RPC) and/or Supabase Edge Functions — required for every financial/inventory-mutating operation |
| File storage | Supabase Storage (private bucket — company logos, attachments) |
| Background jobs (if needed later) | Supabase scheduled Edge Functions — not required for MVP |

## Environments
- Two Supabase projects: development and production. Never share credentials across them.
- No self-hosted servers, no Redis, no separate backend service (D3).

## Source Control
- GitHub — private repository. See `REPO_SCAFFOLD.md` for structure and initial setup commands.

## Development Tooling (no-install-on-laptop path)
- Google Cloud Shell Editor (browser-based) + Gemini Code Assist, or Claude Code / Cursor / Windsurf if/when budget allows — see prior cost discussion. Any of these can implement against this same repo; the repo, not the tool, is the source of truth (ADR-003).

## Explicitly Not Used (and why)
| Rejected | Reason |
|---|---|
| Flutter/Dart | Steeper toolchain for a non-technical solo founder; superseded by D1 (ADR-001 superseded). |
| Self-hosted NestJS + Postgres | Requires server ops (provisioning, migrations, secrets) the founder can't maintain alone; superseded by D2 (ADR-002 superseded). |
| Redis | No caching/rate-limit need demonstrated yet at this scale; revisit only with a new ADR. |
| Microservices | Unnecessary complexity for a 3–4-employee shop app; modular monolith via domain-organized Edge Functions instead (D6). |

## Cost Summary (current, MVP stage)
| Service | Cost |
|---|---|
| Supabase (free tier) | $0 |
| Expo/EAS (free tier) | $0 (build minutes may need a paid tier if you rebuild very frequently — batch builds, see prior discussion) |
| GitHub (private repo) | $0 |
| SMS/OTP provider | **OPEN — small per-SMS cost, see D18 in Decision Register** |
| Apple Developer (iOS, deferred) | $99/year, only when iOS is pursued |
| Google Play Console (if/when going public) | $25 one-time |
