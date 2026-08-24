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
