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

import type { CreditHealth } from "@/types";

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
