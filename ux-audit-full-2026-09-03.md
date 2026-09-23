# Full UX Audit — Agrishop Inventory Management System

**Date:** 2026-09-03
**Platform:** Mobile web app (React + Vite, mobile-first)
**Audience:** Mixed — shop owners/managers (mainstream) + employees (mainstream-to-expert)
**Stakes:** Money (credit sales, payments, outstanding balances)
**Evidence:** Live product screenshots, source code, contrast-check.py

---

## Global Issues (fix once, apply everywhere)

### G-01 — FAB Inconsistency (HIGH)
Different screens use different FAB styles:
- Customers: `+ Customers` (green bg, white text)
- Products: `+ Product +` (green bg, black text, extra "+")
- Action Center: `Create Group Reminder` (full-width green button, not FAB)

**Fix:** Standardize to one FAB pattern: icon + label, green bg, consistent text color, consistent positioning.

### G-02 — Summary Card Inconsistency (MEDIUM)
Dashboard and Sales page both show financial summaries but styled differently:
- Dashboard: Outlined bordered cards
- Sales: Filled background cards with different spacing

**Fix:** Create one shared summary card component.

### G-03 — More Menu "Customers" Redundancy (LOW)
"Customers" appears in both the bottom nav AND the More menu grid. This is confusing.

**Fix:** Remove "Customers" from the More menu since it's already in the bottom nav.

### G-04 — Empty State CTA Missing (MEDIUM)
"No sales recorded" has no call-to-action. The user sees an empty state but isn't guided to create a sale.

**Fix:** Add "Create your first sale" CTA button to empty states.

### G-05 — Credit Limit Section Over-Emphasis (MEDIUM)
Customer Profile shows a large red credit limit progress bar (100% used, red fill) that visually dominates the card. For a customer who is "Delayed", the most important info is the outstanding amount and due date, not the credit limit utilization.

**Fix:** De-emphasize the credit limit bar. Make outstanding amount and due date more prominent.

---

## Screen-by-Screen Findings

### DASHBOARD (AdminDashboardPage)

**DASH-01 — Summary cards lack icons (LOW)**
The three summary cards (Action Needed, Follow-ups, Out of Stock) show only text and a number. Adding subtle icons would improve scannability.
- Type: visual/hierarchy
- Effort: S

**DASH-02 — "Quick Alerts" section header is small and easy to miss (LOW)**
The "QUICK ALERTS" label is 11px uppercase. For the most important section below the fold, it could be slightly more prominent.
- Type: hierarchy
- Effort: S

**DASH-03 — Date filter pills overflow on small screens (MEDIUM)**
The horizontal date filter (All, Today, Yesterday, This Week, This Month) can overflow on narrower screens. "This Month" is already partially cut.
- Type: responsive
- Effort: S

### CUSTOMERS LIST (CustomersListPage)

**CUST-01 — Credit progress bar color inconsistency (LOW)**
Bilal Ahmed shows red progress bar (100% used), Ahmad Raza shows gray (1% used). The color coding is good but the bar height could be thinner for a cleaner look.
- Type: visual
- Effort: S

**CUST-02 — "Cash customer" badge color (LOW)**
Muhammad Ali shows "Cash customer" in blue. This is informational, not actionable. Consider using a more muted style.
- Type: visual
- Effort: S

### PRODUCTS LIST (ProductsListPage)

**PROD-01 — No product count or summary (LOW)**
Unlike the Customers list which shows "OUTSTANDING Rs. 4,690" and "ON CREDIT 3/6", the Products list has no summary. Adding a count or stock summary would help.
- Type: content
- Effort: S

**PROD-02 — "TestPesticide" product name (LOW)**
A product named "TestPesticide" appears in the real product list. This looks like test data in production.
- Type: content
- Effort: S (data cleanup, not code)

### SALES LIST (AdminSalesListPage)

**SALES-01 — Summary cards use green text for amounts (MEDIUM)**
"PAID SALES Rs. 0" uses green text. "CREDIT SALES Rs. 0" uses red text. But the amounts are all zero, making the color coding confusing — green usually means positive, red means negative, but here both are just categories.
- Type: visual/hierarchy
- Effort: S

**SALES-02 — Empty state lacks CTA (MEDIUM)**
"No sales recorded" has no action button. The user should be guided to create a sale.
- Type: interaction
- Effort: S

### ACTION CENTER (RemindersOverviewPage)

**AC-01 — "Create Group Reminder" button is full-width green (LOW)**
This is the only full-width green button on any screen. On the Dashboard, FABs are used. On Action Center, it's a full-width button. Consider using a FAB for consistency.
- Type: consistency
- Effort: S

**AC-02 — Sub-tab "Credit Approval" text truncated on narrow screens (MEDIUM)**
The sub-tab "Credit Approval" can get cut off on narrower viewports. Consider shorter label "Credit" or "Approval".
- Type: responsive
- Effort: S

### CUSTOMER PROFILE (CustomerProfilePage)

**PROF-01 — Credit limit section too prominent (MEDIUM)**
The CREDIT LIMIT section with its large red progress bar visually dominates the card. For a "Delayed" customer, the outstanding balance and due date are more important.
- Type: hierarchy
- Effort: M

**PROF-02 — Multiple action buttons at bottom (LOW)**
Purchase History, Payment History, Reminder History, Record Payment, Edit Customer, Delete Customer — six buttons. This is a lot. Consider grouping or using a menu for less-used actions.
- Type: hierarchy
- Effort: M

### MORE MENU (MoreMenuPage)

**MORE-01 — "Customers" redundant with bottom nav (LOW)**
"Customers" appears in the More menu grid AND in the bottom navigation. Remove from More menu.
- Type: navigation/consistency
- Effort: S

**MORE-02 — Grid items lack visual hierarchy (LOW)**
All grid items look the same size and weight. Some items (Settings, Reports) are used more frequently than others (Generate Barcodes, Reorder Suggestions). Consider grouping by frequency.
- Type: hierarchy
- Effort: M

### BOTTOM NAVIGATION

**NAV-01 — "More" button is a dark circle (LOW)**
The "More" button in the bottom nav is a dark circle with no label, while all other items have icons + labels. This inconsistency is intentional (it's the overflow menu) but could be clearer.
- Type: consistency
- Effort: S

---

## Priority Backlog

1. **G-01** — Standardize FAB component (HIGH, M)
2. **SALES-02** — Add CTA to empty sales state (MEDIUM, S)
3. **DASH-03** — Fix date filter overflow (MEDIUM, S)
4. **AC-02** — Fix "Credit Approval" truncation (MEDIUM, S)
5. **G-02** — Standardize summary cards (MEDIUM, M)
6. **PROF-01** — De-emphasize credit limit bar (MEDIUM, M)
7. **G-03** — Remove redundant "Customers" from More menu (LOW, S)
8. **DASH-01** — Add icons to summary cards (LOW, S)
9. **PROD-01** — Add product count summary (LOW, S)
10. **G-04** — Add CTA to all empty states (MEDIUM, S)
