# Component Catalog — Agri Shop Management System

Every reusable component, its props contract, variants, and usage notes.
Build these primitives first. All pages compose from this catalog.

---

## Design Tokens (from MIRA brand system)

```
Accent:           #A0D30A  (lime green)
Dark BG:          #0B0C0E
Dark Card:        #16171B
Dark Border:      #23252C
Dark Text:        #F9FAFC
Dark Muted:       #A1A3A9
Light BG:         #F7F7F8
Light Card:       #FFFFFF
Light Border:     #E5E5E7
Light Text:       #1F2022
Light Muted:      #5F6066
Success:          #4CAF50 (dark) / #2E7D32 (light)
Error:            #EF5350 (dark) / #D32F2F (light)
Font:             Inter (weights: 400, 500, 600, 700, 800)
Font sizes:       10, 12, 13, 14, 16, 18, 20, 24, 36
Border radius:    8px (inputs/buttons), 12px (cards), 16px (panels), 100px (pills)
```

---

## 1. Base UI Primitives

### Button
```tsx
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'icon'
  size: 'sm' | 'md' | 'lg'
  label: string
  icon?: ReactNode         // optional leading icon
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
  fullWidth?: boolean
}
```
**Variants:**
- `primary` — bg #A0D30A, text #1F2022, hover #7BA808
- `secondary` — bg transparent, border #E5E5E7, text #1F2022 (light) / text #F9FAFC (dark)
- `ghost` — no border, text muted, hover bg subtle
- `destructive` — bg #FFEBEE (light) / #2D1919 (dark), text error color
- `icon` — square, icon only, no label

---

### Input
```tsx
interface InputProps {
  label?: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
  state: 'default' | 'focused' | 'error' | 'disabled'
  errorMessage?: string
  helpText?: string
  type?: 'text' | 'number' | 'tel' | 'password'
  prefix?: string          // e.g. "Rs."
  suffix?: string          // e.g. "kg"
  icon?: ReactNode
}
```

---

### Badge
```tsx
interface BadgeProps {
  label: string
  variant: 'default' | 'accent' | 'success' | 'error' | 'warning' | 'muted' | 'outline'
  size?: 'sm' | 'md'
  dot?: boolean            // small color dot prefix
}
```

---

### Card
```tsx
interface CardProps {
  children: ReactNode
  padding?: 'sm' | 'md' | 'lg'   // 16px / 24px / 32px
  interactive?: boolean            // hover lift effect
  theme?: 'light' | 'dark'
}
```

---

### Modal
```tsx
interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  footer?: ReactNode
}
```

---

### Toast
```tsx
interface ToastProps {
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
  duration?: number        // ms, default 3000
}
```

---

### Tabs
```tsx
interface TabsProps {
  tabs: { label: string; value: string; count?: number }[]
  active: string
  onChange: (value: string) => void
  summaryWidget?: ReactNode   // shown below active tab header
}
```
Used in: Sales List (All/Paid/Credit), Inventory filters, Reports.

---

### Table
```tsx
interface TableProps<T> {
  columns: { key: keyof T; label: string; width?: string; render?: (row: T) => ReactNode }[]
  rows: T[]
  onRowClick?: (row: T) => void
  emptyState?: ReactNode
  loading?: boolean
}
```

---

### SearchBar
```tsx
interface SearchBarProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  filters?: ReactNode      // filter chips or dropdowns alongside search
}
```

---

### EmptyState
```tsx
interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}
```
Used on every list view when results are empty.

---

### ConfirmDialog
```tsx
interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  onConfirm: () => void
  onCancel: () => void
}
```

---

## 2. Domain-Specific Shared Components

### StockStatusBadge
```tsx
interface StockStatusBadgeProps {
  status: StockStatus
}
```
Maps status → badge variant + label:
- `in_stock` → success, "In Stock"
- `limited_stock` → warning, "Limited"
- `low_stock` → warning, "Low Stock"
- `out_of_stock` → error, "Out of Stock"
- `expired` → error, "Expired"
- `not_sellable` → muted, "Not Sellable"

---

### PaymentTypeBadge
```tsx
interface PaymentTypeBadgeProps {
  type: PaymentType | SaleStatus
}
```
- `full` → success, "Paid"
- `partial` → warning, "Partial"
- `credit` → accent/outline, "Credit"
- `voided` → muted, "Voided"

---

### CustomerOutstandingBadge
```tsx
interface CustomerOutstandingBadgeProps {
  outstanding: number
  creditLimit: number      // 0 = no limit
  currency?: string        // default 'Rs.'
}
```
Shows amount with color: green if 0, yellow if < limit, red if at/over limit.
Used in: cart header, customer list, customer detail.

---

### SaleSummaryWidget
```tsx
interface SaleSummaryWidgetProps {
  count: number
  totalAmount: number
  label: string            // e.g. "Credit Sales", "Paid Sales"
  currency?: string
}
```
Used below each tab in the Sales List (All/Paid/Credit tabs enhancement).

---

### QuantityCounter
```tsx
interface QuantityCounterProps {
  quantity: number
  onIncrease: () => void
  onDecrease: () => void   // removes item when qty reaches 1 (calls onRemove)
  onRemove: () => void
  min?: number             // default 1; when qty hits min, next decrease = remove
  max?: number             // blocked by available stock
}
```
**Delete-on-1 behavior:** when `quantity === 1` and user taps −, item is removed from cart entirely (no zero-quantity line items).

---

### CreditWarningBanner
```tsx
interface CreditWarningBannerProps {
  customerName: string
  creditLimit: number
  currentOutstanding: number
  newOutstanding: number
  onDismiss?: () => void
}
```
Displays inline in cart or payment screen when sale would exceed credit limit.

---

### DateRangeFilter
```tsx
interface DateRangeFilterProps {
  value: DateRange         // { preset: string | 'custom'; from: Date; to: Date }
  onChange: (range: DateRange) => void
  presets?: string[]       // default: ['Today','Yesterday','This Week','This Month','Custom']
}
```

---

### ReceiptView
```tsx
interface ReceiptViewProps {
  sale: Sale
  customer: Customer
  employee: User
  shopName: string
  currency?: string
  onPrint?: () => void
}
```
Never shows base price or gross profit. Printable layout using `@media print`.

---

### MetricCard
```tsx
interface MetricCardProps {
  label: string
  value: string | number
  delta?: string           // e.g. "+12%" or "↑ Rs. 2,000"
  deltaPositive?: boolean
  icon?: ReactNode
  adminOnly?: boolean      // if true, renders nothing for Employee role
  onClick?: () => void     // drill-down navigation
}
```
Used extensively in Admin and Employee dashboards.

---

### ProductCard (for product picker in cart)
```tsx
interface ProductCardProps {
  product: Product
  company: Company
  variants: ProductVariant[]
  stockSummary: InventorySummary
  onSelect: (variantId: string) => void
}
```

---

### CartItemRow
```tsx
interface CartItemRowProps {
  item: CartItem           // { variantId, productName, variantLabel, qty, unitPrice }
  onQtyChange: (variantId, qty) => void
  onRemove: (variantId) => void
  currency?: string
}
```
Uses `QuantityCounter` internally.

---

## 3. Form Components

### ProductForm
Fields: Company (select), Category (Spray/Seed), Product Name, Description
- If Spray: Variants section (add/remove variants, each with label, pack size, selling price)
- If Seed: Price Per KG input
- Expiry date (optional)
- isActive toggle

### CustomerForm
Fields: Name, Phone, Address, Credit Limit (Admin only)

### CompanyForm
Fields: Company Name, Logo upload, Phone, Address

### PurchaseForm (Stock-In)
Fields: Company (select), Product (select, filtered by company), Variant (select), Quantity, Base Price (Admin — hidden label), Selling Price, Amount Paid, Notes

### PaymentForm
Fields: Amount, Note, Date (defaults today)

### AdjustmentForm
Fields: Reason (select), Quantity Change (+ or −), Notes, Confirm

---

## 4. Layout Components

### AdminLayout
- Left sidebar: 240px, fixed on desktop
- Sidebar nav: icon + label per section
- Active item: bg accent tint, text accent
- Top bar: page title, contextual actions (e.g. "+ New Sale")
- Responsive: sidebar collapses to icon-only at <1024px; drawer on mobile

### EmployeeLayout
- Bottom tab bar: 5 tabs (Dashboard, New Sale, Sales, Customers, Products)
- New Sale tab: larger accent button in center
- Top bar: shop name (left), user name + lock icon (right)
- Full-height main content area with scroll

### AuthLayout
- Centered card, shop logo/name at top
- PIN pad grid (1-9, 0) with backspace
- Role auto-detected from PIN

---

## 5. Component Composition Examples

### Sales List Page
```
<Tabs tabs={['All','Credit','Paid']}>
  <SaleSummaryWidget />        // below active tab
  <SearchBar + DateRangeFilter />
  <Table<Sale>
    columns={[date, customer, employee, items, total, status]}
    rows={filteredSales}
    onRowClick → SaleDetailPage
  />
  <EmptyState /> (if no results)
</Tabs>
```

### Cart Page
```
<CartHeader>
  <CustomerSelector />
  <CustomerOutstandingBadge outstanding={X} creditLimit={Y} />
</CartHeader>
<CartItemList>
  {items.map(item => <CartItemRow key={item.variantId} ... />)}
</CartItemList>
<AddProductButton → ProductPickerPage />
<CartFooter>
  <subtotal + total />
  <CreditWarningBanner /> (if applicable)
  <Button primary="Review Sale" />
</CartFooter>
```

### Admin Dashboard
```
<DateRangeFilter />
<MetricsGrid>
  <MetricCard label="Total Sales" />
  <MetricCard label="Paid" />
  <MetricCard label="Credit" />
  <MetricCard label="Gross Profit" adminOnly />
  <MetricCard label="Outstanding" />
  <MetricCard label="Supplier Payable" adminOnly />
</MetricsGrid>
<AlertsRow>
  <MetricCard label="Low Stock" onClick→InventoryReorder />
  <MetricCard label="Expiring Soon" onClick→ExpiryMonitor />
</AlertsRow>
<SalesByEmployeeTable />
<RecentSalesList />
```
