export function formatCurrency(amount: number): string {
  return `Rs. ${amount.toLocaleString("en-PK")}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) +
    " — " +
    d.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true })
  );
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true });
}

/**
 * Smart relative date + time:
 *  - Today at 1:00 AM
 *  - Yesterday at 12:00 PM
 *  - 12 Mar 2026 at 3:45 PM
 */
export function formatSmartDateTime(iso: string, now?: Date): string {
  const d = new Date(iso);
  const ref = now ?? new Date();
  const time = d.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true });
  const todayStr = ref.toISOString().split("T")[0];
  const dateStr = iso.split("T")[0];

  const yesterday = new Date(ref);
  yesterday.setDate(ref.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  if (dateStr === todayStr) return `Today at ${time}`;
  if (dateStr === yesterdayStr) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })} at ${time}`;
}

/**
 * Reactive time-ago: "just now", "5m ago", "3h ago", "2d ago"
 * Pass `now` to keep it fresh via useCurrentTime hook.
 */
export function timeAgo(iso: string, now?: Date): string {
  const ref = now ?? new Date();
  const diff = ref.getTime() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function formatPhone(phone: string): string {
  return phone.replace(/(\+92|0)(\d{3})(\d{7})/, "+92 $2 $3");
}

import type { CreditHealth, CreditHealthStatus, ReminderStatus, Customer } from "@/types";

export function getCreditHealth(outstanding: number, limit: number): CreditHealth {
  if (limit === 0) return "good";
  const ratio = outstanding / limit;
  if (ratio >= 1) return "over_limit";
  if (ratio >= 0.8) return "warning";
  return "good";
}

export function getCreditHealthLabel(health: CreditHealth): string {
  if (health === "good") return "Good";
  if (health === "warning") return "Warning";
  return "Over Limit";
}

export function getCreditHealthColor(health: CreditHealth): string {
  if (health === "good") return "#22c55e";
  if (health === "warning") return "#f59e0b";
  return "#ef4444";
}

export function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

import type { StockStatus } from "@/types";


export function calculateCreditHealth(
  customer: Pick<Customer, "totalPaid" | "totalPurchases" | "outstandingBalance">,
  salesCount: number,
  lastPaymentAt: string | null,
  effectivePaid: number,
  hasCreditActivity: boolean,
): CreditHealthStatus {
  const totalPurchases = customer.totalPurchases;
  const outstanding = customer.outstandingBalance;

  if (!hasCreditActivity) {
    return {
      status: "cash_customer",
      headline: "Cash customer",
      explanation: "This customer pays in full at the time of sale.",
      signals: [
        salesCount + " sale" + (salesCount !== 1 ? "s" : "") + " recorded",
        "All payments made at time of sale",
      ],
      recommendation: "No credit assessment needed - customer pays in full.",
    };
  }

  if (salesCount < 3 || totalPurchases === 0) {
    return {
      status: "not_enough_history",
      headline: "Not enough history",
      explanation: "There is not enough credit activity to assess behaviour reliably.",
      signals: [
        salesCount === 0 ? "No sales recorded" : salesCount + " sale" + (salesCount !== 1 ? "s" : "") + " recorded",
      ],
      recommendation: "Continue monitoring - not enough credit activity to assess yet.",
    };
  }

  const ratio = totalPurchases > 0 ? effectivePaid / totalPurchases : 0;
  const ratioPct = Math.min(100, Math.round(ratio * 100));

  const now = Date.now();
  const lastPaymentDaysAgo = lastPaymentAt
    ? Math.floor((now - new Date(lastPaymentAt).getTime()) / 86400000)
    : null;

  const hasRecentPayment = lastPaymentDaysAgo !== null && lastPaymentDaysAgo <= 30;
  const isStale = lastPaymentDaysAgo !== null && lastPaymentDaysAgo > 90;
  const hasOutstanding = outstanding > 0;

  let status: CreditHealthStatus["status"];
  let headline: string;
  let explanation: string;
  let recommendation: string;

  if (ratio >= 0.8) {
    if (hasOutstanding && isStale) {
      status = "yellow";
      headline = "Caution";
      explanation = "Historical repayment is strong, but no recent payment activity.";
      recommendation = "Monitor closely - outstanding balance with no recent payment.";
    } else {
      status = "green";
      headline = "Reliable";
      explanation = "Customer has consistently repaid previous credit.";
      recommendation = "Strong repayment history - trustworthy for credit consideration.";
    }
  } else if (ratio < 0.5) {
    status = "red";
    headline = "Risk";
    explanation = "A significant amount of previously extended credit remains unpaid.";
    recommendation = "Review repayment behaviour carefully before extending credit.";
  } else {
    if (lastPaymentDaysAgo === null || hasRecentPayment || !hasOutstanding) {
      status = "yellow";
      headline = "Caution";
      explanation = "Moderate repayment with recent payment activity.";
      recommendation = "Monitor repayment - history shows partial but active settlement.";
    } else {
      status = "red";
      headline = "Risk";
      explanation = "Moderate repayment with no recent payment activity.";
      recommendation = "Review repayment behaviour before extending additional credit.";
    }
  }

  const signals: string[] = [];
  signals.push("Repaid " + ratioPct + "% of total purchases");
  if (lastPaymentDaysAgo !== null) {
    signals.push(lastPaymentDaysAgo === 0 ? "Last payment: today" : "Last payment: " + lastPaymentDaysAgo + " day" + (lastPaymentDaysAgo !== 1 ? "s" : "") + " ago");
  } else {
    signals.push("No payment recorded");
  }
  signals.push(salesCount + " sale" + (salesCount !== 1 ? "s" : "") + " recorded");

  return { status, headline, explanation, signals, recommendation };
}

export function getCreditHealthStatusColor(status: CreditHealthStatus["status"]): string {
  if (status === "green") return "#22c55e";
  if (status === "yellow") return "#eab308";
  if (status === "red") return "#ef4444";
  if (status === "cash_customer") return "#3b82f6";
  return "#94a3b8";
}

export function calculateReminderStatus(
  customer: Pick<Customer, "outstandingBalance">,
  lastPaymentAt: string | null,
  creditLimit: number,
): ReminderStatus {
  const hasOutstanding = customer.outstandingBalance > 0;
  
  if (!hasOutstanding || creditLimit === 0) {
    return {
      hasOutstanding,
      lastPaymentDaysAgo: null,
      reminderState: "none",
      reminderMessage: "",
      nextReminderDate: null,
    };
  }

  const now = Date.now();
  const lastPaymentDaysAgo = lastPaymentAt
    ? Math.floor((now - new Date(lastPaymentAt).getTime()) / 86400000)
    : null;

  if (lastPaymentDaysAgo === null) {
    const nextDate = new Date(now + 7 * 86400000);
    return {
      hasOutstanding,
      lastPaymentDaysAgo: null,
      reminderState: "overdue",
      reminderMessage: "No payment recorded - follow up required",
      nextReminderDate: nextDate.toISOString().split("T")[0],
    };
  }

  let state: ReminderStatus["reminderState"];
  let message: string;
  let daysUntilNext: number;

  if (lastPaymentDaysAgo <= 15) {
    state = "none";
    message = "Recent payment activity - no reminder needed";
    daysUntilNext = 30 - lastPaymentDaysAgo;
  } else if (lastPaymentDaysAgo <= 30) {
    state = "none";
    message = "Payment within 30 days - routine monitoring";
    daysUntilNext = 45 - lastPaymentDaysAgo;
  } else if (lastPaymentDaysAgo <= 60) {
    state = "due";
    message = "Payment pending for " + lastPaymentDaysAgo + " days - reminder due";
    daysUntilNext = 0;
  } else if (lastPaymentDaysAgo <= 90) {
    state = "overdue";
    message = "Overdue by " + (lastPaymentDaysAgo - 30) + " days - follow up required";
    daysUntilNext = 0;
  } else {
    state = "urgent";
    message = "Seriously overdue (" + lastPaymentDaysAgo + " days) - immediate action required";
    daysUntilNext = 0;
  }

  const nextDate = new Date(now + daysUntilNext * 86400000);

  return {
    hasOutstanding,
    lastPaymentDaysAgo,
    reminderState: state,
    reminderMessage: message,
    nextReminderDate: daysUntilNext > 0 ? nextDate.toISOString().split("T")[0] : null,
  };
}

export function getStockStatus(qty: number, threshold: number): StockStatus {
  if (qty <= 0) return "out_of_stock";
  if (qty <= threshold) return "low_stock";
  return "in_stock";
}

export function getStockStatusLabel(status: StockStatus): string {
  if (status === "in_stock") return "In Stock";
  if (status === "low_stock") return "Low Stock";
  return "Out of Stock";
}

export function getStockStatusColor(status: StockStatus): string {
  if (status === "in_stock") return "#22c55e";
  if (status === "low_stock") return "#f59e0b";
  return "#ef4444";
}
