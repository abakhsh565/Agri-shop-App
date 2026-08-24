# Future Vision — Post-MVP (Not Built Now)

## Purpose — Read This First
This file is **context for the AI coding agent, not a feature list.** Its job is the same as a strong house foundation: the MVP being built today is "floor one," and this document exists so floor one's foundation doesn't have to be demolished when floor two, three, or ten get added later — without actually building those floors now.

**The rule this creates for every architecture/naming decision in the MVP:** prefer generic, business-agnostic core concepts (`Products`, `Inventory`, `Sales`, `Organization`) over domain-locked ones (`AgricultureProducts`, `AgricultureInventory`) wherever it costs nothing extra to do so today. Agriculture-specific concepts (crops, spray guidance, disease info) stay isolated in their own module, never baked into the core. This is already how `DATABASE_MODEL.md` is written — this file is the explicit reasoning behind that choice, so no future agent "simplifies" it back into agriculture-specific naming.

Nothing here overrides `ROADMAP.md`'s Phase 1–7 ordering, and nothing here expands the current MVP. Do not build anything in this file without a new ADR and explicit product-owner go-ahead.

## MVP Status
**Locked and confirmed.** Agriculture Shop Inventory Management — Owner/Admin, Employees, Products, Inventory, Purchases, Sales, employee-wise sales tracking, Supabase backend. Barcode (Phase 8, see `BARCODE_INTEGRATION.md`) is the one committed next step immediately after MVP — everything else below is pure long-term context.

## Long-Term Vision (context only)
```
Agriculture Shop Management → Multi-Shop Platform → Farmer App → Agricultural Marketplace → Multi-Business Platform
```
Agriculture is the first vertical the platform proves itself on, not necessarily the last. The same core could one day support other retail/SME verticals (iron/steel, hardware, etc.) — this is why "Core Platform vs. Vertical Module" separation (below) matters even while only Agriculture exists today.

## 1. Multi-Shop / Multi-Tenant + Organization Concept
Beyond the current `shop_id`-per-table isolation (already in `DATABASE_MODEL.md`), the long-term shape keeps four concepts distinct rather than collapsing them together:
```
User ≠ Employee ≠ Shop ≠ Organization
```
An Organization may eventually own multiple Shops (franchise/multi-branch), and the platform itself may eventually host multiple unrelated Organizations (selling the app to other businesses). Today's schema already isolates by `shop_id`; when this becomes real, an `organization_id` sits one level above it — additive, not a rebuild, exactly like the franchise note already in this file. **Not built now** — this is a naming/relationship discipline to keep in mind, not a new table to create today.

## 2. Multi-Shop / Franchise Mode
One owner managing multiple physical shop locations under one master account, with full data isolation between locations.
- Different from "selling the app to other independent shop owners" (a separate future business-model question).
- Readiness: current schema already puts `shop_id` on every table (ADR-006, DATABASE_MODEL.md §10). Adding franchise mode later means adding an `owner_id`/`organization_id` one level above `shop_id` and an owner-scoped dashboard that aggregates across shops — additive, not a rebuild.
- Do not implement until explicitly requested.

## 3. Core Platform vs. Vertical Modules
Long-term architectural principle, applies to naming decisions made *today*, at zero extra cost:
- **Core (business-agnostic):** Users, Auth, Organizations/Shops, Employees, Roles, Products, Inventory, Stock Movements, Purchases, Sales, Customers, Suppliers, Notifications, Reports, Audit.
- **Vertical (business-specific):** Agriculture concepts (crops, spray/product guidance, disease info) live in their own module, never merged into core tables/naming.
- Practical effect on the current MVP: keep using generic names (`Products`, `Inventory`) — already the case, no change needed, just documented as intentional.

## 4. Future Web App / Multi-Client
Same backend/business logic (Supabase RPC functions per `API_CONTRACT.md`) should be reusable by a future web dashboard, not just the mobile app. No mobile-only assumptions baked into business logic — already true since logic lives in Postgres functions, not mobile code. No action needed now.

## 5. Farmer App & Agricultural Marketplace (long-term, not started)
Potential future direction: a separate farmer-facing app (crop info, recommendations, ordering) connected to the same platform, eventually letting farmers order from nearby onboarded shops using real shop inventory data. Pure vision — no architecture impact on the current MVP beyond what's already covered above (generic core, organization readiness). Do not reference this in any current screen, table, or business rule.

## 6. Multi-Business Future (Iron/Steel, Hardware, etc.)
Same "one core + vertical modules" principle extended beyond Agriculture. Purely conceptual today — validates why core entities stay generic (see §3), nothing more.

## 7. iOS Support
Currently Android-only (matches $0-budget, fastest-path priority).
- Cost when pursued: Apple Developer Program, $99/year. EAS Build can produce iOS builds without owning a Mac, so no hardware cost — just the developer program fee.
- No architecture change needed — Expo/React Native already targets both platforms; this is a build/publish step, not a rewrite.

## 8. Read-Only Meta-Bot
A future internal assistant with strictly read-only access to logs/database for auditing, error tracking, and progress reporting. Zero write access by design — cannot corrupt data or bypass business rules.
- Implementation note for later: a separate Supabase read-only role/service key, never the anon key used by the shop app itself.

## 9. AI Service Abstraction Layer
Any future AI-powered feature (e.g. inventory/reorder forecasting, or eventually an AI agent assisting Admins/Employees/Farmers) must route Mobile → Supabase Edge Function → AI Provider — never call an AI provider directly from the mobile client. This protects API keys and allows swapping AI providers without a mobile app update.
- No current features need this. Documented so it's not forgotten or built wrong when it comes up.
- Long-term agent behavior model (context only): Understand → Plan → Execute → Verify → Learn, operating only through controlled tools/services, never unrestricted system access. This describes a possible future in-app AI agent for shop operations — not the coding agent building this app (that agent's rules live in `AGENTS.md`).

## Explicitly Not Decided Yet
- Pricing/monetization model for selling to other shops (deferred by design — see `MONETIZATION.md`; Day 2 problem, not Day 1).
- Farmer App / Marketplace timeline — no commitment, vision only.

