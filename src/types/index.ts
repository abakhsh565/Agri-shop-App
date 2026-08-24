// ─── Enums ───────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "co_admin" | "employee";
export type ProductCategory = "spray" | "seed" | "fertilizer" | "other";
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";
export type PaymentType = "full" | "partial" | "credit";
export type PaymentMethod = "cash" | "bank_transfer";
export type CreditHealth = "good" | "warning" | "over_limit";
export type ReturnResolution = "refund_cash" | "credit_note";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  isOriginalOwner: boolean;
  pin: string;
  isActive: boolean;
  employeeNumber?: string;
  jobTitle?: string;
  photoUrl?: string;
  firstLoginAt: string | null;
  lastLoginAt: string | null;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface AuthSession {
  userId: string;
  deviceId: string;
  isLocked: boolean;
  lockTimeout: number;
}

// ─── Shop ─────────────────────────────────────────────────────────────────────

export interface Shop {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  createdAt: string;
  ownerId: string;
}

// ─── Products ─────────────────────────────────────────────────────────────────

export type BaseUnit = "kg" | "liter" | "piece";

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  sku?: string;
  sellingPrice: number;
  costPrice: number;
  unitSize: number;
  qtyStep: number;
  lowStockThreshold: number;
  expiryDate?: string;
}

export interface Product {
  id: string;
  name: string;
  company: string;
  category: ProductCategory;
  imageUrl?: string;
  barcode?: string;
  baseUnit: BaseUnit;
  stockQty: number;
  variants: ProductVariant[];
}

// ─── Customers ────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  imageUrl?: string;
  creditLimit: number;
  outstandingBalance: number;
  totalPurchases: number;
  totalPaid: number;
  createdAt: string;
  createdBy: string;
  isArchived?: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
}

/** Historical snapshot of customer at time of sale */
export interface CustomerSnapshot {
  name: string;
  phone: string;
  address?: string;
}

// ─── Sales ────────────────────────────────────────────────────────────────────

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  qty: number;
  unitPrice: number;
  unitSize: number;
  baseUnit: string;
  lineTotal: number;
}

export interface Sale {
  id: string;
  saleNumber: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  customerSnapshot?: CustomerSnapshot;
  employeeId: string;
  employeeName: string;
  items: SaleItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  outstandingBalance: number;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  isVoided: boolean;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  note?: string;
  createdAt: string;
}

// ─── Cart ─────────────────────────────────────────────────────────────────────

export interface CartItem {
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  qty: number;
  unitPrice: number;
  unitSize: number;
  baseUnit: string;
  lineTotal: number;
  maxQty: number;
  qtyStep: number;
}

// ─── Customer Payments ────────────────────────────────────────────────────────

export interface CustomerPayment {
  id: string;
  customerId: string;
  amount: number;
  method: PaymentMethod;
  notes?: string;
  recordedBy: string;
  recordedByName: string;
  balanceAfter: number;
  createdAt: string;
}

// ─── Returns ──────────────────────────────────────────────────────────────────

export interface ReturnItem {
  saleItemId: string;
  productName: string;
  variantName: string;
  qtyToReturn: number;
  unitPrice: number;
  refundAmount: number;
}

export interface Return {
  id: string;
  saleId: string;
  saleNumber: string;
  customerId: string;
  customerName: string;
  items: ReturnItem[];
  totalRefund: number;
  resolution: ReturnResolution;
  processedBy: string;
  note?: string;
  createdAt: string;
}

// ─── Companies / Suppliers ────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  logoUrl?: string;
  outstandingPayable: number;
  totalPurchases: number;
  createdAt: string;
}

// ─── Purchases ────────────────────────────────────────────────────────────────

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  qty: number;
  costPrice: number;
  lineTotal: number;
}

export interface Purchase {
  id: string;
  purchaseNumber: string;
  companyId: string;
  companyName: string;
  items: PurchaseItem[];
  totalAmount: number;
  amountPaid: number;
  outstandingPayable: number;
  paymentMethod: PaymentMethod;
  note?: string;
  createdAt: string;
  createdBy: string;
}

// ─── Stock Adjustment ─────────────────────────────────────────────────────────

export type AdjustmentType = "add" | "remove" | "set";

export interface StockAdjustment {
  id: string;
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  adjustmentType: AdjustmentType;
  qtyBefore: number;
  qtyChange: number;
  qtyAfter: number;
  reason?: string;
  adjustedBy: string;
  createdAt: string;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export type SearchResultType = "product" | "customer" | "sale" | "payment";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
}
