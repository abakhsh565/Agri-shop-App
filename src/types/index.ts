// ─── Enums ───────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "co_admin" | "employee";
export type ProductCategory = "spray" | "seed" | "fertilizer" | "other";
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";
export type PaymentType = "full" | "partial" | "credit";
export type PaymentMethod = "cash" | "bank_transfer";
export type CreditHealth = "good" | "warning" | "over_limit";

export type PaymentStatus = "on_time" | "delayed" | "high_risk" | "no_due_date" | "paid";


export interface CreditHealthStatus {
  status: "green" | "yellow" | "red" | "not_enough_history" | "cash_customer";
  headline: string;
  explanation: string;
  signals: string[];
  recommendation: string;
}

export interface ReminderStatus {
  hasOutstanding: boolean;
  lastPaymentDaysAgo: number | null;
  reminderState: "none" | "due" | "overdue" | "urgent";
  reminderMessage: string;
  nextReminderDate: string | null;
}


export type ReminderRepeat = "once" | "interval" | "escalate";
export type ReminderEnds = "paid" | "date" | "count";
export type ReminderAnchor = "after_credit" | "after_due" | "before_due" | "before_harvest";

export interface EscalationStep {
  label: string;
  tone: string;
  day: number;
}

export interface ReminderConfig {
  id: string;
  enabled: boolean;
  startDays: number;
  anchor: ReminderAnchor;
  repeat: ReminderRepeat;
  intervalN: number;
  intervalUnit: "days" | "weeks";
  escalation: EscalationStep[];
  ends: ReminderEnds;
  endsDate: string | null;
  endsCount: number;
  groupId?: string | null;
  groupName?: string | null;
}

export interface ReminderGroup {
  id: string;
  name: string;
  createdAt: string;
  customerCount: number;
  customers: { id: string; name: string; outstandingBalance: number; dueDate: string | null }[];
  config?: {
    triggerType: string;
    startDays: number;
    repeatType: string;
    intervalN?: number;
    intervalUnit?: string;
    ends?: string;
  };
}
// ─── Business / Crop Settings ──────────────────────────────────────────────────

export interface CropConfig {

  name: string;

  harvestMonth: number; // 1-12

  harvestDay: number;   // 1-31, 0 = entire month

}



export interface BusinessSettings {

  crops: CropConfig[];

}



export interface GeneratedReminder {

  customerId: string;

  customerName: string;

  customerPhone: string;

  outstanding: number;

  dueDate: string | null;

  paymentStatus: PaymentStatus;

  configId: string;

  triggerDate: string;

  tone: 'gentle' | 'firmer' | 'final';

  trigger: 'credit' | 'harvest' | 'due_date';

  triggerDetail: string;

  cropName?: string;

  config: ReminderConfig;

  /** Persistent occurrence ID from reminder_occurrences table */
  _occurrenceId?: string;
  /** Deterministic occurrence key (config_id + occurrence_number + stage + crop) */
  _occurrenceKey?: string;
  /** Current status: scheduled | due | sent | completed | cancelled */
  _occurrenceStatus?: string;

}



export type ReturnResolution = "refund_cash" | "credit_note";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface Membership {
  id: string;
  tenantId: string;
  role: MembershipRole;
  status: MembershipStatus;
  branchScope: string[] | null;  // null = all branches
  createdAt: string;
}

export type MembershipRole = 'owner' | 'admin' | 'employee';
export type MembershipStatus = 'active' | 'suspended' | 'pending';

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
  // ── Membership context (loaded at login, persisted) ──
  tenantId?: string;   // current active tenant
  membershipId?: string;
  membershipRole?: MembershipRole;  // owner/admin/employee via membership
  membershipStatus?: MembershipStatus;
  branchScope?: string[] | null;
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
  stockQty: number;
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
  dueDate: string | null;
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
  reason?: string;
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
  dueDate?: string | null;
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
