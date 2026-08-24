# App Architecture — Agri Shop Management System

Routing plan, folder structure, state management, and data layer strategy.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | React 19 + Vite | Already configured |
| Styling | Tailwind CSS v4 | Already configured |
| Routing | React Router v6 | SPA navigation with nested routes |
| State | Zustand | Lightweight stores per domain; no boilerplate |
| Local DB | Supabase (Postgres) | Relational data, real-time, auth; connects via `make:supabase` skill |
| Auth | Supabase Auth + PIN | Custom PIN flow on top of Supabase sessions |
| Forms | React Hook Form | Fast, minimal re-renders |
| Date | date-fns | Lightweight date manipulation |
| Icons | Lucide React | Consistent icon set |

---

## Folder Structure

```
src/
├── main.tsx                        # Entrypoint
├── App.tsx                         # Router root + providers
├── index.css                       # Global styles + Tailwind
│
├── router/
│   ├── index.tsx                   # All route definitions
│   ├── AdminRoutes.tsx             # Admin-only route guard
│   └── EmployeeRoutes.tsx          # Employee-only route guard
│
├── stores/                         # Zustand stores
│   ├── authStore.ts                # Current user, role, session
│   ├── cartStore.ts                # Active cart/sale in progress
│   ├── settingsStore.ts            # App settings (thresholds, etc.)
│   └── uiStore.ts                  # Modals, toasts, loading states
│
├── lib/
│   ├── supabase.ts                 # Supabase client init
│   ├── db/                         # All database query functions
│   │   ├── users.ts
│   │   ├── companies.ts
│   │   ├── products.ts
│   │   ├── inventory.ts
│   │   ├── purchases.ts
│   │   ├── sales.ts
│   │   ├── customers.ts
│   │   ├── payments.ts
│   │   ├── returns.ts
│   │   ├── adjustments.ts
│   │   └── reports.ts
│   ├── businessRules.ts            # Shared rule functions (credit check, stock calc, etc.)
│   └── formatters.ts               # Currency, date, number formatters
│
├── types/
│   └── index.ts                    # All TypeScript types (mirrors DATA-MODEL.md)
│
├── hooks/
│   ├── useAuth.ts
│   ├── useCart.ts
│   ├── useSales.ts
│   ├── useInventory.ts
│   ├── useCustomers.ts
│   ├── useCompanies.ts
│   └── useReports.ts
│
├── pages/
│   ├── auth/
│   │   ├── LoginPage.tsx           # AUTH-LOGIN
│   │   └── LockedPage.tsx          # AUTH-LOCKED
│   │
│   ├── admin/
│   │   ├── dashboard/
│   │   │   ├── AdminDashboardPage.tsx
│   │   │   ├── DailyCashPage.tsx
│   │   │   └── ReportsPage.tsx
│   │   ├── sales/
│   │   │   ├── SalesListPage.tsx
│   │   │   ├── SaleDetailPage.tsx
│   │   │   ├── NewSalePage.tsx
│   │   │   ├── VoidSalePage.tsx
│   │   │   ├── ReceiptPage.tsx
│   │   │   └── RecordPaymentPage.tsx
│   │   ├── customers/
│   │   │   ├── CustomersListPage.tsx
│   │   │   ├── CustomerDetailPage.tsx
│   │   │   ├── AddEditCustomerPage.tsx
│   │   │   └── RecordCustomerPaymentPage.tsx
│   │   ├── products/
│   │   │   ├── ProductsListPage.tsx
│   │   │   ├── ProductDetailPage.tsx
│   │   │   └── AddEditProductPage.tsx
│   │   ├── inventory/
│   │   │   ├── InventoryListPage.tsx
│   │   │   ├── InventoryDetailPage.tsx
│   │   │   ├── StockAdjustmentPage.tsx
│   │   │   ├── ReorderAlertsPage.tsx
│   │   │   └── ExpiryMonitorPage.tsx
│   │   ├── companies/
│   │   │   ├── CompaniesListPage.tsx
│   │   │   ├── CompanyDetailPage.tsx
│   │   │   ├── AddEditCompanyPage.tsx
│   │   │   └── RecordSupplierPaymentPage.tsx
│   │   ├── purchases/
│   │   │   ├── PurchasesListPage.tsx
│   │   │   ├── PurchaseDetailPage.tsx
│   │   │   └── NewPurchasePage.tsx
│   │   ├── employees/
│   │   │   ├── EmployeesListPage.tsx
│   │   │   ├── EmployeeDetailPage.tsx
│   │   │   └── AddEditEmployeePage.tsx
│   │   ├── payments/
│   │   │   ├── PaymentsListPage.tsx
│   │   │   └── PaymentDetailPage.tsx
│   │   └── settings/
│   │       └── SettingsPage.tsx
│   │
│   └── employee/
│       ├── dashboard/
│       │   └── EmployeeDashboardPage.tsx
│       ├── sale/
│       │   ├── CartPage.tsx
│       │   ├── ProductPickerPage.tsx
│       │   ├── VariantSelectorPage.tsx
│       │   ├── SaleReviewPage.tsx
│       │   ├── PaymentEntryPage.tsx
│       │   └── SaleConfirmPage.tsx
│       ├── sales/
│       │   ├── SalesListPage.tsx
│       │   ├── SaleDetailPage.tsx
│       │   └── ReceiptPage.tsx
│       ├── customers/
│       │   ├── CustomersListPage.tsx
│       │   ├── CustomerDetailPage.tsx
│       │   └── AddCustomerPage.tsx
│       └── products/
│           ├── ProductsListPage.tsx
│           └── ProductDetailPage.tsx
│
├── components/
│   ├── layout/
│   │   ├── AdminLayout.tsx         # Admin shell + sidebar nav
│   │   ├── EmployeeLayout.tsx      # Employee shell + bottom nav
│   │   └── AuthLayout.tsx          # Centered login shell
│   ├── ui/                         # Base UI primitives (from design system)
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Badge.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── Toast.tsx
│   │   ├── Tabs.tsx
│   │   ├── Table.tsx
│   │   ├── SearchBar.tsx
│   │   ├── EmptyState.tsx
│   │   ├── LoadingSpinner.tsx
│   │   └── ConfirmDialog.tsx
│   ├── shared/
│   │   ├── StockStatusBadge.tsx
│   │   ├── PaymentTypeBadge.tsx
│   │   ├── CustomerOutstandingBadge.tsx
│   │   ├── SaleSummaryWidget.tsx   # Used in sales list tab headers
│   │   ├── QuantityCounter.tsx     # Cart +/− with delete-on-1
│   │   ├── CreditWarningBanner.tsx
│   │   ├── DateRangeFilter.tsx
│   │   └── ReceiptView.tsx
│   └── forms/
│       ├── ProductForm.tsx
│       ├── CustomerForm.tsx
│       ├── CompanyForm.tsx
│       ├── PurchaseForm.tsx
│       ├── PaymentForm.tsx
│       └── AdjustmentForm.tsx
│
└── imports/                        # Figma design imports (read-only)
    └── Canvas/
```

---

## Route Definitions

```tsx
// router/index.tsx

const routes = [
  { path: '/login', element: <LoginPage /> },
  { path: '/locked', element: <LockedPage /> },

  // Admin routes (guarded by role = 'admin')
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <AdminDashboardPage /> },
      { path: 'cash', element: <DailyCashPage /> },
      { path: 'reports', element: <ReportsPage /> },

      { path: 'sales', element: <SalesListPage /> },
      { path: 'sales/new', element: <NewSalePage /> },
      { path: 'sales/:id', element: <SaleDetailPage /> },
      { path: 'sales/:id/void', element: <VoidSalePage /> },
      { path: 'sales/:id/receipt', element: <ReceiptPage /> },
      { path: 'sales/:id/payment', element: <RecordPaymentPage /> },

      { path: 'customers', element: <CustomersListPage /> },
      { path: 'customers/new', element: <AddEditCustomerPage /> },
      { path: 'customers/:id', element: <CustomerDetailPage /> },
      { path: 'customers/:id/edit', element: <AddEditCustomerPage /> },
      { path: 'customers/:id/payment', element: <RecordCustomerPaymentPage /> },

      { path: 'products', element: <ProductsListPage /> },
      { path: 'products/new', element: <AddEditProductPage /> },
      { path: 'products/:id', element: <ProductDetailPage /> },
      { path: 'products/:id/edit', element: <AddEditProductPage /> },

      { path: 'inventory', element: <InventoryListPage /> },
      { path: 'inventory/:id', element: <InventoryDetailPage /> },
      { path: 'inventory/:id/adjust', element: <StockAdjustmentPage /> },
      { path: 'inventory/reorder', element: <ReorderAlertsPage /> },
      { path: 'inventory/expiry', element: <ExpiryMonitorPage /> },

      { path: 'companies', element: <CompaniesListPage /> },
      { path: 'companies/new', element: <AddEditCompanyPage /> },
      { path: 'companies/:id', element: <CompanyDetailPage /> },
      { path: 'companies/:id/edit', element: <AddEditCompanyPage /> },
      { path: 'companies/:id/payment', element: <RecordSupplierPaymentPage /> },

      { path: 'purchases', element: <PurchasesListPage /> },
      { path: 'purchases/new', element: <NewPurchasePage /> },
      { path: 'purchases/:id', element: <PurchaseDetailPage /> },

      { path: 'employees', element: <EmployeesListPage /> },
      { path: 'employees/new', element: <AddEditEmployeePage /> },
      { path: 'employees/:id', element: <EmployeeDetailPage /> },
      { path: 'employees/:id/edit', element: <AddEditEmployeePage /> },

      { path: 'payments', element: <PaymentsListPage /> },
      { path: 'payments/:id', element: <PaymentDetailPage /> },

      { path: 'settings', element: <SettingsPage /> },
    ]
  },

  // Employee routes (guarded by role = 'employee')
  {
    path: '/employee',
    element: <EmployeeLayout />,
    children: [
      { index: true, element: <EmployeeDashboardPage /> },

      { path: 'sale', element: <CartPage /> },
      { path: 'sale/products', element: <ProductPickerPage /> },
      { path: 'sale/products/:id/variant', element: <VariantSelectorPage /> },
      { path: 'sale/review', element: <SaleReviewPage /> },
      { path: 'sale/payment', element: <PaymentEntryPage /> },
      { path: 'sale/confirm', element: <SaleConfirmPage /> },
      { path: 'sale/receipt/:id', element: <ReceiptPage /> },

      { path: 'sales', element: <SalesListPage /> },
      { path: 'sales/:id', element: <SaleDetailPage /> },
      { path: 'sales/:id/receipt', element: <ReceiptPage /> },

      { path: 'customers', element: <CustomersListPage /> },
      { path: 'customers/new', element: <AddCustomerPage /> },
      { path: 'customers/:id', element: <CustomerDetailPage /> },

      { path: 'products', element: <ProductsListPage /> },
      { path: 'products/:id', element: <ProductDetailPage /> },
    ]
  },

  // Redirect root based on auth
  { path: '/', element: <RootRedirect /> },
  { path: '*', element: <Navigate to="/" /> },
]
```

---

## State Management

### Auth Store (`authStore.ts`)
```ts
{
  user: User | null
  role: UserRole | null
  isAuthenticated: boolean
  login: (pin: string) => Promise<void>
  logout: () => void
  lockSession: () => void
}
```

### Cart Store (`cartStore.ts`)
```ts
{
  customerId: string | null
  customer: Customer | null           // loaded on customer select — includes outstanding
  items: CartItem[]                   // { variantId, variantLabel, productName, qty, unitPrice }
  addItem: (variantId, qty, price) => void
  updateQty: (variantId, qty) => void // removes item if qty reaches 0
  removeItem: (variantId) => void
  clearCart: () => void
  subtotal: number                    // derived
  creditWarning: boolean              // derived from creditLimit check
}
```

### UI Store (`uiStore.ts`)
```ts
{
  toasts: Toast[]
  activeModal: string | null
  isLoading: boolean
  showToast: (message, type) => void
  openModal: (id) => void
  closeModal: () => void
}
```

---

## Data Layer Pattern

All database calls live in `src/lib/db/*.ts`. Pages and hooks never call Supabase directly.

```ts
// Example: src/lib/db/sales.ts
export async function createSale(payload: CreateSalePayload): Promise<Sale> { ... }
export async function getSaleById(id: string): Promise<Sale> { ... }
export async function getSalesByCustomer(customerId: string): Promise<Sale[]> { ... }
export async function voidSale(id: string, reason: string, adminId: string): Promise<void> { ... }
```

Business rule functions live in `src/lib/businessRules.ts`:
```ts
export function checkCreditLimit(customer: Customer, newOutstanding: number): CreditWarning | null
export function calculateStockStatus(batch: InventoryBatch, settings: Settings): StockStatus
export function validateReturnQuantity(saleItem: SaleItem, requestedQty: number): boolean
export function computeGrossProfit(sales: Sale[], batches: InventoryBatch[]): number
```

---

## Supabase Schema Summary

Tables to create in Supabase:
`users`, `companies`, `products`, `product_variants`, `inventory_batches`,
`purchases`, `supplier_payments`, `customers`, `sales`, `sale_items`,
`customer_payments`, `returns`, `return_items`, `inventory_adjustments`, `settings`

Row-level security (RLS):
- Admin role: full read/write on all tables
- Employee role: read on `products`, `product_variants`, `customers`, `sales`, `sale_items`, `customer_payments`; write on `sales`, `sale_items`, `customer_payments` (own), `customers`
- Purchase cost / gross profit columns: `SELECT` restricted to admin role at column level

---

## Navigation Layout Specs

### Admin Layout
- Left sidebar (desktop) / Bottom nav (mobile)
- Nav items: Dashboard, Sales, Customers, Products, Inventory, Companies, Purchases, Employees, Payments, Reports, Settings
- Active route highlighted with accent color (#A0D30A)
- User name + role badge in sidebar footer
- Session lock button

### Employee Layout
- Bottom tab bar (mobile-first)
- Tabs: Dashboard, New Sale, Sales, Customers, Products
- New Sale tab is primary action — large center button
- Top bar shows: shop name, current user name, session lock
