# Data Model — Agri Shop Management System

All TypeScript types and entity definitions. Source of truth for all data shapes used across the app.

---

## Enums

```ts
type UserRole = 'admin' | 'employee'

type ProductCategory = 'spray' | 'seed'

type StockStatus = 'in_stock' | 'limited_stock' | 'low_stock' | 'out_of_stock' | 'expired' | 'not_sellable'

type PaymentType = 'full' | 'partial' | 'credit'

type SaleStatus = 'completed' | 'voided'

type ReturnResolution = 'refund' | 'credit_adjustment'

type AdjustmentReason = 'damaged' | 'missing' | 'expired' | 'manual_correction' | 'other'

type TransactionType = 'sale' | 'payment' | 'return' | 'adjustment'
```

---

## Core Entities

### User (Employee / Admin)
```ts
interface User {
  id: string
  name: string
  phone: string
  role: UserRole
  pin: string                      // hashed 4-digit PIN for login
  isActive: boolean
  createdAt: string                // ISO date
  deactivatedAt: string | null
}
```

### Company (Supplier / Manufacturer)
```ts
interface Company {
  id: string
  name: string
  logoUrl: string | null
  phone: string | null
  address: string | null
  isActive: boolean
  createdAt: string
}
```

### Product
```ts
interface Product {
  id: string
  companyId: string                // FK → Company
  name: string
  category: ProductCategory
  description: string | null
  isActive: boolean
  createdAt: string
}
```

### ProductVariant
Spray products have explicit pack-size variants.
Seed products have a single implicit variant representing "per KG" with quantity tracked in grams or KG.

```ts
interface ProductVariant {
  id: string
  productId: string                // FK → Product
  label: string                    // e.g. "1 Liter", "500ml", "200ml", "per KG"
  packSize: number | null          // ml or grams — null for seed
  sellingPrice: number             // current selling price (Rs.)
  pricePerKg: number | null        // seed only — Rs. per KG
  isActive: boolean
  createdAt: string
}
```

### InventoryBatch
One record per stock-in event. Extensible for batch-level expiry tracking (future).

```ts
interface InventoryBatch {
  id: string
  variantId: string                // FK → ProductVariant
  purchaseId: string               // FK → Purchase
  quantityReceived: number
  quantityRemaining: number
  basePurchasePrice: number        // Rs. per unit — Admin-only
  sellingPriceAtEntry: number      // selling price at time of stock-in
  expiryDate: string | null        // ISO date
  stockStatus: StockStatus
  lowStockThreshold: number        // configurable, default from Settings
  expiryWarningDays: number        // configurable, default from Settings
  createdAt: string
}
```

### InventorySummary (derived / view)
Aggregated per variant for display purposes.

```ts
interface InventorySummary {
  variantId: string
  productId: string
  productName: string
  variantLabel: string
  companyId: string
  companyName: string
  category: ProductCategory
  totalQuantity: number
  stockStatus: StockStatus
  currentSellingPrice: number
  nearestExpiryDate: string | null
  isExpired: boolean
}
```

### Purchase (Stock-In)
```ts
interface Purchase {
  id: string
  companyId: string                // FK → Company
  variantId: string                // FK → ProductVariant
  quantityPurchased: number
  basePricePerUnit: number         // Admin-only
  sellingPriceSet: number          // selling price set at this purchase
  totalPurchaseCost: number        // quantityPurchased × basePricePerUnit
  amountPaid: number               // partial or full payment at time of purchase
  outstandingPayable: number       // totalPurchaseCost − amountPaid
  purchasedAt: string              // ISO datetime
  recordedBy: string               // FK → User (Admin)
  notes: string | null
}
```

### SupplierPayable (derived running balance)
```ts
interface SupplierPayable {
  companyId: string                // FK → Company
  totalPurchased: number           // cumulative total cost across all purchases
  totalPaid: number                // cumulative payments made
  outstandingPayable: number       // totalPurchased − totalPaid
  lastPaymentAt: string | null
}
```

### SupplierPayment
```ts
interface SupplierPayment {
  id: string
  companyId: string                // FK → Company
  amount: number
  note: string | null
  paidAt: string                   // ISO datetime
  recordedBy: string               // FK → User (Admin)
}
```

### Customer
```ts
interface Customer {
  id: string
  name: string
  phone: string
  address: string | null
  creditLimit: number              // Rs. — Admin configurable, default 0 = no limit
  totalPurchased: number           // cumulative sale totals
  totalPaid: number                // cumulative payments received
  outstandingBalance: number       // totalPurchased − totalPaid
  isActive: boolean
  createdAt: string
}
```

### Sale
```ts
interface Sale {
  id: string
  customerId: string               // FK → Customer
  employeeId: string               // FK → User
  items: SaleItem[]
  subtotal: number                 // sum of line totals
  totalAmount: number              // subtotal (no tax in MVP)
  amountPaid: number
  outstandingAmount: number        // totalAmount − amountPaid
  paymentType: PaymentType
  status: SaleStatus
  voidedAt: string | null
  voidedBy: string | null          // FK → User (Admin)
  voidReason: string | null
  completedAt: string              // ISO datetime
  createdBy: string                // FK → User
}
```

### SaleItem
```ts
interface SaleItem {
  id: string
  saleId: string                   // FK → Sale
  variantId: string                // FK → ProductVariant
  productName: string              // snapshot at time of sale
  variantLabel: string             // snapshot
  quantity: number
  unitPrice: number                // selling price snapshot at time of sale
  lineTotal: number                // quantity × unitPrice
}
```

### CustomerPayment
```ts
interface CustomerPayment {
  id: string
  customerId: string               // FK → Customer
  saleId: string | null            // optional link to specific sale
  amount: number
  note: string | null
  paidAt: string                   // ISO datetime
  recordedBy: string               // FK → User
}
```

### Return
```ts
interface Return {
  id: string
  originalSaleId: string           // FK → Sale
  customerId: string               // FK → Customer
  items: ReturnItem[]
  totalReturnValue: number
  resolution: ReturnResolution
  refundAmount: number | null      // if resolution = refund
  creditApplied: number | null     // if resolution = credit_adjustment
  processedAt: string              // ISO datetime
  processedBy: string              // FK → User
  notes: string | null
}
```

### ReturnItem
```ts
interface ReturnItem {
  id: string
  returnId: string                 // FK → Return
  saleItemId: string               // FK → SaleItem
  variantId: string                // FK → ProductVariant
  quantityReturned: number
  unitPrice: number                // original sale price snapshot
  lineTotal: number
}
```

### InventoryAdjustment
```ts
interface InventoryAdjustment {
  id: string
  variantId: string                // FK → ProductVariant
  batchId: string | null           // FK → InventoryBatch (optional)
  quantityChange: number           // negative = reduction, positive = addition
  reason: AdjustmentReason
  notes: string | null
  adjustedAt: string               // ISO datetime
  adjustedBy: string               // FK → User (Admin only)
}
```

### Settings
```ts
interface Settings {
  lowStockThreshold: number        // default: 10
  expiryWarningDays: number        // default: 30
  shopName: string
  currency: string                 // default: 'Rs.'
  defaultCreditLimit: number       // default: 0 (no limit)
}
```

---

## Derived / Computed Values

| Computed | Formula |
|---|---|
| `Sale.outstandingAmount` | `totalAmount − amountPaid` |
| `Sale.paymentType` | `amountPaid === 0` → credit, `amountPaid === totalAmount` → full, else partial |
| `Customer.outstandingBalance` | `SUM(sale.outstandingAmount)` across all non-voided sales |
| `SupplierPayable.outstandingPayable` | `SUM(purchase.totalPurchaseCost) − SUM(supplierPayment.amount)` |
| `GrossProfit` | `SUM(saleItem.lineTotal) − SUM(inventoryBatch.basePurchasePrice × qty_sold)` — Admin only |
| `InventoryBatch.stockStatus` | See stock status rules in BUSINESS-RULES.md |
| `SaleItem.lineTotal` | `quantity × unitPrice` |

---

## Entity Relationship Summary

```
Company ──< Product ──< ProductVariant ──< InventoryBatch
Company ──< Purchase ──> ProductVariant
Company ──< SupplierPayment

Customer ──< Sale ──< SaleItem ──> ProductVariant
Customer ──< CustomerPayment
Customer ──< Return ──< ReturnItem ──> SaleItem

User (Employee/Admin) ──< Sale
User (Admin) ──< Purchase
User (Admin) ──< InventoryAdjustment
User (Admin) ──< SupplierPayment
```
