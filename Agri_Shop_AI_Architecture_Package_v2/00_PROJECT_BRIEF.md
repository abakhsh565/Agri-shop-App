# Project Brief

## What We're Building
A mobile application (Android first, iOS later) called the **Agri Shop Management System** — an internal retail management tool for a small agricultural retail shop selling sprays and seeds. It replaces manual registers/notebooks with a fast POS-style sales flow, inventory tracking, customer credit management, supplier payables, and admin-only profit reporting.

## Why
The shop currently tracks sales, credit, inventory, and supplier payments manually. This causes: no reliable view of stock levels, no enforced customer credit limits, no employee accountability trail, and no fast way to answer "what did we sell today, what do we owe, what's owed to us." The app solves this without turning the shop into a complex ERP — it should feel like a simple, fast retail POS.

## Target Users
- **Shop Owner/Admin** — full visibility: products, inventory, suppliers, purchases, cost, profit, employees, settings.
- **Employees (3–4)** — fast sales entry, customer lookup/credit, no access to cost/profit/supplier financials.
- **Co-Admin** (added later by Owner) — same permissions as Owner except cannot remove the original Owner.

## Business Model Context
Built solo, by a non-technical founder, directing AI coding tools (no in-house developer). Budget: effectively $0 for infrastructure (see `TECH_STACK.md`). Priority: ship a working MVP fast for the founder's own shop (first-mover advantage), with architecture that doesn't block selling the same product to other agri shops later.

## What This Is Not (Explicit Out-of-Scope for MVP)
- Not a multi-shop platform yet (schema is ready for it, feature is not built).
- Not a Farmer App or Marketplace (long-term vision only — see `docs/FUTURE_VISION.md`).
- Not a general-purpose ERP — no accounting/tax/payroll modules.
- Not supporting other product categories beyond Spray and Seed at launch.
- Not iOS at launch (Android first).
- Not implementing barcode scanning in the MVP itself — committed as Phase 8, immediately after (see `docs/BARCODE_INTEGRATION.md`).

## Success Looks Like
The Owner can answer, without asking anyone or checking a notebook: what sold today, who sold it, who owes the shop money, what the shop owes suppliers, what's low on stock, what's expiring, and what the gross profit was — for any date range.

## Source Documents
- `docs/product/PRD.md` — full requirements (authoritative).
- `docs/DECISION_REGISTER.md` — every locked/open/future decision.
- `docs/TECH_STACK.md` — exact technology choices.
