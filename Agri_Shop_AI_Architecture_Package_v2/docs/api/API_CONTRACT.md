# API Contract — Baseline (v2, Supabase)

There is no separate REST server to design from scratch. The API surface is two kinds of calls, both via the Supabase client SDK from the mobile app.

## 1. Direct Reads (RLS-scoped)
Used for: product lists, inventory lists, customer lists/detail, dashboards, reports, sales history.
- Standard Supabase table/view queries with filters, pagination, sorting.
- Security enforced entirely by Row Level Security policies per table/role — the query itself cannot return rows the caller's role shouldn't see (e.g. an Employee query against `products` never returns `base_cost`, enforced by a column-level or view-level policy, not app logic).
- All list queries must be paginated; no unbounded `select *` on growing tables.

## 2. RPC / Edge Functions (authoritative writes)
Used for every operation with financial or inventory impact. Naming convention: `<action>_v<version>`.

| Function | Purpose |
|---|---|
| `create_sale_v1` | New sale: validates stock/price/credit, writes sale+lines+payment+inventory movement atomically |
| `record_customer_payment_v1` | Records a customer payment, updates outstanding |
| `create_purchase_v1` | Stock-in: adds inventory, updates supplier payable |
| `record_supplier_payment_v1` | Records a supplier payment, updates payable |
| `create_return_v1` | Validates against original sale, restores inventory, adjusts customer balance |
| `void_sale_v1` | Admin-only, time-window-checked, reverses a sale, flags as voided |
| `adjust_inventory_v1` | Admin-only, reason-required, records movement |
| `deactivate_employee_v1` | Deactivates without deleting; preserves historical references |
| `get_dashboard_summary_v1` | Server-computed aggregate (avoids trusting any client-side math on totals/profit) |
| `get_profit_report_v1` | Admin-only, computes gross profit for a given period |

## Conventions
- All functions run as `SECURITY DEFINER` with an internal role/permission check as the first step — never rely on the client having called the "right" function; verify server-side regardless of which function was called.
- All functions are wrapped in a single Postgres transaction — partial writes are not possible.
- All functions validate every input server-side (type, range, existence) before any write.
- Idempotency: sale/payment/purchase-creating functions accept an optional client-generated `idempotency_key` to protect against duplicate submission from a flaky connection (a real-world case for shop staff on patchy rural internet).
- Every write function inserts a corresponding `audit_event` row.

## Versioning
A breaking change to a function's inputs/outputs creates a new `_v2` function rather than mutating `_v1` in place, so an older installed app build (before staff have updated) keeps working until they update.

## Documentation Rule
Maintain a living table of RPC functions (inputs, outputs, permission required, invariants enforced) in this file as functions are added — this file is the OpenAPI-equivalent for this project.
