# Implementation Roadmap

## Phase 0 — Architecture Foundation
- Validate PRD against finalized designs.
- Approve technology stack.
- Approve security/threat model.
- Finalize API and database schemas.
- Scaffold project.
- Configure CI.

## Phase 1 — Identity and Foundation
- Authentication.
- Roles/permissions.
- Employee lifecycle.
- Core settings.
- Audit foundation.

## Phase 2 — Master Data
- Companies.
- Products.
- Spray variants.
- Seed pricing.
- Customers.

## Phase 3 — Inventory and Purchases
- Stock-in.
- Inventory.
- Supplier payable.
- Supplier payments.
- Expiry/stock statuses.
- Adjustments.

## Phase 4 — Sales and Customer Credit
- New sale.
- Multi-line sales.
- Full/partial payment.
- Customer outstanding.
- Customer payments.
- Employee sales tracking.

## Phase 5 — Returns
- Original-sale-based returns.
- Refund/credit adjustment.
- Inventory restoration.

## Phase 6 — Dashboards and Reports
- Employee dashboard.
- Admin dashboard.
- Gross profit.
- Filters/drill-down.

## Phase 7 — Hardening
- Security testing.
- Load/performance testing.
- Observability.
- Backup/restore validation.
- Production readiness.

## Future
- Batch-level inventory/expiry.
- Advanced batch costing.
- Advanced returns/exchanges.
- Additional categories.

## Phase 8 — Inventory Automation & Integrations (planned)
Goal: connect an external/automated inventory management system so stock and
reordering are driven programmatically, not just by manual entry.
- Auto-reorder triggers when stock crosses reorder thresholds.
- Inbound integration: external inventory/ERP system can push stock-in and
  adjustments (with audit + authorization, per SECURITY.md).
- Outbound events: sales/returns/adjustments emit change events for downstream
  systems.
- Scheduled jobs (e.g. expiry sweeps, low-stock alerts).
Supported on the current stack via Supabase: Edge Functions (custom HTTP
endpoints / webhooks), Database Webhooks + Realtime (change events),
pg_cron (scheduled jobs), and the auto-generated REST/GraphQL API. No stack
change required; add an ADR when the specific integration is chosen.
