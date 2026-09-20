/**
 * Live Signal Engine
 *
 * Computes all business signals from authoritative database state.
 * Every signal is LIVE — recalculated on each Action Center load/refresh.
 * No duplicate database records are created for repeated daily conditions.
 */

import type { Customer, Product, Company } from "@/types";
import { pkDate, pkDateFromISO } from "@/lib/pkDate";

// ─── Signal Types ─────────────────────────────────────────────────────────────

export type SignalSeverity = "critical" | "warning" | "info";
export type SignalCategory =
  | "overdue_credit"       // S1: outstanding > 0 AND past due date
  | "credit_limit"         // S5: outstanding >= credit_limit
  | "no_due_date"          // S6: outstanding > 0 AND no due date
  | "missing_info"         // S13: missing phone or address
  | "supplier_payable"     // S10: unpaid supplier payable
  | "out_of_stock"         // S7: stock = 0
  | "low_stock"            // S8: stock <= threshold
  | "expiry_approaching";  // S9: within 30 days of expiry

export type SignalAction = "review" | "approve_reject" | "view_entity";

export interface LiveSignal {
  id: string;               // unique key for this signal instance
  category: SignalCategory;
  severity: SignalSeverity;
  priority: number;          // 0-100, higher = more urgent. Derived from business impact.
  entity_type: "customer" | "product" | "company" | "variant";
  entity_id: string;
  entity_name: string;
  title: string;
  detailKey: string;         // i18n key — the UI resolves it with t(); never raw English
  detailParams?: Record<string, string>; // values substituted into the detail text
  reason?: string;           // why this requires attention now
  recommendedAction?: string; // what the admin should do
  signalAction?: SignalAction; // how the UI should handle the action
  value?: number;            // the business value causing the signal
  threshold?: number;        // the threshold compared against
  days?: number;             // days overdue, days until expiry, etc.
  created_at: string;        // ISO timestamp when signal was computed
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Days between two dates (positive = date2 is after date1). PK timezone aware. */
function daysBetweenPk(date1Str: string, date2Str: string): number {
  // Parse as PK-local dates by interpreting YYYY-MM-DD as PK midnight
  const d1 = new Date(date1Str + "T00:00:00+05:00");
  const d2 = new Date(date2Str + "T00:00:00+05:00");
  return Math.floor((d2.getTime() - d1.getTime()) / 86400000);
}

/** Get next harvest date for a crop (in Pakistan time). */
function getNextHarvestDate(harvestMonth: number, harvestDay: number, todayPk: string): string {
  const year = parseInt(todayPk.substring(0, 4));
  const month = harvestMonth;
  const day = harvestDay || 1;
  let harvestYear = year;
  let harvestDate = `${harvestYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (harvestDate <= todayPk) {
    harvestYear = year + 1;
    harvestDate = `${harvestYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return harvestDate;
}

// ─── Signal Computation Functions ─────────────────────────────────────────────

/** S1: Overdue Credit — outstanding > 0, due_date past */
function computeOverdueCreditSignals(
  customers: Customer[],
  todayPk: string,
): LiveSignal[] {
  return customers
    .filter(
      (c) =>
        !c.isArchived &&
        c.outstandingBalance > 0 &&
        c.dueDate !== null &&
        daysBetweenPk(pkDateFromISO(c.dueDate), todayPk) > 0,
    )
    .map((c) => {
      const overdueDays = daysBetweenPk(pkDateFromISO(c.dueDate!), todayPk);
      const amount = Math.round(c.outstandingBalance).toLocaleString("en-PK");
      // Priority: higher for larger amounts and more days overdue
      const priority = Math.min(100, Math.round(
        Math.min(60, c.outstandingBalance / 500) + // up to 60 pts from amount
        Math.min(40, overdueDays * 2)              // up to 40 pts from days
      ));
      return {
        id: `overdue-${c.id}`,
        category: "overdue_credit" as SignalCategory,
        severity: "critical" as SignalSeverity,
        priority,
        entity_type: "customer" as const,
        entity_id: c.id,
        entity_name: c.name,
        title: c.name,
        detailKey: "signal.detailOverdue",
        detailParams: { amount: String(amount), days: String(overdueDays) },
        reason: `Payment of Rs. ${amount} was due ${overdueDays} day${overdueDays > 1 ? "s" : ""} ago and has not been received.`,
        recommendedAction: "Review customer payment history and follow up.",
        signalAction: "review" as SignalAction,
        value: c.outstandingBalance,
        days: overdueDays,
        created_at: new Date().toISOString(),
      };
    });
}

/** S5: Credit Limit Reached — outstanding >= credit_limit */
function computeCreditLimitSignals(
  customers: Customer[],
  todayPk: string,
): LiveSignal[] {
  return customers
    .filter(
      (c) =>
        !c.isArchived &&
        c.creditLimit > 0 &&
        c.outstandingBalance >= c.creditLimit,
    )
    .map((c) => {
      const usagePct = Math.round(
        (c.outstandingBalance / c.creditLimit) * 100,
      );
      const outstanding = Math.round(c.outstandingBalance).toLocaleString("en-PK");
      const limit = Math.round(c.creditLimit).toLocaleString("en-PK");
      // Priority: higher for larger overage percentage
      const priority = Math.min(100, Math.round(usagePct * 0.4));
      return {
        id: `credit-limit-${c.id}`,
        category: "credit_limit" as SignalCategory,
        severity: "warning" as SignalSeverity,
        priority,
        entity_type: "customer" as const,
        entity_id: c.id,
        entity_name: c.name,
        title: c.name,
        detailKey: "signal.detailCreditLimit",
        detailParams: { outstanding: String(outstanding), limit: String(limit), pct: String(usagePct) },
        reason: `${c.name} has exceeded their Rs. ${limit} credit limit by Rs. ${outstanding}. Outstanding credit should be reviewed.`,
        recommendedAction: "Review credit exposure and consider requesting payment.",
        signalAction: "review" as SignalAction,
        value: c.outstandingBalance,
        threshold: c.creditLimit,
        created_at: new Date().toISOString(),
      };
    });
}

/** S6: No Due Date with Outstanding — permanent live signal until resolved */
function computeNoDueDateSignals(
  customers: Customer[],
  todayPk: string,
): LiveSignal[] {
  return customers
    .filter(
      (c) =>
        !c.isArchived &&
        c.outstandingBalance > 0 &&
        c.dueDate === null,
    )
    .map((c) => ({
      id: `no-due-date-${c.id}`,
      category: "no_due_date" as SignalCategory,
      severity: "info" as SignalSeverity,
      priority: 15,
      entity_type: "customer" as const,
      entity_id: c.id,
      entity_name: c.name,
      title: c.name,
      detailKey: "signal.detailNoDueDate",
      detailParams: { amount: Math.round(c.outstandingBalance).toLocaleString("en-PK") },
      reason: `${c.name} has an outstanding balance but no payment due date is configured.`,
      recommendedAction: "Set a due date to enable payment tracking.",
      signalAction: "review" as SignalAction,
      value: c.outstandingBalance,
      created_at: new Date().toISOString(),
    }));
}

/** S13: Missing Customer Information */
function computeMissingInfoSignals(
  customers: Customer[],
  todayPk: string,
): LiveSignal[] {
  const signals: LiveSignal[] = [];
  for (const c of customers) {
    if (c.isArchived) continue;
    const missing: string[] = [];
    if (!c.phone || c.phone.trim() === "") missing.push("phone");
    if (!c.address || c.address.trim() === "") missing.push("address");
    if (missing.length > 0) {
      signals.push({
        id: `missing-info-${c.id}`,
        category: "missing_info" as SignalCategory,
        severity: "info" as SignalSeverity,
        priority: 10,
        entity_type: "customer" as const,
        entity_id: c.id,
        entity_name: c.name,
        title: c.name,
        detailKey: "signal.detailMissing",
        detailParams: { fields: missing.join(" & ") },
        reason: `${c.name} is missing ${missing.join(" and ")} information.`,
        recommendedAction: "Update customer profile with complete information.",
        signalAction: "review" as SignalAction,
        created_at: new Date().toISOString(),
      });
    }
  }
  return signals;
}

/** S10: Supplier Payable — due/overdue based on due_date */
function computeSupplierPayableSignals(
  companies: Company[],
  todayPk: string,
): LiveSignal[] {
  const signals: LiveSignal[] = [];

  for (const c of companies) {
    if (c.outstandingPayable <= 0) continue;

    const dueDateStr = c.dueDate ?? null;

    if (dueDateStr !== null) {
      const dueDatePk = pkDateFromISO(dueDateStr);
      const diffDays = daysBetweenPk(todayPk, dueDatePk);

      if (diffDays < 0) {
        // Overdue: due_date is in the past
        const overdueDays = Math.abs(diffDays);
        const amt = Math.round(c.outstandingPayable).toLocaleString("en-PK");
        // Priority: more overdue days = higher priority
        const priority = Math.min(99, 50 + overdueDays);
        signals.push({
          id: `supplier-overdue-${c.id}`,
          category: "supplier_payable" as SignalCategory,
          severity: "critical" as SignalSeverity,
          priority,
          entity_type: "company" as const,
          entity_id: c.id,
          entity_name: c.name,
          title: c.name,
          detailKey: "signal.detailPayableOverdue",
          detailParams: { amount: String(amt), days: String(overdueDays) },
          reason: `Payment of Rs. ${amt} to ${c.name} was due ${overdueDays} day${overdueDays > 1 ? "s" : ""} ago.`,
          recommendedAction: "Record supplier payment.",
          signalAction: "review" as SignalAction,
          value: c.outstandingPayable,
          days: overdueDays,
          created_at: new Date().toISOString(),
        });
      } else if (diffDays === 0) {
        // Due today
        const amt = Math.round(c.outstandingPayable).toLocaleString("en-PK");
        signals.push({
          id: `supplier-due-${c.id}`,
          category: "supplier_payable" as SignalCategory,
          severity: "warning" as SignalSeverity,
          priority: 50,
          entity_type: "company" as const,
          entity_id: c.id,
          entity_name: c.name,
          title: c.name,
          detailKey: "signal.detailPayableToday",
          detailParams: { amount: String(amt) },
          reason: `Rs. ${amt} payment to ${c.name} is due today.`,
          recommendedAction: "Record supplier payment before due date.",
          signalAction: "review" as SignalAction,
          value: c.outstandingPayable,
          days: 0,
          created_at: new Date().toISOString(),
        });
      }
      // diffDays > 0: not yet due — no signal
    } else {
      // No due date set — INFO signal
      const amt = Math.round(c.outstandingPayable).toLocaleString("en-PK");
      signals.push({
        id: `supplier-no-due-${c.id}`,
        category: "supplier_payable" as SignalCategory,
        severity: "info" as SignalSeverity,
        priority: 15,
        entity_type: "company" as const,
        entity_id: c.id,
        entity_name: c.name,
        title: c.name,
        detailKey: "signal.detailPayableNoDue",
        detailParams: { amount: String(amt) },
        reason: `${c.name} has an outstanding payable but no due date is configured.`,
        recommendedAction: "Set a due date for this supplier.",
        signalAction: "review" as SignalAction,
        value: c.outstandingPayable,
        created_at: new Date().toISOString(),
      });
    }
  }

  return signals;
}

/** S7: Out of Stock */
function computeOutOfStockSignals(
  products: Product[],
  todayPk: string,
): LiveSignal[] {
  return products
    .filter((p) => p.stockQty <= 0.01)
    .map((p) => ({
      id: `out-of-stock-${p.id}`,
      category: "out_of_stock" as SignalCategory,
      severity: "critical" as SignalSeverity,
      priority: 70,
      entity_type: "product" as const,
      entity_id: p.id,
      entity_name: p.name,
      title: p.name,
      detailKey: "signal.detailOutOfStock",
      reason: `${p.name} has no stock available. Cannot fulfill customer orders.`,
      recommendedAction: "Review inventory and arrange replenishment.",
      signalAction: "review" as SignalAction,
      value: 0,
      threshold: 0,
      created_at: new Date().toISOString(),
    }));
}

/** S8: Low Stock — stock > 0 but <= threshold */
function computeLowStockSignals(
  products: Product[],
  todayPk: string,
): LiveSignal[] {
  return products
    .filter((p) => {
      if (p.stockQty <= 0.01) return false; // handled by out_of_stock
      const threshold = p.variants?.[0]?.lowStockThreshold ?? 5;
      return p.stockQty <= threshold;
    })
    .map((p) => {
      const threshold = p.variants?.[0]?.lowStockThreshold ?? 5;
      // Priority: lower ratio = higher priority within warning
      const ratio = threshold > 0 ? p.stockQty / threshold : 1;
      const priority = Math.round((1 - ratio) * 60) + 20; // 30-50 range
      return {
        id: `low-stock-${p.id}`,
        category: "low_stock" as SignalCategory,
        severity: "warning" as SignalSeverity,
        priority,
        entity_type: "product" as const,
        entity_id: p.id,
        entity_name: p.name,
        title: p.name,
        detailKey: "signal.detailLowStock",
        detailParams: { qty: String(p.stockQty), threshold: String(threshold) },
        reason: `${p.name} is running low on stock (${p.stockQty} of ${threshold} threshold).`,
        recommendedAction: "Consider restocking soon.",
        signalAction: "review" as SignalAction,
        value: p.stockQty,
        threshold,
        created_at: new Date().toISOString(),
      };
    });
}

/** S9: Product Expiry Approaching — within 30 days */
const EXPIRY_WARNING_DAYS = 30;

function computeExpirySignals(
  products: Product[],
  todayPk: string,
): LiveSignal[] {
  const signals: LiveSignal[] = [];

  for (const p of products) {
    if (!p.variants) continue;
    for (const v of p.variants) {
      if (!v.expiryDate) continue;
      const expiryPk = pkDateFromISO(v.expiryDate);
      const daysUntil = daysBetweenPk(todayPk, expiryPk);

      // Signal fires when within warning window (including past expiry)
      if (daysUntil <= EXPIRY_WARNING_DAYS) {
        const detailKey =
          daysUntil < 0
            ? "signal.detailExpired"
            : daysUntil === 0
              ? "signal.detailExpiresToday"
              : "signal.detailExpiresIn";
        const detailParams = { days: String(Math.abs(daysUntil)) };

        const productName = `${p.name} (${v.name})`;
        // Priority: fewer days = higher priority
        const priority = daysUntil <= 0 ? 80 : Math.round(80 - daysUntil * 2.5);
        signals.push({
          id: `expiry-${p.id}-${v.id}`,
          category: "expiry_approaching" as SignalCategory,
          severity: daysUntil <= 0 ? "critical" : "warning",
          priority,
          entity_type: "variant" as const,
          entity_id: v.id,
          entity_name: `${p.name} — ${v.name}`,
          title: productName,
          detailKey,
          detailParams,
          reason: daysUntil <= 0
            ? `${productName} expired ${Math.abs(daysUntil)} days ago and cannot be sold.`
            : `${productName} expires in ${daysUntil} days. Consider selling or removing from inventory.`,
          recommendedAction: daysUntil <= 0 ? "Remove expired product from inventory." : "Review expiry and plan sales accordingly.",
          signalAction: "review" as SignalAction,
          value: daysUntil,
          threshold: EXPIRY_WARNING_DAYS,
          days: daysUntil,
          created_at: new Date().toISOString(),
        });
      }
    }
  }
  return signals;
}

// ─── Credit Request Signals ────────────────────────────────

export interface CreditRequestInput {
  id: string;
  customerId: string;
  customerName: string;
  currentLimit: number;
  requestedLimit: number;
  reason?: string;
}

export function computeCreditRequestSignals(requests: CreditRequestInput[]): LiveSignal[] {
  return requests.map(r => {
    const current = Math.round(r.currentLimit).toLocaleString("en-PK");
    const requested = Math.round(r.requestedLimit).toLocaleString("en-PK");
    return {
      id: "credit-request-" + r.id,
      category: "credit_limit" as SignalCategory,
      severity: "critical" as SignalSeverity,
      priority: 85,
      entity_type: "customer" as const,
      entity_id: r.customerId,
      entity_name: r.customerName,
      title: r.customerName,
      detailKey: "signal.detailCreditRequest",
      detailParams: { from: current, to: requested },
      reason: r.customerName + " is requesting a credit limit increase from Rs. " + current + " to Rs. " + requested + (r.reason ? ". Reason: " + r.reason : "") + ".",
      recommendedAction: "Approve or reject the request.",
      signalAction: "approve_reject" as SignalAction,
      value: r.requestedLimit,
      threshold: r.currentLimit,
      created_at: new Date().toISOString(),
    };
  });
}
// ─── Main Export ──────────────────────────────────────────────────────────────

export interface SignalEngineInput {
  customers: Customer[];
  products: Product[];
  companies?: Company[];
  creditRequests?: CreditRequestInput[];
  now?: Date;
}

export function computeLiveSignals(input: SignalEngineInput): LiveSignal[] {
  const { customers, products, companies = [], creditRequests = [], now } = input;
  const todayPk = pkDate(now ?? new Date());

  const signals: LiveSignal[] = [
    ...computeCreditRequestSignals(creditRequests),
    ...computeOverdueCreditSignals(customers, todayPk),
    ...computeCreditLimitSignals(customers, todayPk),
    ...computeNoDueDateSignals(customers, todayPk),
    ...computeMissingInfoSignals(customers, todayPk),
    ...computeSupplierPayableSignals(companies, todayPk),
    ...computeOutOfStockSignals(products, todayPk),
    ...computeLowStockSignals(products, todayPk),
    ...computeExpirySignals(products, todayPk),
  ];



  // Sort within each severity by priority (highest first), then by category order
  const sevOrder = { overdue_credit: 0, supplier_overdue: 0, out_of_stock: 0, credit_limit: 1, low_stock: 1, expiry_approaching: 1, supplier_payable: 1, no_due_date: 2, missing_info: 2 };
  signals.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : a.severity === "warning" ? (b.severity === "info" ? -1 : 1) : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return (sevOrder[a.category] ?? 9) - (sevOrder[b.category] ?? 9);
  });
  return signals;
}

// ─── Category Summaries ──────────────────────────────────────────────────────

export interface CategorySummary {
  category: SignalCategory;
  severity: SignalSeverity;
  label: string;
  count: number;
  signals: LiveSignal[];
}

export function summarizeByCategory(signals: LiveSignal[]): CategorySummary[] {
  const map = new Map<SignalCategory, LiveSignal[]>();
  for (const s of signals) {
    if (!map.has(s.category)) map.set(s.category, []);
    map.get(s.category)!.push(s);
  }

  const sevOrder = { critical: 0, warning: 1, info: 2 };

  const CATEGORY_LABELS: Record<SignalCategory, string> = {
    overdue_credit: "Overdue Credit",
    credit_limit: "Credit Limit",
    no_due_date: "No Due Date",
    missing_info: "Missing Info",
    supplier_payable: "Supplier Payable",
    out_of_stock: "Out of Stock",
    low_stock: "Low Stock",
    expiry_approaching: "Expiry",
  };

  return Array.from(map.entries())
    .map(([cat, sigs]) => {
      // Sort signals within category by priority (highest first)
      sigs.sort((a, b) => b.priority - a.priority);
      // Category severity = max severity among its signals
      const maxSeverity = sigs.reduce(
        (worst, s) => (sevOrder[s.severity] < sevOrder[worst] ? s.severity : worst),
        sigs[0].severity,
      );
      return {
        category: cat,
        severity: maxSeverity,
        label: CATEGORY_LABELS[cat],
        count: sigs.length,
        signals: sigs,
      };
    })
    .sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
}
