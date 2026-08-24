# AgriShop Change Registry — control panel

This folder is the **single source of truth** for iterative changes to AgriShop's UX flows,
content, information architecture, user data, and screen context. Every change is captured as
one file, analyzed for impact, reviewed, approved, and implemented **one at a time** — so
related data, flows, content, and screens stay synchronized.

It sits **on top of** the existing governance (it does not replace it):
`CHANGELOG.md` records what shipped · `ADR-*.md` records architectural decisions ·
`ROADMAP.md` records the phased plan. The source-of-truth priority order in `AGENTS.md` still
governs any conflict.

## Files here
- **`README.md`** (this file) — the index + how it works.
- **`IMPACT_MAP.md`** — the dependency backbone: the app's routes, flows, stores, data
  entities, and i18n namespaces. Every CR points at anchors defined here.
- **`_TEMPLATE.md`** — copy this to start a new change.
- **`CR-00N-*.md`** — one file per change.

---

## Your editable copy — `AgriShop-Change-Registry.xlsx`
You don't have to edit Markdown. There's a friendly **Excel workbook** in this folder
(`AgriShop-Change-Registry.xlsx`) — open it in Excel, Google Sheets, or Numbers. Edit statuses,
refine wording, add rows for new changes, and write in the **"Your comments / requested edits"**
column. To add a brand-new change, fill a new row and **leave the ID blank**. Save, send it back,
and the agent syncs it in.

Under the hood the Markdown `CR-*.md` files stay the machine-readable **source of truth**; the
workbook is generated from them and read back into them, so both are always in sync:
```
node changes/registry-sync.mjs build      # Markdown → refresh the .xlsx + the index table below
node changes/registry-sync.mjs ingest     # your edited .xlsx → update the Markdown, then rebuild
```
(Shortcuts: `pnpm run registry:build` / `pnpm run registry:ingest`.) Agent-filled sections
(Impact Map, Dependencies, Implementation notes) show read-only in the sheet and are never
overwritten by your edits.

## Index
*(auto-generated from the CR files by `registry:build` — don't hand-edit between the markers.)*

<!-- INDEX:START -->
| ID | Title | Type | Priority | Status | Impacted areas |
|----|-------|------|----------|--------|----------------|
| [CR-001](CR-001-tabbar-padding.md) | Bottom tab-bar horizontal padding | UX | Low | Done | src/components/layout/AdminLayout.tsx |
| [CR-002](CR-002-supabase-phone-auth-config.md) | Supabase phone-auth provider + test numbers | Data | High | Proposed | /login, /login/otp, /login/pin-set |
| [CR-003](CR-003-revoke-exposed-token.md) | Revoke previously exposed access token | Bugfix | High | Proposed | Supabase project settings — no client code |
| [CR-004](CR-004-argon2id-pin-hashing.md) | Server-side Argon2id PIN hashing | Data | Medium | Deferred | /login/pin-set |
| [CR-005](CR-005-on-device-verification.md) | Live end-to-end on-device verification | Bugfix | High | Proposed | Sale, Returns, Customer/Supplier payment, Purchase, Stock adjust, Auth |
| [CR-006](CR-006-apk-build-handover.md) | APK build + handover | Data | High | Proposed | Capacitor, BUILD_MOBILE.md |
| [CR-007](CR-007-auth-login.md) | Auth & login experience | UX | Medium | Draft | /, /login, /login/otp, /login/pin-set, /login/not-registered, /logi… |
| [CR-008](CR-008-admin-dashboard.md) | Admin Dashboard — personalized header, period filter & sales summary (IA) | IA | High | Done | src/pages/admin/dashboard/AdminDashboardPage.tsx |
| [CR-009](CR-009-employee-dashboard.md) | Employee dashboard | UX | Medium | Draft | /employee/dashboard DashboardPage |
| [CR-010](CR-010-sale-flow.md) | Sale flow — customer, product, variant and completion experience | Mixed | High | Proposed | ♻️ SelectCustomer → BrowseProducts → VariantSelector → Cart → Revie… |
| [CR-011](CR-011-sales-list-detail.md) | Sales list & detail — data ownership, filtering and actions | Mixed | High | Proposed | sales, sales/:saleId |
| [CR-012](CR-012-returns.md) | Returns (employee) | Mixed | Medium | Draft | ReturnSelectItems → ReturnConfirm → ReturnSuccess |
| [CR-013](CR-013-inventory-products.md) | Inventory & Products — product actions, Add Product and image persistence | Mixed | High | Done | AdminInventoryPage, AddProductPage, new route inventory/:productId/… |
| [CR-014](CR-014-customers-payments.md) | Customers & customer payments — actions, profile and detail UI | Mixed | Medium | Done | ♻️ CustomersListPage, CustomerProfilePage, CustomerPaymentHistoryPage |
| [CR-015](CR-015-employees.md) | Employees (admin) | Mixed | Medium | Draft | employees, employees/new, employees/:id |
| [CR-016](CR-016-companies-suppliers.md) | Companies, Products & Purchases — management actions and UI consistency | Mixed | High | Done | CompaniesListPage, CompanyDetailPage, ProductDetailPage ♻️, AdminPu… |
| [CR-017](CR-017-purchases.md) | Purchases (admin 🔒) | Mixed | Medium | Draft | purchases, purchases/new |
| [CR-018](CR-018-reports.md) | Reports (admin 🔒) | UX | Medium | Draft | /admin/reports AdminReportsPage |
| [CR-019](CR-019-notifications.md) | Notifications (both personas) | Mixed | Medium | Draft | /admin/notifications AdminNotificationsPage; employee dashboard feed |
| [CR-020](CR-020-search.md) | Search (employee) | UX | Medium | Draft | /employee/search SearchPage |
| [CR-021](CR-021-settings.md) | Settings & preferences | UX | Medium | Draft | /admin/settings AdminSettingsPage, /employee/settings SettingsPage |
| [CR-022](CR-022-activity-log.md) | Activity log (shared ♻️) | UX | Medium | Draft | ♻️ ActivityLogPage |
| [CR-023](CR-023-content-i18n.md) | Content & translations (en + ur) | Content | Medium | Draft | app-wide copy |
| [CR-024](CR-024-navigation-ia.md) | Navigation & information architecture | IA | Medium | Draft | AdminLayout, EmployeeLayout tab bars, MoreMenuPage, useShellBase |
| [CR-025](CR-025-hide-tabbar-nested.md) | Hide bottom tab bar on deeper / nested screens | UX | Medium | Done | src/components/layout/AdminLayout.tsx, src/components/layout/Employ… |
| [CR-026](CR-026-otp-input-verify.md) | Improve phone OTP input and verification flow | UX | Medium | Proposed | /login, /login/otp |
| [CR-027](CR-027-owner-profile-image.md) | Owner profile image upload and persistence | UX | Medium | Proposed | Admin profile / dashboard avatar |
<!-- INDEX:END -->

### How the board is seeded
The registry now covers the **whole app**, so nothing lives only in chat:
- **CR-002 … CR-006** — the real known backlog, as proper CRs: Supabase phone-auth config,
  revoke the exposed token, Argon2id PIN hashing (ROADMAP #2), on-device verification, APK handover.
- **CR-007 … CR-024** — one **Draft placeholder per app area** (auth, dashboards, sale flow,
  sales, returns, inventory/products, customers/payments, employees, companies, purchases,
  reports, notifications, search, settings, activity log, content/i18n, navigation/IA). Each is
  pre-tagged with the exact screens/flows/stores it touches. Open any area, describe the change
  you want in **Goal / Desired behavior**, set **Status: Proposed**, and send it back.

---

## Lifecycle

```
Draft → Proposed → Approved → In Progress → Implemented → Verified → Done
                     └─────────────→ Rejected | Deferred
```

| Status | Meaning | Who |
|---|---|---|
| **Draft** | Being written; details still forming. | user or agent |
| **Proposed** | Ready for impact analysis. | user |
| **Approved** | Impact understood, greenlit to build. | user |
| **In Progress** | Being implemented. | agent |
| **Implemented** | Code changed; awaiting verification. | agent |
| **Verified** | Checks + on-screen verification passed. | agent |
| **Done** | Verified + CHANGELOG updated + index row set. | agent |
| **Rejected / Deferred** | Not doing it now (keep the file for history). | user |

---

## How to add a change
1. Copy `_TEMPLATE.md` → `CR-00N-<short-slug>.md` (next free number).
2. Fill the header + **Goal / Current behavior / Desired behavior** in plain language.
   (Leave *Impact Map*, *Dependencies*, *Implementation notes* blank — the agent fills those.)
3. Set `**Status:** Proposed` and send it back / commit it, or just tell the agent in chat.

## How the agent handles it
1. **Analyze** — fills the **Impact Map** and **Dependencies & conflicts** against
   `IMPACT_MAP.md`; flags any ♻️ shared-page reach (affects both admin & employee), any shared
   data path, and any clash with a Non-Negotiable Rule; raises **Open questions**.
2. **Wait for approval** — you review/edit and set `**Status:** Approved` (or say so in chat).
3. **Implement** — one approved CR at a time, updating **every** impacted screen, flow, content
   key, and data path together. Status → In Progress → Implemented.
4. **Verify & close** — `npx tsc --noEmit` + `pnpm run build` when code changed, plus the CR's
   own on-screen Verification steps → Verified/Done; append `CHANGELOG.md`; update the index row.

## Ties into existing governance
- Every **Done** CR gets a `CHANGELOG.md` entry.
- A CR that changes architecture/stack/tooling **spawns an `ADR-*.md`** (per the ADR change
  policy) and links to it.
- Roadmap-scale CRs link to the relevant `ROADMAP.md` phase.
