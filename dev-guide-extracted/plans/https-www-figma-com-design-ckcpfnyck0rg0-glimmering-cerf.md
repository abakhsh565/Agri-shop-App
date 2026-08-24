# Plan: Auth Screens + Employee-Side App

## Context

The codebase currently contains only a static Figma canvas render (`App.tsx` → `Canvas`). No router, no stores, no pages exist yet. All architecture and business logic is documented in PRD.md, AUTH.md, SCREENS.md, BUSINESS-RULES.md, APP-ARCHITECTURE.md, and COMPONENTS.md.

The user wants to:
1. Build proper Login/Signup screens (all auth flows from AUTH.md)
2. Build the complete Employee side of the app (17 screens)
3. Inter font throughout, design tone matching MIRA brand system + ChatGPT-app aesthetic (dark, minimal, mobile-first)
4. Every screen must handle all edge cases, loading states, error states, and empty states
5. Employee sets a password/PIN after OTP verification

The Figma file URL (`/design/CKcpfNyCK0rg0yOifpVCux/`) requires Figma authentication to access; design will be implemented using the MIRA brand tokens established in the existing design system (Canvas import) and the detailed AUTH.md + SCREENS.md specs.

---

## Design Tokens (from Figma — 18 frames documented in DESIGN-NOTES.md)

```
Background:    #FFFFFF
Card bg:       #F5F5F5
Border input:  1px solid #000000
Border light:  1px solid #E5E5E5
Text primary:  #000000
Text muted:    #888888
Primary btn:   #000000 bg / #FFFFFF text
Success green: #22C55E
Warning:       #F59E0B
Error red:     #EF4444
Font:          Geist (400/500/600/700) — Google Fonts
Input radius:  24px (pill)
Button radius: 100px (full pill)
Card radius:   12px
```

App is **light theme** (white/off-white). All screens confirmed from Figma imports.

---

## Packages to Install

```
react-router-dom   @6
zustand            latest
lucide-react       latest
```

No Supabase in this pass — auth uses **mock/local state** (localStorage simulation) so the full UI can be built and tested before backend wiring. A clear `// TODO: replace with Supabase` comment on every mock call.

---

## File Structure to Create

```
src/
├── App.tsx                          UPDATE — wrap with RouterProvider
├── index.css                        UPDATE — fix design tokens to MIRA spec
├── router/
│   └── index.tsx                    All routes + role guards
├── stores/
│   ├── authStore.ts                 User, role, session, PIN flow state
│   ├── cartStore.ts                 Active sale cart
│   └── uiStore.ts                   Toasts, modals, loading
├── lib/
│   ├── mock/
│   │   ├── auth.ts                  Mock OTP send/verify, PIN check, user lookup
│   │   ├── sales.ts                 Mock sale data
│   │   ├── customers.ts             Mock customer data
│   │   ├── products.ts              Mock product + inventory data
│   │   └── seed-data.ts             Realistic Agri seed data (products, customers, sales)
│   ├── businessRules.ts             Credit limit check, stock status, FIFO deduction
│   └── formatters.ts                Rs. currency, date, KG/ml
├── types/
│   └── index.ts                     All types from DATA-MODEL.md
├── hooks/
│   ├── useAuth.ts
│   ├── useCart.ts
│   └── useToast.ts
├── components/
│   ├── layout/
│   │   ├── EmployeeLayout.tsx       Bottom tab nav + top bar + session lock
│   │   └── AuthLayout.tsx           Centered dark shell
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Input.tsx                With states: default/focused/error/disabled
│   │   ├── OTPInput.tsx             6-box OTP with auto-advance + paste support
│   │   ├── PINInput.tsx             4-dot PIN input with number pad
│   │   ├── Badge.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── Toast.tsx + ToastContainer.tsx
│   │   ├── Tabs.tsx                 With summary widget slot
│   │   ├── SearchBar.tsx
│   │   ├── EmptyState.tsx
│   │   ├── LoadingSpinner.tsx
│   │   └── ConfirmDialog.tsx
│   └── shared/
│       ├── StockStatusBadge.tsx
│       ├── PaymentTypeBadge.tsx
│       ├── CustomerOutstandingBadge.tsx
│       ├── SaleSummaryWidget.tsx
│       ├── QuantityCounter.tsx      Delete-on-1 behavior
│       ├── CreditWarningBanner.tsx
│       ├── DateRangeFilter.tsx
│       └── ReceiptView.tsx
│
└── pages/
    ├── auth/
    │   ├── LandingPage.tsx          Log In / Create New Shop
    │   ├── PhoneEntryPage.tsx       Phone number input
    │   ├── OTPVerifyPage.tsx        6-digit OTP + resend + countdown
    │   ├── PINSetPage.tsx           Set 4-digit PIN (first login)
    │   ├── PINEntryPage.tsx         Enter PIN (returning, same device)
    │   ├── ShopSetupPage.tsx        Admin only — shop name
    │   ├── NotRegisteredPage.tsx
    │   └── DeactivatedPage.tsx
    │
    └── employee/
        ├── dashboard/
        │   └── EmployeeDashboardPage.tsx
        ├── sale/
        │   ├── CartPage.tsx
        │   ├── ProductPickerPage.tsx
        │   ├── VariantSelectorPage.tsx
        │   ├── SaleReviewPage.tsx
        │   ├── PaymentEntryPage.tsx
        │   └── SaleConfirmPage.tsx
        ├── sales/
        │   ├── SalesListPage.tsx    Tabs: All / Credit / Paid
        │   ├── SaleDetailPage.tsx
        │   └── ReceiptPage.tsx
        ├── customers/
        │   ├── CustomersListPage.tsx
        │   ├── CustomerDetailPage.tsx
        │   ├── CustomerPurchaseHistoryPage.tsx
        │   ├── CustomerPaymentHistoryPage.tsx
        │   ├── RecordCustomerPaymentPage.tsx
        │   └── AddCustomerPage.tsx
        ├── products/
        │   ├── ProductsListPage.tsx
        │   └── ProductDetailPage.tsx
        ├── returns/
        │   ├── ReturnSelectItemsPage.tsx
        │   └── ReturnConfirmPage.tsx
        ├── search/
        │   └── SearchPage.tsx
        └── settings/
            └── SettingsPage.tsx
```

---

## Implementation Steps

### Step 1 — Foundation
- Install `react-router-dom`, `zustand`, `lucide-react`
- Update `src/index.css`: fix tokens to MIRA spec (#A0D30A accent, #0B0C0E bg), keep Inter + Geist Mono imports
- Create `src/types/index.ts` with all types from DATA-MODEL.md + AUTH.md
- Create `src/lib/formatters.ts` (Rs. currency, date, weight)
- Create `src/lib/businessRules.ts` (creditLimitCheck, stockStatusCalc)
- Create `src/stores/authStore.ts`, `cartStore.ts`, `uiStore.ts`
- Create `src/lib/mock/seed-data.ts` with realistic data (Janja Spray variants, 3 customers with outstanding, 2 employees)

### Step 2 — Base UI Components
Build all components in `src/components/ui/` and `src/components/shared/`.
Key components with full state coverage:
- `OTPInput`: 6 boxes, auto-advance on digit, backspace to previous box, paste support (split 6 digits), disabled state
- `PINInput`: 4 dots (filled/empty), number pad 1–9 + 0 + backspace, shake animation on error
- `Button`: all 5 variants + loading spinner state
- `Input`: all 4 states with error message + helper text
- `Toast`: success/error/warning/info, auto-dismiss, stacked

### Step 3 — Auth Screens (8 screens, all edge cases)

**LandingPage** — White screen, AgriShop logo (black circle 80px with white sprout icon), "Log in" + "Create a new shop" buttons. Offline banner if no network.

**PhoneEntryPage** — Phone input with format validation (must be 10–11 digits, numeric). "Continue" disabled until valid. Loading on submit. Two contexts: `login` (existing user) and `signup` (new shop).

**OTPVerifyPage** — 6-box OTP, 5:00 countdown timer, resend after 30s (max 3 resends). States: default → submitting → wrong (attempts remaining) → expired → locked (10 min). Back clears OTP. Context flows:
- `signup` → PhoneEntry decides: go to ShopSetupPage
- `login, first device` → check registered/deactivated → PINSetPage or PINEntryPage
- `login, known device` → skipped (PIN only)
- `forgot-pin` → PINSetPage

**PINSetPage** — "Set a 4-digit PIN" heading, 4-dot input, number pad. Confirmation step (re-enter PIN). Mismatch → shake + "PINs don't match". Success → navigate to destination.

**PINEntryPage** — "Enter your PIN", user name shown, "Forgot PIN?" → OTP re-verify flow. "Not you?" → logout. No lockout (OTP is real auth; PIN is convenience).

**ShopSetupPage** — Admin only. Shop name text input, "Continue". Validates non-empty. On success → PINSetPage → Admin dashboard (out of scope for this build — shows placeholder).

**NotRegisteredPage** — "This number isn't registered." Sub-message pointing to admin. "Create a new shop" CTA only. No employee signup option.

**DeactivatedPage** — "Your access has been revoked." Contact admin. No action available.

**SessionLockedPage** (in EmployeeLayout) — Overlay, user name, PIN input, "Not you?" logout.

### Step 4 — Employee Layout
`EmployeeLayout.tsx`:
- Full-height, dark shell
- **Top bar**: shop name (left), user first name + lock icon (right). Tap lock → session lock overlay.
- **Bottom tab bar**: Dashboard | New Sale (accent center) | Sales | Customers | Products
- Active tab: accent color icon + label
- Session lock overlay renders above all content when `authStore.isLocked === true`
- Safe area padding for mobile notch/home indicator

### Step 5 — Employee Dashboard
Metrics shown (Today by default):
- Total Sales (Rs. amount)
- Transactions count
- Paid / Credit counts (side by side) — **Enhancement per SCREENS.md**
- Customers served
- Recent Sales list (last 5, each with customer name, amount, paid/credit badge)
- Outstanding credit activity (customers with balance > 0)

Date filter: Today / Yesterday / This Week / This Month / Custom

No profit, no supplier data shown.

### Step 6 — New Sale / Cart Flow (6 screens)

**CartPage**:
- Customer selector at top (search + select) — header shows `CustomerOutstandingBadge` once selected
- Credit warning banner if new sale would exceed credit limit
- Product list (empty state: "Add a product to start")
- Each cart item: `CartItemRow` with `QuantityCounter` (delete-on-1)
- Footer: subtotal, "Review Sale" button (disabled if no items or no customer)

**ProductPickerPage**:
- Search bar + category filter chips (All / Spray / Seed)
- Product cards: name, company, stock status badge, category
- Out-of-stock and expired items shown but disabled/greyed
- Tap product → VariantSelectorPage (Spray) or directly adds to cart with KG input (Seed)

**VariantSelectorPage** (Spray only):
- List of pack sizes (1L, 500ml, 200ml) with current stock and price
- Disabled if out of stock
- Tap variant → back to cart with item added

**SaleReviewPage**:
- Full order summary: customer name, outstanding balance, all line items, total, confirm button
- Back to cart allowed

**PaymentEntryPage**:
- Three options: Full / Partial / Credit
- Full: amount pre-filled, not editable
- Partial: amount input (must be > 0 and < total), outstanding calculated live
- Credit: Rs. 0 paid shown, full outstanding
- Credit limit warning if applicable
- "Complete Sale" button

**SaleConfirmPage**:
- Success icon (animated), sale summary
- "View Receipt" + "New Sale" buttons

### Step 7 — Sales History (3 screens)

**SalesListPage**:
- Three tabs: All / Credit / Paid
- Each tab has `SaleSummaryWidget` (count + total amount)
- Each row: date/time, customer name, amount, `PaymentTypeBadge`
- Voided sales in All tab with "Voided" badge, excluded from widget totals
- Date range filter
- Empty state per tab

**SaleDetailPage**:
- Customer name + link to customer detail
- Employee name
- All line items (product, variant, qty, unit price, line total)
- Payment info: total, paid, outstanding
- PaymentTypeBadge
- "View Receipt" button

**ReceiptPage**:
- Printable layout
- Shop name, date/time, employee, customer
- Line items, total, paid, outstanding
- No purchase cost visible

### Step 8 — Customers (3 screens)

**CustomersListPage**:
- Search by name/phone
- Each row: name, phone, outstanding balance badge (green/yellow/red)
- "Add Customer" FAB
- Empty state

**CustomerDetailPage** (matches CustomerProfile + PurchaseHistory + PaymentHistory imports):
- Profile card: phone + address in #F5F5F5 card
- 2×2 financial summary grid: Total Purchases, Total Paid, Outstanding, Credit Limit (white cards with #E5E5E5 border)
- Quick Actions: Purchase History / Payment History / Record Payment (each row with chevron → navigates)
- PurchaseHistoryPage: customer strip + filter pills (All/This Month/Last 3 Months) + sale rows with PAID/CREDIT badge
- PaymentHistoryPage: customer strip + payment rows (date, method, rec'd by, -amount, running balance)
- No cost/profit data visible

**AddCustomerPage**:
- Name (required), Phone (required + format validate), Address (optional)
- No credit limit field (Admin only)
- Submit → customer created → back to list

**RecordCustomerPaymentPage** (matches RecordCustomerPayment import — node 5:14298):
- Outstanding card: customer name + amount (Geist Bold 28px prominent)
- Amount to pay input (pill, numeric)
- Payment method toggle: Cash | Bank Transfer (pill toggle)
- Notes textarea (optional)
- "New Balance after payment" calculated live
- "Confirm Payment" fixed bottom button

**ReturnSelectItemsPage** (matches ReturnSelectItems import — node 5:14558):
- Sale info card at top (sale ID, customer, date)
- Items from that sale with return qty counter (delete-on-1 = red trash)
- Return Total card
- "Next" proceeds to return confirmation (separate screen — not yet imported, build from patterns)

### Step 9 — Products (2 screens)

**ProductsListPage**:
- Filter: All / Spray / Seed, search by name, filter by company
- Each row: product name, company, category chip, stock status badge, selling price
- Tap → ProductDetailPage

**ProductDetailPage** (matches ProductDetail import — node 5:14474):
- Header: product name + category chip inline, company avatar + name below
- Info banner (lock icon): "Catalog editing restricted. Contact store admin for changes."
- "PACK SIZES AND PRICING" section
- Variant rows: size name, price + units available, stock status outline chip (green/red border)
- No purchase cost, no editing controls for employee

---

## Edge Cases Covered in Every Screen

### Global
- Offline state: all data-fetch screens show offline banner + cached data where possible
- Loading state: every async action shows spinner/skeleton
- Unknown error: "Something went wrong. Try again." with retry

### Auth-specific
- OTP: wrong code (X attempts), expired (5 min), too many attempts (locked 10 min), resend limit (3), network failure
- PIN: mismatch on set, forgot PIN → OTP re-verify
- Deactivated account: post-OTP check, show dedicated screen
- Not registered: no employee signup option shown
- Session lock: inactivity timeout, PIN re-entry

### Cart-specific
- No customer selected: "Review Sale" disabled
- No items in cart: "Review Sale" disabled
- Item stock runs out between add and review: validation on "Complete Sale"
- Credit limit exceeded: warning banner, still allow proceed
- Quantity exceeds available stock: counter capped at available qty

### Sales History
- Empty tab: empty state with context-appropriate message
- Voided sale: badge shown, excluded from totals
- Partial payment sale: both paid + outstanding shown

### Customers
- Duplicate phone on Add Customer: inline error
- Customer with zero outstanding: green badge, "No outstanding balance"
- Customer at/over credit limit: red indicator in detail

### Products
- Out-of-stock item in picker: greyed, "Out of Stock" badge, cannot be added to cart
- Expired item: "Expired" badge, cannot be added to cart
- Product with no variants (edge): empty state message

---

## Routing Structure

```
/                       → redirect based on auth state
/login                  → LandingPage
/login/phone            → PhoneEntryPage
/login/otp              → OTPVerifyPage
/login/pin-set          → PINSetPage
/login/pin              → PINEntryPage
/login/shop-setup       → ShopSetupPage (Admin only)
/login/not-registered   → NotRegisteredPage
/login/deactivated      → DeactivatedPage

/employee               → EmployeeLayout (guard: role = employee/co_admin)
/employee/dashboard     → EmployeeDashboardPage
/employee/sale          → CartPage
/employee/sale/products → ProductPickerPage
/employee/sale/products/:id/variant → VariantSelectorPage
/employee/sale/review   → SaleReviewPage
/employee/sale/payment  → PaymentEntryPage
/employee/sale/confirm  → SaleConfirmPage
/employee/sale/receipt/:id → ReceiptPage
/employee/sales         → SalesListPage
/employee/sales/:id     → SaleDetailPage
/employee/sales/:id/receipt → ReceiptPage
/employee/customers     → CustomersListPage
/employee/customers/new → AddCustomerPage
/employee/customers/:id → CustomerDetailPage
/employee/customers/:id/purchases → CustomerPurchaseHistoryPage
/employee/customers/:id/payments → CustomerPaymentHistoryPage
/employee/customers/:id/record-payment → RecordCustomerPaymentPage
/employee/products      → ProductsListPage
/employee/products/:id  → ProductDetailPage
/employee/sales/:id/return → ReturnSelectItemsPage
/employee/sales/:id/return/confirm → ReturnConfirmPage
```

---

## Mock Data (seed-data.ts)

Realistic Agri shop data:
- **Companies:** Janja Agro, SeedCo, FarmTech
- **Products:** Janja Spray (1L/500ml/200ml variants), Maize Seed (per KG), Wheat Seed (per KG), FarmTech Spray (500ml/200ml)
- **Customers:** Ahmed Khan (outstanding Rs. 15,000), Fatima Malik (no outstanding), Raza Farms (outstanding Rs. 42,000, near credit limit)
- **Employees:** Current user (logged-in mock), Ali Hassan (second employee)
- **Sales:** 8 recent sales across paid/credit/partial states

---

## Verification

1. App loads → redirects to `/login` (not registered, not auth'd)
2. Landing → "Log in" → phone entry → OTP screen (mock OTP: `123456`) → PIN set → Employee dashboard
3. Dashboard shows today's metrics and recent sales
4. New Sale: select Raza Farms (near credit limit) → add Janja 1L → see credit warning → review → payment (partial) → confirm → receipt
5. Sales list: All/Paid/Credit tabs each show correct filtered data + summary widgets
6. Customer detail for Ahmed Khan shows Rs. 15,000 outstanding, purchase history
7. Product list: Janja Spray variants with stock badges
8. Session lock: wait 15s (mock timeout reduced for testing) → lock screen → PIN re-entry → resume
9. "Not you?" → logout → back to landing
10. Enter unregistered phone → NotRegisteredPage
11. Cart: add item qty 1, tap − → item removed (delete-on-1 behavior)
