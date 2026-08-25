# Graph Report - Agrishop Inventory management system - New  (2026-08-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 8862 nodes · 11309 edges · 280 communities (258 shown, 22 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 27 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6e0bb923`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- formatCurrency
- useThemeStore
- src/router/index.tsx
- useCustomersStore
- dev-guide-extracted/src/types/index.ts
- src/types/index.ts
- src/components/ui/StatusBar.tsx
- useUIStore
- src/lib/formatters.ts
- useThemeStore
- dev-guide-extracted/src/pages/admin/employees/AddEmployeePage.tsx
- compilerOptions
- useAuthStore
- @types/node
- dev-guide-extracted/src/router/index.tsx
- dev-guide-extracted/src/pages/admin/dashboard/AdminDashboardPage.tsx
- formatCurrency
- useProductsStore
- dependencies
- registry-sync.mjs
- src/lib/supabase.ts
- devDependencies
- devDependencies
- scripts
- scripts
- manifest.json
- dev-guide-extracted/src/pages/admin/companies/CompanyDetailPage.tsx
- kv_store.tsx
- dev-guide-extracted/vite.config.ts
- vite.config.ts
- OTPInput
- verify-migrations.mjs
- @capacitor/android
- exceljs
- tailwindcss
- @types/react
- build_types.js
- capacitor.config.ts
- dev-guide-extracted/capacitor.config.ts
- dev-guide-extracted/.figma/make/analyze-routes
- dev-guide-extracted/.figma/make/deploy
- dev-guide-extracted/.figma/make/deploy-preview
- dev-guide-extracted/.figma/make/dev
- dev-guide-extracted/.figma/make/format
- dev-guide-extracted/.figma/make/install
- dev-guide-extracted/.figma/make/langserver
- sw.js
- .figma/make/analyze-routes
- .figma/make/deploy
- .figma/make/deploy-preview
- .figma/make/dev
- .figma/make/format
- .figma/make/install
- .figma/make/langserver

## God Nodes (most connected - your core abstractions)
1. `formatCurrency()` - 82 edges
2. `useThemeStore` - 82 edges
3. `useThemeStore` - 70 edges
4. `formatCurrency()` - 64 edges
5. `useUIStore` - 52 edges
6. `StatusBar()` - 50 edges
7. `useT()` - 50 edges
8. `useAuthStore` - 49 edges
9. `useT()` - 48 edges
10. `StatusBar()` - 43 edges

## Surprising Connections (you probably didn't know these)
- `CustomersState` --references--> `Customer`  [EXTRACTED]
  dev-guide-extracted/src/stores/customersStore.ts → dev-guide-extracted/src/types/index.ts
- `inQuery()` --calls--> `formatCurrency()`  [EXTRACTED]
  src/pages/employee/sales/SalesListPage.tsx → src/lib/formatters.ts
- `handleResend()` --calls--> `sendOTP()`  [EXTRACTED]
  src/pages/auth/OTPVerifyPage.tsx → src/lib/auth.ts
- `lib` --extends--> `DOM.Iterable`  [EXTRACTED]
  dev-guide-extracted/tsconfig.json → tsconfig.json
- `include` --extends--> `vite.config.ts`  [EXTRACTED]
  dev-guide-extracted/tsconfig.json → tsconfig.json

## Import Cycles
- None detected.

## Communities (280 total, 22 thin omitted)

### Community 3 - "formatCurrency"
Cohesion: 0.07
Nodes (53): CategoryChip(), CreditHealthBadge(), StockBadge(), StockBadgeProps, QuantityCounter(), QuantityCounterProps, StatusBar(), rpcRecordCustomerPayment() (+45 more)

### Community 8 - "useThemeStore"
Cohesion: 0.06
Nodes (42): App(), PaymentBadge(), clearDeviceSession(), hasDeviceSession(), read(), saveDeviceSession(), formatDateTime(), formatTime() (+34 more)

### Community 14 - "src/router/index.tsx"
Cohesion: 0.06
Nodes (53): ProtectedRoute(), NOTE: this is the client-side gate. The authoritative enforcement is the, ADR-0006, ConfirmDialog(), ConfirmDialogProps, getUserFromSession(), normalizePhone(), ResolveResult (+45 more)

### Community 18 - "useCustomersStore"
Cohesion: 0.05
Nodes (56): PaymentBadge(), rpcCreateSale(), formatSmartDateTime(), timeAgo(), useCurrentTime(), AdminDashboardPage(), adminNotifRoute(), DateFilter (+48 more)

### Community 19 - "dev-guide-extracted/src/types/index.ts"
Cohesion: 0.05
Nodes (57): PaymentBadgeProps, CustomerPaymentRow, fetchCustomerPayments(), friendly(), PurchaseRow, ReturnRow, rpcAdjustStock(), rpcCreateProduct() (+49 more)

### Community 26 - "src/types/index.ts"
Cohesion: 0.04
Nodes (63): SelectOption, SelectSheet(), SelectSheetProps, generateProductBarcode(), CustomerPaymentRow, fetchPurchases(), friendly(), PurchaseRow (+55 more)

### Community 39 - "src/components/ui/StatusBar.tsx"
Cohesion: 0.07
Nodes (45): AuthLayout(), AuthLayoutProps, Button(), ButtonProps, EmptyState(), EmptyStateProps, Input, InputProps (+37 more)

### Community 52 - "useUIStore"
Cohesion: 0.07
Nodes (32): AdminLayout(), handleNavScan(), TAB_DEFS, EmployeeLayout(), handleEmpNavScan(), handlePINSubmit(), TAB_DEFS, PAD (+24 more)

### Community 65 - "src/lib/formatters.ts"
Cohesion: 0.06
Nodes (41): CategoryChip(), CreditHealthBadge(), PaymentBadgeProps, StockBadge(), StockBadgeProps, barcodeToSvg(), getStockStatus(), getStockStatusColor() (+33 more)

### Community 78 - "useThemeStore"
Cohesion: 0.09
Nodes (33): App(), clearDeviceSession(), hasDeviceSession(), read(), saveDeviceSession(), Keys, Lang, translations (+25 more)

### Community 79 - "dev-guide-extracted/src/pages/admin/employees/AddEmployeePage.tsx"
Cohesion: 0.07
Nodes (39): ImageUpload(), handleFile(), ImageUploadProps, getUserFromSession(), normalizePhone(), ResolveResult, touchLogin(), userFromRow() (+31 more)

### Community 83 - "compilerOptions"
Cohesion: 0.04
Nodes (46): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, jsx, lib, module, moduleResolution (+38 more)

### Community 97 - "useAuthStore"
Cohesion: 0.09
Nodes (26): ProtectedRoute(), NOTE: this is the client-side gate. The authoritative enforcement is the, ADR-0006, AdminLayout(), TAB_DEFS, EmployeeLayout(), handlePINSubmit(), TAB_DEFS (+18 more)

### Community 99 - "@types/node"
Cohesion: 0.67
Nodes (3): @types/node, @types/node, @types/node

### Community 101 - "dev-guide-extracted/src/router/index.tsx"
Cohesion: 0.10
Nodes (21): AuthLayout(), AuthLayoutProps, Button(), ButtonProps, Input, InputProps, NavHeader(), NavHeaderProps (+13 more)

### Community 102 - "dev-guide-extracted/src/pages/admin/dashboard/AdminDashboardPage.tsx"
Cohesion: 0.08
Nodes (24): SelectOption, SelectSheet(), SelectSheetProps, rpcCreatePurchase(), AddCompanyPage(), CompaniesListPage(), hashColor(), AdminDashboardPage() (+16 more)

### Community 105 - "formatCurrency"
Cohesion: 0.21
Nodes (15): formatCurrency(), formatDateTime(), PurchaseDetailPage(), AdminSaleDetailPage(), handleDownload(), handleShare(), ReturnResult, ReturnSuccessPage() (+7 more)

### Community 106 - "useProductsStore"
Cohesion: 0.08
Nodes (28): ConfirmDialog(), ConfirmDialogProps, SearchBar(), SearchBarProps, rpcDeleteProduct(), AddProductPage(), addVariant(), CATEGORIES (+20 more)

### Community 129 - "dependencies"
Cohesion: 0.08
Nodes (33): dependencies, @capacitor/app, @capacitor/core, @capacitor/splash-screen, @capacitor/status-bar, lucide-react, react, react-dom (+25 more)

### Community 162 - "registry-sync.mjs"
Cohesion: 0.16
Nodes (20): build(), [cmd, arg], COLUMNS, crFiles(), DIR, field(), impactedAreasSummary(), ingest() (+12 more)

### Community 163 - "src/lib/supabase.ts"
Cohesion: 0.13
Nodes (14): ImageUpload(), handleFile(), ImageUploadProps, ImageBucket, uploadImage(), supabase, supabaseUrl, CustomerProfilePage() (+6 more)

### Community 164 - "devDependencies"
Cohesion: 0.11
Nodes (18): @capacitor/ios, @tailwindcss/vite, typescript, devDependencies, @capacitor/ios, oxfmt, pg, supabase (+10 more)

### Community 165 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, @capacitor/cli, @electric-sql/pglite, oxfmt, @types/react-dom, vite, @vitejs/plugin-react, oxfmt (+9 more)

### Community 168 - "scripts"
Cohesion: 0.13
Nodes (14): name, private, scripts, build, cap:android, cap:ios, cap:sync, dev (+6 more)

### Community 169 - "scripts"
Cohesion: 0.13
Nodes (14): name, private, scripts, build, cap:android, cap:ios, cap:sync, dev (+6 more)

### Community 174 - "manifest.json"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, scope, short_name (+2 more)

### Community 175 - "dev-guide-extracted/src/pages/admin/companies/CompanyDetailPage.tsx"
Cohesion: 0.31
Nodes (7): EmptyState(), EmptyStateProps, fetchPurchases(), formatDate(), CompanyDetailPage(), AdminPurchasesPage(), Purchase

### Community 176 - "kv_store.tsx"
Cohesion: 0.31
Nodes (9): app, client(), del(), get(), getByPrefix(), mdel(), mget(), mset() (+1 more)

### Community 183 - "@capacitor/android"
Cohesion: 0.67
Nodes (3): @capacitor/android, @capacitor/android, @capacitor/android

### Community 184 - "exceljs"
Cohesion: 0.67
Nodes (3): exceljs, exceljs, exceljs

### Community 185 - "tailwindcss"
Cohesion: 0.67
Nodes (3): tailwindcss, tailwindcss, tailwindcss

### Community 186 - "@types/react"
Cohesion: 0.67
Nodes (3): @types/react, @types/react, @types/react

## Knowledge Gaps
- **258 isolated node(s):** `AuthLayoutProps`, `ButtonProps`, `InputProps`, `NavHeaderProps`, `OTPInputProps` (+253 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useThemeStore` connect `useThemeStore` to `src/lib/formatters.ts`, `src/lib/supabase.ts`, `src/components/ui/StatusBar.tsx`, `formatCurrency`, `src/router/index.tsx`, `useCustomersStore`, `src/types/index.ts`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **Why does `useUIStore` connect `useUIStore` to `src/lib/formatters.ts`, `src/lib/supabase.ts`, `src/components/ui/StatusBar.tsx`, `formatCurrency`, `src/router/index.tsx`, `useThemeStore`, `useCustomersStore`, `src/types/index.ts`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Why does `AdminDashboardPage()` connect `useCustomersStore` to `src/lib/formatters.ts`, `formatCurrency`, `useThemeStore`, `src/router/index.tsx`, `src/types/index.ts`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **What connects `AuthLayoutProps`, `ButtonProps`, `InputProps` to the rest of the system?**
  _258 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `imports/index.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.006872852233676976 - nodes in this community are weakly interconnected._
- **Should `dev-guide-extracted/src/imports/Canvas/index.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.006872852233676976 - nodes in this community are weakly interconnected._
- **Should `src/imports/Canvas/index.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.006872852233676976 - nodes in this community are weakly interconnected._