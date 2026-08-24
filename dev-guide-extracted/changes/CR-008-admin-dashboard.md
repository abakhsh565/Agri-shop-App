# CR-008 — Admin Dashboard — personalized header, period filter & sales summary (IA)

**Status:** Done
**Priority:** High
**Type:** IA
**Requested by:** Owner
**Persona:** Admin/co-admin
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Give the Owner/Admin the most useful shop information on the dashboard at a glance, with a clearer hierarchy and less duplicated information; personalize the header and make the sales summary filter by time period.

## Current behavior
The dashboard shows a generic "Good morning, Owner" greeting with a separate Owner label, multiple filter elements, and sales info spread/duplicated across Total Sales, Transaction, Gross Profit, Outstanding, Paid Sales, Credit Sales, Quick Actions, Quick Alerts, Employee Performance. The Today/Yesterday/This Week filter sits below the sales summary.

## Desired behavior
Order: 1) Greeting/header using the saved Owner/Admin name + current date (remove the separate Owner label), 2) one time-period filter row (All, Today, Yesterday, This Week…) that controls the figures below, 3) Total Sales card containing only Total Sales, Gross Profit, and Total Transactions, 4) Paid Sales, 5) Credit Sales, 6) Outstanding Credits, 7) Quick Actions, 8) Quick Alerts, 9) Employee Performance, 10) Recent Sales. Gross Profit = base/cost vs selling price for sales in the selected period; Outstanding = customer amounts owed; Paid/Credit Sales = paid/credit sales in the selected period.

## Impact Map
- **Screens:** `src/pages/admin/dashboard/AdminDashboardPage.tsx`
- **Flows:** dashboard viewing + period filtering (read-only)
- **Data & stores:** `salesStore`, `productsStore` (variant cost), `customersStore` (outstanding), `employeesStore`, `companiesStore` — all read
- **Content / i18n:** added `common.viewAll` (en + ur); reused `dashboard.*`, `sales.*`, `admin.*`
- **Backend / DB & Security:** no change; gross profit computed client-side from admin-loaded cost — admin-only screen, cost never enters employee bundles

### Details from your sheet
Data & stores: `useBootstrapData`, `salesStore`, customer/outstanding data, employee sales, recent sales. Content: `dashboard.*`, `admin.*`. Gross profit needs cost + selling price (admin-only — must never reach employee bundles). No backend change assumed until analyzed. Layout/IA: dashboard hierarchy and ordering change.

## Dependencies & conflicts
Agent fills the structured Impact Map bullets during per-CR Analyze. 

## Reviewer comments
Quick Actions and Quick Alerts already work and stay functionally unchanged. Employee Performance stays but moves to the requested position. Recent Sales added as a separate section. (Merged from two dashboard rows: sales-summary refinement + full IA re-ordering.)

## Open questions

## Implementation notes
- Header: greeting now uses the full saved name + current date; removed the separate "Owner" pill
  and "Owner Dashboard" subtitle; avatar shows `user.photoUrl` when present (else initials).
- Single time-period filter row (All / Today / Yesterday / This Week / This Month) moved **above**
  the summary; `dateFilter` drives all figures. Added `all`.
- Total Sales card (lime hero) keeps only Total Sales · Transactions · Gross Profit; removed the
  duplicate metric cards.
- **Gross Profit** now real: `Σ (unitPrice − variant.costPrice) × qty` over filtered sale items
  (was a flat 22% estimate). Paid = `Σ amountPaid`; Credit = `Σ totalAmount` of non-full sales;
  Outstanding = `Σ customer.outstandingBalance` (live owed).
- New **Recent Sales** section (5 most recent → sale detail) with a View all link.

## Verification
- `npx tsc --noEmit` clean; `pnpm run build` succeeds.
- On-screen: greeting shows saved name + today's date, no Owner label; changing the filter updates
  all figures; gross profit reflects cost vs price; Recent Sales lists latest sales and links to
  detail. Employee/Quick sections unchanged in behavior, reordered per spec.
