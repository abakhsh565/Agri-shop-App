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

export interface LiveSignal {
  id: string;               // unique key for this signal instance
  category: SignalCategory;
  severity: SignalSeverity;
  entity_type: "customer" | "product" | "company" | "variant";
  entity_id: string;
  entity_name: string;
  title: string;
  detail: string;
  value?: number;           // the business value causing the signal
  threshold?: number;       // the threshold compared against
  days?: number;            // days overdue, days until expiry, etc.
  created_at: string;       // ISO timestamp when signal was computed
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
      return {
        id: `overdue-${c.id}`,
        category: "overdue_credit" as SignalCategory,
        severity: "critical" as SignalSeverity,
        entity_type: "customer" as const,
        entity_id: c.id,
        entity_name: c.name,
        title: c.name,
        detail: `Rs. ${Math.round(c.outstandingBalance).toLocaleString("en-PK")} overdue ${overdueDays} days`,
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
      return {
        id: `credit-limit-${c.id}`,
        category: "credit_limit" as SignalCategory,
        severity: "warning" as SignalSeverity,
        entity_type: "customer" as const,
        entity_id: c.id,
        entity_name: c.name,
        title: c.name,
        detail: `Rs. ${Math.round(c.outstandingBalance).toLocaleString("en-PK")} of Rs. ${Math.round(c.creditLimit).toLocaleString("en-PK")} limit (${usagePct}%)`,
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
      entity_type: "customer" as const,
      entity_id: c.id,
      entity_name: c.name,
      title: c.name,
      detail: `Rs. ${Math.round(c.outstandingBalance).toLocaleString("en-PK")} outstanding — no due date set`,
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
        entity_type: "customer" as const,
        entity_id: c.id,
        entity_name: c.name,
        title: c.name,
        detail: `Missing ${missing.join(" & ")}`,
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
        signals.push({
          id: `supplier-overdue-${c.id}`,
          category: "supplier_payable" as SignalCategory,
          severity: "critical" as SignalSeverity,
          entity_type: "company" as const,
          entity_id: c.id,
          entity_name: c.name,
          title: c.name,
          detail: `Rs. ${Math.round(c.outstandingPayable).toLocaleString("en-PK")} payable overdue ${overdueDays} days`,
          value: c.outstandingPayable,
          days: overdueDays,
          created_at: new Date().toISOString(),
        });
      } else if (diffDays === 0) {
        // Due today
        signals.push({
          id: `supplier-due-${c.id}`,
          category: "supplier_payable" as SignalCategory,
          severity: "warning" as SignalSeverity,
          entity_type: "company" as const,
          entity_id: c.id,
          entity_name: c.name,
          title: c.name,
          detail: `Rs. ${Math.round(c.outstandingPayable).toLocaleString("en-PK")} payable due today`,
          value: c.outstandingPayable,
          days: 0,
          created_at: new Date().toISOString(),
        });
      }
      // diffDays > 0: not yet due — no signal
    } else {
      // No due date set — INFO signal
      signals.push({
        id: `supplier-no-due-${c.id}`,
        category: "supplier_payable" as SignalCategory,
        severity: "info" as SignalSeverity,
        entity_type: "company" as const,
        entity_id: c.id,
        entity_name: c.name,
        title: c.name,
        detail: `Rs. ${Math.round(c.outstandingPayable).toLocaleString("en-PK")} payable — no due date set`,
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
      entity_type: "product" as const,
      entity_id: p.id,
      entity_name: p.name,
      title: p.name,
      detail: `Out of stock`,
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
      return {
        id: `low-stock-${p.id}`,
        category: "low_stock" as SignalCategory,
        severity: "warning" as SignalSeverity,
        entity_type: "product" as const,
        entity_id: p.id,
        entity_name: p.name,
        title: p.name,
        detail: `${p.stockQty} remaining — threshold: ${threshold}`,
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
        const detail =
          daysUntil < 0
            ? `Expired ${Math.abs(daysUntil)} days ago`
            : daysUntil === 0
              ? "Expires today"
              : `Expires in ${daysUntil} days`;

        signals.push({
          id: `expiry-${p.id}-${v.id}`,
          category: "expiry_approaching" as SignalCategory,
          severity: daysUntil <= 0 ? "critical" : "warning",
          entity_type: "variant" as const,
          entity_id: v.id,
          entity_name: `${p.name} — ${v.name}`,
          title: `${p.name} (${v.name})`,
          detail,
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

// ─── Main Export ──────────────────────────────────────────────────────────────

export interface SignalEngineInput {
  customers: Customer[];
  products: Product[];
  companies?: Company[];
  now?: Date;
}

export function computeLiveSignals(input: SignalEngineInput): LiveSignal[] {
  const { customers, products, companies = [], now } = input;
  const todayPk = pkDate(now ?? new Date());

  const signals: LiveSignal[] = [
    ...computeOverdueCreditSignals(customers, todayPk),
    ...computeCreditLimitSignals(customers, todayPk),
    ...computeNoDueDateSignals(customers, todayPk),
    ...computeMissingInfoSignals(customers, todayPk),
    ...computeSupplierPayableSignals(companies, todayPk),
    ...computeOutOfStockSignals(products, todayPk),
    ...computeLowStockSignals(products, todayPk),
    ...computeExpirySignals(products, todayPk),
  ];

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
      // Sort signals within category by severity (most urgent first)
      sigs.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
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
