# Decision Register

Every consequential decision, tracked in one place. Status meanings:
- **LOCKED** — decided, do not revisit without a new ADR + explicit product-owner approval.
- **OPEN** — needs a product-owner decision before the related work starts.
- **FUTURE** — intentionally deferred, not blocking current work.

| ID | Decision | Status | Detail |
|---|---|---|---|
| D1 | Mobile framework: React Native + Expo (TypeScript) | LOCKED | ADR-006. Supersedes earlier Flutter decision (ADR-001). |
| D2 | Backend/data platform: Supabase (Postgres + Auth + Storage + RLS) | LOCKED | ADR-006. Supersedes earlier self-hosted NestJS decision (ADR-002). |
| D3 | No self-hosted server; no Redis in MVP | LOCKED | ADR-006. Revisit only with measured scale need + new ADR. |
| D4 | Financial/inventory writes go through Postgres RPC/Edge Functions only, never raw client writes | LOCKED | ADR-006, AGENTS.md Non-Negotiable Rules. |
| D5 | Repository is the persistent source of truth, not chat history | LOCKED | ADR-003. |
| D6 | Modular domain boundaries (Auth/Inventory/Sales/Suppliers) via Supabase Edge Function folders, not a separate service | LOCKED | ADR-005, clarified by ADR-006 addendum. |
| D7 | No hard deletes on financial/inventory/sales records | LOCKED | ADR-004, PRD §21. |
| D8 | Multi-tenancy: `shop_id` on every table from first migration | LOCKED | DATABASE_MODEL.md §10, ADR-006. |
| D9 | Company = Supplier = Manufacturer (single entity, no separate model) | LOCKED | PRD §4, §32. |
| D10 | Categories at launch: Spray (variant/pack-size pricing) and Seed (per-KG pricing) only | LOCKED | PRD §5, §6. |
| D11 | Admin has full parity with Employee for New Sale / Record Payment | LOCKED | PRD §32 (v1.1). |
| D12 | Sales History organized into All/Credit/Paid tabs | LOCKED | PRD §32 (v1.1), §38.2. |
| D13 | Void Sale is Admin-only, time-windowed, never hard-deletes | LOCKED | PRD §32 (v1.1), §38.5. Default void window: same business day (Admin-configurable). |
| D14 | Barcode Sale Mode is a distinct scan-loop flow, reusing Manual Sale's cart/payment/confirmation screens and the same `create_sale_v1` backend | LOCKED | `docs/BARCODE_INTEGRATION.md`. |
| D15 | Auth: Phone number + OTP for both Admin and Employee login; no passwords/email required | LOCKED | See `docs/security/AUTH_SPEC.md`. |
| D16 | Admin signs up first (phone+OTP); Employees are added by Admin, never self-register | LOCKED | See `docs/security/AUTH_SPEC.md`. |
| D17 | Co-Admin: same permissions as Owner, cannot remove/demote the original Owner | LOCKED | See `docs/security/AUTH_SPEC.md`. |
| **D18** | **SMS/OTP provider choice — Supabase Phone Auth requires a paid third-party SMS provider (e.g. Twilio); this is a small but real recurring cost, not $0** | **OPEN** | See `docs/security/AUTH_SPEC.md` §"Open Decision." Product owner must choose: (a) accept small per-SMS cost with a chosen provider, or (b) use free email-based OTP instead. |
| D19 | Distribution: private signed APK first (no Play Store review wait); public listing deferred | LOCKED | Prior discussion, `ROADMAP.md` Phase 7. |
| D20 | Platform priority: Android first, iOS later (adds $99/year Apple Developer cost when pursued) | LOCKED | `docs/FUTURE_VISION.md` §7. |
| D21 | Monetization/pricing model for selling to other shops | FUTURE | `docs/MONETIZATION.md` — explicitly not decided, no logic built against it. |
| D22 | Multi-shop/franchise mode (Organization → Shop hierarchy) | FUTURE | `docs/FUTURE_VISION.md` §1–2. Schema-ready, not built. |
| D23 | Farmer App / Agricultural Marketplace / Multi-Business Platform | FUTURE | `docs/FUTURE_VISION.md` §5–6. Farmer App itself not built. Owner-side listing + read contract shipped 2026-10-04 by explicit product-owner approval — migrations `0184`–`0187`; the search radius belongs to the Farmer App (owner sets location + switch only, per the 0187 correction), contract in `FARMER_MARKETPLACE_INTEGRATION.md`. |
| D24 | AI Loop Prevention + AI Self-Improvement Safety guardrails for coding agents | LOCKED | AGENTS.md — applies now, protects current build process. |

## How to Add a Decision
New consequential choice → add a row here with the next ID, correct status, and a pointer to the doc with full reasoning (ADR, PRD section, or spec file). Never renumber or delete a row — if a LOCKED decision changes, add a new row noting what it supersedes, same pattern as the ADRs.
