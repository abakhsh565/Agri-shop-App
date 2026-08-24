# Technical Architecture — Baseline (v2, Solo-Builder Stack)

## 1. Objective
Build a secure, maintainable, cloud-portable application for Android (and later iOS) with a single mobile codebase and a backend that owns all authoritative business rules — buildable and operable by a solo, non-technical founder directing AI coding tools. See ADR-006 for the full reasoning.

## 2. Stack
### Mobile
React Native + Expo, TypeScript. Built to `.apk`/`.aab` via EAS Build (cloud build, no local Android Studio required).

### Backend / Data Platform
Supabase:
- PostgreSQL (managed) — single source of truth for all data.
- Supabase Auth — Phone + OTP login for both Admin and Employee.
- Row Level Security (RLS) — enforces role-based read access at the database layer (e.g. Employees physically cannot query supplier cost fields, regardless of app code).
- Postgres Functions (RPC, `SECURITY DEFINER`) and/or Edge Functions — the only path for any operation that creates or mutates a sale, purchase, payment, adjustment, or return. See ADR-006.
- Supabase Storage — private bucket for company logos/attachments.

### API
Supabase auto-generated REST/GraphQL for reads (RLS-scoped). Custom RPC/Edge Functions for authoritative writes, versioned by function name (e.g. `create_sale_v1`) so contracts can evolve without breaking older app builds.

### Background jobs (if/when needed)
Supabase scheduled Edge Functions (e.g. for expiry-alert digest). Not required for MVP.

### Infrastructure
No servers to provision. Environment separation via Supabase's own project-per-environment model (dev project vs. production project) rather than self-managed environments.

## 3. Logical Architecture
```
Mobile Client (Expo/React Native)
   → Supabase Auth (Phone OTP)
   → Supabase Client SDK
       → Direct RLS-scoped reads (products, inventory, customers, dashboards)
       → RPC/Edge Function calls for all writes with business logic
           → Postgres transaction (validate → calculate → write → audit)
   → Supabase Storage (logos/attachments)
```

## 4. Principles
- Server (Postgres functions) authoritative for business rules — never the mobile client.
- Row Level Security is a real security boundary, not a UI convenience — every table has explicit RLS policies from day one, not added later.
- Reads can be direct/RLS-scoped; writes with financial/inventory impact are never direct.
- Immutable transaction history; corrections via reversal/return/adjustment/void, never edits.
- Auditable stock movement — every inventory change traceable to a sale, purchase, adjustment, or return.
- Least privilege by default: new tables start with RLS enabled and no policies (deny-all) until explicit policies are written.
- Cloud portability: business logic lives in Postgres functions and app code, not vendor-proprietary features that would be painful to migrate off later.
- Testability: RPC functions are the natural unit to test business rules against.

## 5. Domain Modules
1. Authentication (Phone OTP, Admin/Co-Admin/Employee roles)
2. Users / Employees
3. Companies / Suppliers
4. Products
5. Product Variants / Units
6. Inventory
7. Purchases / Stock-In
8. Supplier Payables
9. Customers
10. Sales (incl. cart/quantity logic, credit-limit warning)
11. Customer Payments / Credit
12. Returns
13. Voids (v1.1)
14. Inventory Adjustments
15. Dashboards / Reporting (incl. Paid/Credit tabs, Daily Cash Reconciliation)
16. Settings / Configuration
17. Audit / Activity

## 6. Critical Transaction Boundary
Every financial/inventory-mutating flow is one Postgres function, one transaction. Example — New Sale:
```
create_sale_v1(customer_id, employee_id, line_items[], payment_amount)
  → check caller role/permission
  → re-fetch current price/stock for every line server-side (ignore any client-sent price)
  → validate stock availability (no negative inventory)
  → check customer credit limit; return a warning flag if exceeded, still let Admin proceed
  → calculate line totals + sale total server-side
  → insert sale + sale_lines
  → insert payment record, calculate outstanding
  → insert inventory_movement rows, decrement inventory
  → insert audit_event
  → COMMIT (all-or-nothing)
```
If any step fails, the whole transaction rolls back — the app never ends up with a sale recorded but stock not deducted, or vice versa.

## 7. Mobile Structure
Feature-based folders, same pattern as before, adapted to Expo/React Native + TypeScript:
```
/app (or /src)
  /core        — Supabase client, auth context, shared types
  /auth
  /dashboard
  /sales
  /customers
  /products
  /inventory
  /suppliers
  /purchases
  /employees
  /payments
  /reports
  /settings
```
Each feature separates: screens (presentation), hooks/state (application logic), and a thin data layer (Supabase queries/RPC calls) — so business logic is never embedded directly in a screen component.

## 8. Extensibility
Inventory is modeled through a sellable product/variant concept so batch-level expiry can be added later (a new `batch_id` on inventory movements) without rewriting the sales flow. Do not implement full batch costing in MVP without a new ADR.

## 9. Portability
Even though this is Supabase-first, business logic lives in Postgres functions (standard SQL/PLpgSQL) and typed app code — not proprietary no-code workflows — so a future migration to a different Postgres host remains realistic if the product ever needs it.

## 10. Multi-Tenancy Readiness (for future "sell to other shops")
Every table includes a `shop_id` column from day one, and every RLS policy filters by `shop_id`, even though there is only one shop today. This is the cheapest possible insurance against the rebuild that would otherwise be needed when shop #2 signs up (see prior discussion). Adding this after the fact is expensive; adding it now costs almost nothing.
