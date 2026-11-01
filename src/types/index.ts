// ─── Enums ───────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "employee";
/**
 * Mirrors the database's `product_category` enum exactly.
 *
 * It listed four of the seven values until the Add Product screen started offering the
 * whole list, which meant three categories the database accepts were unreachable from the
 * app and would not compile if they ever arrived from it. The recommendation engine already
 * knew all seven (`STAGE_CATEGORIES`), so the two now agree.
 */
export type ProductCategory =
  | "seed"
  | "fertilizer"
  | "pesticide"
  | "herbicide"
  | "spray"
  | "equipment"
  | "other";
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

  // The customer's photo, carried on the reminder so every reminder surface can show
  // it. Without it the follow-up list had nothing to render and fell back to initials
  // even for customers who had uploaded a photo.
  customerImage?: string;

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
/**
 * The business experience the server resolved for the active business.
 *
 * A Co-Owner is deliberately NOT a MembershipRole: the database keeps
 * memberships.role = 'employee' so the legacy users.role = 'admin' policies are
 * never opened. The delegated authority lives in co_owner_grants and is resolved
 * by get_my_access_context().
 */
export type Experience = 'owner' | 'co_owner' | 'employee';

export interface PendingCoOwnerInvitation {
  grantId: string;
  status: string;
  businessName: string;
  invitedAt: string;
  expiresAt: string | null;
  invitedBy: string | null;
  tenantId: string;
  canInviteEmployees: boolean;
  canDeactivateEmployees: boolean;
  canManageBranches: boolean;
  branches: Array<{ id: string; name: string }>;
  permissions: Array<{ code: string; module: string; labelEn: string; labelUr: string }>;
  dashboards: Array<{ key: string; labelEn: string; labelUr: string }>;
  authorities: Array<{ code: string; module: string; labelEn: string; labelUr: string; mode: string }>;
}

// ── RBAC Permissions ─────────────────────────────────────────────────────────
export interface Permission {
  id: string;
  code: string;       // e.g. 'customers.view'
  module: string;     // e.g. 'customers'
  action: string;     // e.g. 'view'
  labelEn: string;
  labelUr: string;
}

export type PermissionCode =
  | 'customers.view' | 'customers.create' | 'customers.edit' | 'customers.delete' | 'customers.payments'
  // Setting a customer's credit limit is its own switch (0251): the rest of the customer
  // surface does not imply lending authority, and an employee without it asks the owner.
  | 'customers.credit_limit'
  | 'products.view' | 'products.create' | 'products.edit' | 'products.delete'
  | 'sales.view' | 'sales.create' | 'sales.void'
  | 'returns.view' | 'returns.create'
  | 'purchases.view' | 'purchases.create'
  | 'payments.view' | 'payments.supplier'
  | 'inventory.view' | 'inventory.adjust'
  | 'companies.view' | 'companies.create' | 'companies.edit'
  | 'reports.view'
  | 'employees.view' | 'employees.manage'
  | 'settings.view' | 'settings.edit'
  | 'activity.view' | 'notifications.view'
  | 'alerts.view' | 'alerts.manage';

// ── RBAC Roles & Business Areas ──────────────────────────────────────────────
/**
 * The wireframe's "Data visibility" answer, stored on the role as a default.
 *
 * It is a template, not the enforcement: what a person may actually open is decided by
 * their own branch scope and per-branch role. The invite screen pre-selects from this.
 */
export type RoleDataScope = "business" | "branches" | "department" | "records";

/**
 * How the work is classified. This is deliberately separate from `departmentId`: a
 * department is the shop's own org unit, while the category is the system's stable
 * recommendation grouping. Neither one grants anything.
 */
export type RoleCategory =
  | "sales"
  | "finance"
  | "inventory"
  | "procurement"
  | "people_hr"
  | "operations"
  | "business_management"
  | "other";

export type RoleLevel =
  | "individual_contributor"
  | "supervisor"
  | "manager"
  | "department_head";

export interface Role {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  /**
   * The department this role belongs to (migration 0250). The code is one of the
   * business's own department codes; the names are read with the role so a list can
   * say "Sales" without one query per row.
   */
  departmentId?: string | null;
  departmentCode?: string | null;
  departmentName?: string | null;
  departmentNameUr?: string | null;
  /** Default data visibility for the people this role is assigned to. */
  dataScope?: RoleDataScope;
  /** System classification used only for recommendations and grouping. */
  roleCategory?: RoleCategory | null;
  /** Organisational level; only used for recommendations, never as authority. */
  responsibilityLevel?: RoleLevel | null;
  createdAt: string;
  updatedAt: string;
  // Computed from joins
  permissionCount?: number;
  memberCount?: number;
  permissions?: string[];  // permission codes
}

export interface BusinessArea {
  id: string;
  tenantId: string;
  code: string;       // e.g. 'sales'
  nameEn: string;
  nameUr: string;
  sortOrder: number;
  isActive: boolean;
}

/**
 * One part of the business a role can belong to (migration 0250).
 *
 * The five a business starts with — Sales, Finance, Inventory, Operations, Management —
 * are `isSystem`; an owner-added department is not. A role is filed under one, which is
 * what lets the app say "the sales people" without guessing from the role's name.
 */
export interface Department {
  id: string;
  tenantId: string;
  code: string;
  nameEn: string;
  nameUr: string;
  sortOrder: number;
  isSystem: boolean;
}

/**
 * One dashboard block the app can draw, and the permission that shows it by default.
 *
 * Visibility is a separate question from the permission to act, which is why this is a
 * catalogue of its own rather than a derived view over `permissions`.
 */
export interface DashboardWidget {
  key: string;
  module: string;
  labelEn: string;
  labelUr: string;
  sortOrder: number;
  /** The real permission that must also be held before this block is visible. */
  defaultPermission: string | null;
}

export interface User {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  isOriginalOwner: boolean;
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
  /** Server-resolved business experience (owner / co_owner / employee). */
  experience?: Experience;
  /** Active delegation id when experience is co_owner. */
  coOwnerGrantId?: string | null;
  /** A pending Co-Owner grant that still needs explicit acceptance. */
  pendingCoOwnerInvitation?: PendingCoOwnerInvitation | null;
  /** Active business name resolved with the access context. */
  businessName?: string | null;
  membershipStatus?: MembershipStatus;
  permissions?: string[];  // granted permission codes (owner gets all implicitly)
  /** Dashboard widget keys this account may be shown (migration 0250). */
  dashboards?: string[];
  branchScope?: string[] | null;
  /**
   * The membership's default role, by name. Read with the team so a directory can say what a
   * person does without one access RPC per row; null means the read did not resolve it.
   */
  roleName?: string | null;
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

/**
 * One of the shop's own shelves.
 *
 * The seven fixed kinds still exist (`legacyCategory`), because the recommendation engine
 * reasons about them; a shelf is the name the owner files a product under. `isSystem` is true
 * only while a seeded shelf still carries the name it was given, so the app can translate that
 * seven and print the owner's own words for everything else.
 */
export interface ShopCategory {
  id: string;
  parentId: string | null;
  name: string;
  legacyCategory: ProductCategory | null;
  isSystem: boolean;
  sortOrder: number;
}

/**
 * One of the shop's own units.
 *
 * `baseUnit` is the measurement family the arithmetic happens in — a "Bori" of pieces is still
 * a piece — and `precision` is how many decimals it is written with.
 */
export interface ShopUnit {
  id: string;
  name: string;
  symbol: string;
  baseUnit: BaseUnit;
  precision: number;
  isSystem: boolean;
}

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
  /** The shelf this product is filed on, when it has been filed since 0259. */
  categoryId?: string;
  /** The shop unit it is sold in, when one was chosen. */
  unitId?: string;
  imageUrl?: string;
  barcode?: string;
  /**
   * The measurement family, or the shop's own symbol for a unit that predates the catalogue.
   * Kept a plain string because a row stored before 0259 can carry any unit the shop used.
   */
  baseUnit: string;
  stockQty: number;
  variants: ProductVariant[];
  /**
   * The owner's "List on Farmer Marketplace" switch (0185). Absent on rows loaded before the
   * column existed, which reads as not listed — the same default the database applies.
   */
  marketplaceListed?: boolean;
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
  /**
   * Line cost of goods recorded at the time of sale (cost x qty).
   * Undefined only for rows recorded before COGS snapshots existed; those fall
   * back to the current variant cost. Never treat a missing cost as zero.
   */
  cogsAmount?: number;
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
  /** The branch the delivery was recorded for; absent on rows written before 0118. */
  branchId?: string;
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
