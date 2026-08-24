# AgriShop Impact Map — the dependency backbone

This is the **reference map** every Change Request (CR) points at. Instead of describing a
change vaguely ("the sales screen"), we name the exact **anchor** here (route, flow, store,
entity, i18n namespace). That is how we understand a change's dependencies and keep data,
flows, content, and screens synchronized.

> Keep this file current. When the app's structure changes (a new screen, store, or entity),
> update the relevant section here in the same CR that introduced it.

Legend: 🔒 = admin-only · 👤 = employee-facing · ♻️ = **shared page mounted in BOTH shells**
(a change here affects both personas — always double-check).

---

## 1. Shells & screens (`src/router/index.tsx`)

Two shells wrap the app: **admin** (`/admin/*`, `AdminLayout`, gated to `admin`/`co_admin`)
and **employee** (`/employee/*`, `EmployeeLayout`, any authenticated user). Persona gating is
`src/components/auth/ProtectedRoute.tsx` (client redirect) **and** Supabase RLS (authoritative).

### Auth (public, no shell)
| Route | Page |
|---|---|
| `/` | `SplashPage` |
| `/login` | `LoginPage` |
| `/login/otp` | `OTPVerifyPage` |
| `/login/pin-set` | `PINSetPage` |
| `/login/not-registered` | `NotRegisteredPage` |
| `/login/deactivated` | `DeactivatedPage` |

### Admin shell (`/admin`) 🔒
| Route | Page | Notes |
|---|---|---|
| `dashboard` | `AdminDashboardPage` | |
| `sale` → `sale/success` | sale-flow pages | ♻️ shared with employee |
| `sales` | `AdminSalesListPage` | admin version |
| `sales/:saleId` | `AdminSaleDetailPage` | admin version (has void) |
| `inventory` | `AdminInventoryPage` | |
| `inventory/new` | `AddProductPage` | |
| `inventory/:productId/adjust` | `InventoryAdjustPage` | |
| `customers*` | customers pages | ♻️ shared |
| `more` | `MoreMenuPage` | |
| `employees`, `employees/new`, `employees/:employeeId` | `EmployeesListPage`, `AddEmployeePage`, `EmployeeDetailPage` | |
| `companies`, `companies/new`, `companies/:companyId` | `CompaniesListPage`, `AddCompanyPage`, `CompanyDetailPage` | |
| `settings` | `AdminSettingsPage` | |
| `activity` | `ActivityLogPage` | ♻️ shared |
| `notifications` | `AdminNotificationsPage` | |
| `products`, `products/:productId` | `ProductsListPage`, `ProductDetailPage` | ♻️ shared |
| `purchases`, `purchases/new` | `AdminPurchasesPage`, `RecordPurchasePage` | |
| `reports` | `AdminReportsPage` | |
| `payments`, `payments/supplier/:companyId` | `AdminPaymentsPage`, `RecordSupplierPaymentPage` | |

### Employee shell (`/employee`) 👤
| Route | Page | Notes |
|---|---|---|
| `dashboard` | `DashboardPage` | |
| `sale` → `sale/success` | sale-flow pages | ♻️ shared with admin |
| `sales`, `sales/:saleId` | `SalesListPage`, `SaleDetailPage` | employee version |
| `sales/:saleId/return`, `.../return/confirm`, `.../return/success` | `ReturnSelectItemsPage`, `ReturnConfirmPage`, `ReturnSuccessPage` | returns = employee-only |
| `customers*` | customers pages | ♻️ shared |
| `products`, `products/:productId` | products pages | ♻️ shared |
| `search` | `SearchPage` | employee-only |
| `activity` | `ActivityLogPage` | ♻️ shared |
| `settings` | `SettingsPage` | employee version |

### ♻️ Shared pages (mounted in BOTH shells — edits hit both personas)
Entire **sale flow** (`SelectCustomerPage`, `BrowseProductsPage`, `VariantSelectorPage`,
`CartPage`, `SaleReviewPage`, `SaleSuccessPage`), **customers** (`CustomersListPage`,
`AddCustomerPage`, `CustomerProfilePage`, `CustomerPurchaseHistoryPage`,
`CustomerPaymentHistoryPage`, `RecordCustomerPaymentPage`), **products**
(`ProductsListPage`, `ProductDetailPage`), and `ActivityLogPage`. These build links via
`useShellBase()` (`src/lib/useShellBase.ts`) so navigation stays in the current shell.

---

## 2. Flows (ordered screen sequence → terminal write)

| Flow | Sequence | Write (db.ts → RPC) | Persona |
|---|---|---|---|
| **Sale** | SelectCustomer → BrowseProducts → VariantSelector → Cart → Review → Success | `rpcCreateSale` → `create_sale` | both |
| **Returns** | SaleDetail → ReturnSelectItems → ReturnConfirm → ReturnSuccess | `rpcProcessReturn` → `process_return` | employee |
| **Customer payment** | CustomerProfile → RecordCustomerPayment | `rpcRecordCustomerPayment` → `record_customer_payment` | both |
| **Supplier payment** | AdminPayments / CompanyDetail → RecordSupplierPayment | `rpcRecordSupplierPayment` → `record_supplier_payment` | admin |
| **Purchase** | AdminPurchases → RecordPurchase | `rpcCreatePurchase` → `create_purchase` | admin |
| **Add product** | AdminInventory → AddProduct | `rpcCreateProduct` → `create_product` | admin |
| **Stock adjust** | AdminInventory → InventoryAdjust | `rpcAdjustStock` → `adjust_stock` | admin |
| **Add employee** | EmployeesList → AddEmployee → EmployeeDetail | `employeesStore` (`users` table) | admin |
| **Add company** | CompaniesList → AddCompany → CompanyDetail | `companiesStore` | admin |
| **Add customer** | CustomersList → AddCustomer → CustomerProfile | `customersStore` | both |
| **Auth** | Splash → Login → OTPVerify → PINSet → dashboard | `src/lib/auth.ts` (Supabase OTP) | — |

---

## 3. State & data layer

### Zustand stores (`src/stores/`)
| Store | Owns |
|---|---|
| `authStore` | logged-in `User` + session (persisted); ends Supabase session on logout |
| `cartStore` | in-progress sale cart items |
| `customersStore` | customer list CRUD |
| `companiesStore` | suppliers/companies (🔒 admin data) |
| `employeesStore` | employees (rows in `users`) |
| `productsStore` | catalogue; employees read `product_variants_public` (no cost), admins read base tables |
| `salesStore` | sales list + `createSale` (RPC); snake↔camel mapping |
| `notificationStore` | Supabase Realtime feed; ref-counted shared channel; role-filtered |
| `offlineStore` | persisted pending-sales queue (offline mode) |
| `themeStore` | theme + language (persisted); backs i18n |
| `uiStore` | transient toasts only |
| `useBootstrapData` (hook) | loads all datasets + Realtime on shell mount; companies only for admins |

### Data access (`src/lib/db.ts`)
Writes (atomic, SECURITY DEFINER RPCs — never let stock go negative, price read server-side):
`rpcCreateSale`, `rpcCreatePurchase`, `rpcRecordCustomerPayment`, `rpcRecordSupplierPayment`,
`rpcAdjustStock`, `rpcCreateProduct`, `rpcProcessReturn`.
Reads: `fetchPurchases`, `fetchCustomerPayments`, `fetchStockAdjustments`, `fetchReturns`.
`friendly()` maps DB errors (`INSUFFICIENT_STOCK`, `NEGATIVE_STOCK`, `VARIANT_NOT_FOUND`) to UI
messages. Client: `src/lib/supabase.ts`. Migrations: `supabase/migrations/`.

---

## 4. Data model (`src/types/index.ts`)

**Enums:** `UserRole` (admin|co_admin|employee), `ProductCategory` (spray|seed|fertilizer|other),
`StockStatus`, `PaymentType` (full|partial|credit), `PaymentMethod` (cash|bank_transfer),
`CreditHealth`, `ReturnResolution` (refund_cash|credit_note), `AdjustmentType` (add|remove|set).

**Entities (key fields):**
- **User** — name, phone, role, isOriginalOwner, pin, isActive, employeeNumber, jobTitle,
  photoUrl, first/last login, deactivated*, createdBy.
- **Product** — name, company, category, imageUrl, variants[]. **ProductVariant** — productId,
  name, sku, sellingPrice, costPrice, stockQty, lowStockThreshold, expiryDate.
- **Customer** — name, phone, address, creditLimit, outstandingBalance, totalPurchases, totalPaid.
- **Sale** — saleNumber, customer/employee ids+names, items[], subtotal, taxAmount, totalAmount,
  amountPaid, outstandingBalance, paymentType, paymentMethod, void*, note. **SaleItem** /
  **CartItem** — product/variant ids+names, qty (+maxQty on cart), unitPrice, lineTotal.
- **CustomerPayment** — customerId, amount, method, notes, recordedBy(+Name), balanceAfter.
- **Return** / **ReturnItem** — returnNumber, saleId, items[], totalRefund, resolution, processedBy.
- **Company** — name, contactPerson, phone, address, logoUrl, outstandingPayable, totalPurchases.
- **Purchase** / **PurchaseItem** — purchaseNumber, company, items[], totalAmount, amountPaid,
  outstandingPayable, paymentMethod, (item) costPrice.
- **StockAdjustment** — product/variant, adjustmentType, qtyBefore/Change/After, reason, adjustedBy.
- **SearchResult** — type (product|customer|sale|payment), title, subtitle.
- **AppNotification** — inline in `notificationStore.ts` (kind, title, body, entity_id, actor_name,
  read, created_at); no standalone type in `src/types`.

---

## 5. Content / i18n (`src/lib/i18n.ts`)

Single centralized dictionary with two locales — **`en`** and **`ur`** (both fully populated).
`useT()` reads `language` from `themeStore` and returns `t(key, fallback?)` (falls back to
English, then the key). **Namespaces:** `nav.*`, `dashboard.*`, `sale.*`, `sales.*`,
`customers.*`, `addCustomer.*`, `products.*`, `returns.*`, `settings.*`, `recordPayment.*`,
`customerProfile.*`, `activity.*`, `common.*`, `admin.*`, `employees.*`.

> **Content-change rule:** user-facing text should live here (add/edit **both** `en` and `ur`).
> Some pages still hold inline literals — a content CR should migrate the touched literal into
> `i18n.ts` rather than editing it in place, so translations stay complete.

---

## 6. Cross-cutting concerns (a change must respect these)

- **Persona gating:** `ProtectedRoute.tsx` + Supabase RLS. Employees must never receive supplier
  financials, purchase/base cost, or gross profit (AGENTS.md Non-Negotiable).
- **Employee-safe reads:** `product_variants_public` view (no cost); role-filtered notifications
  (`notificationStore.ts` + RLS migration `0006`); companies loaded only for admins.
- **Shell-aware nav:** `useShellBase()` — shared pages must keep using `${base}/...`.
- **No hard delete (ADR-004):** financial/sales/inventory records corrected via
  reversal/return/adjustment, never destroyed. Never retroactively change a historical sale price.
- **Screen → entity quick map:** dashboard/sales→Sale · inventory/products→Product+Variant+
  StockAdjustment · customers→Customer+CustomerPayment · employees→User · companies→Company ·
  purchases→Purchase · payments→CustomerPayment/supplier payments · returns→Return ·
  notifications→AppNotification · search→SearchResult.
