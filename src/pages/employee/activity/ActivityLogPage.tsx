import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useShellBase } from "@/lib/useShellBase";
import { useSalesStore } from "@/stores/salesStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useAuthStore } from "@/stores/authStore";
import { fetchCustomerPayments } from "@/lib/db";
import type { Sale, Customer, CustomerPayment } from "@/types";
import { formatDateTime, formatCurrency } from "@/lib/formatters";
import {
  ShoppingCart, CreditCard, RotateCcw, UserPlus,
  TrendingUp, AlertTriangle, CheckCircle2,
} from "lucide-react";

type ActivityKind = "sale" | "payment" | "return" | "customer_added" | "all";

interface Activity {
  id: string;
  kind: Exclude<ActivityKind, "all">;
  title: string;
  subtitle: string;
  amount?: number;
  actor: string;
  at: string;
  linkPath?: string;
  status?: "success" | "warning" | "info";
}

// Build activity feed from mock data. `base` keeps links inside the current
// shell (admin or employee) so tapping an item never bounces across shells.
function buildFeed(
  base: string,
  mockSales: Sale[],
  mockCustomerPayments: CustomerPayment[],
  mockCustomers: Customer[],
): Activity[] {
  const feed: Activity[] = [];

  mockSales.forEach((s) => {
    feed.push({
      id: "sale-" + s.id,
      kind: "sale",
      title: `Sale to ${s.customerName}`,
      subtitle: `${s.saleNumber} · ${s.paymentType === "full" ? "Paid in full" : "Credit / partial"}`,
      amount: s.totalAmount,
      actor: s.employeeName,
      at: s.createdAt,
      linkPath: `${base}/sales/${s.id}`,
      status: s.paymentType === "full" ? "success" : "warning",
    });
  });

  mockCustomerPayments.forEach((p) => {
    const cust = mockCustomers.find((c) => c.id === p.customerId);
    feed.push({
      id: "pay-" + p.id,
      kind: "payment",
      title: `Payment from ${cust?.name ?? "Customer"}`,
      subtitle: `Via ${p.method === "cash" ? "Cash" : "Bank Transfer"}`,
      amount: p.amount,
      actor: p.recordedByName ?? '',
      at: p.createdAt,
      linkPath: `${base}/customers/${p.customerId}/payments`,
      status: "success",
    });
  });

  // Sort newest first
  return feed.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

const KIND_ICON = {
  sale: ShoppingCart,
  payment: CreditCard,
  return: RotateCcw,
  customer_added: UserPlus,
};

const KIND_COLOR: Record<string, { bg: string; icon: string }> = {
  sale:           { bg: "rgba(132,204,22,0.12)", icon: "#65a30d" },
  payment:        { bg: "rgba(59,130,246,0.12)", icon: "#2563eb" },
  return:         { bg: "rgba(245,158,11,0.12)", icon: "#d97706" },
  customer_added: { bg: "rgba(139,92,246,0.12)", icon: "#7c3aed" },
};

const FILTER_LABELS: { key: ActivityKind; label: string }[] = [
  { key: "all",            label: "All" },
  { key: "sale",           label: "Sales" },
  { key: "payment",        label: "Payments" },
  { key: "return",         label: "Returns" },
  { key: "customer_added", label: "Customers" },
];

export default function ActivityLogPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const [filter, setFilter] = useState<ActivityKind>("all");
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin" || user?.role === "co_admin";
  const allSales = useSalesStore((s) => s.sales);
  const sales = isAdmin ? allSales : allSales.filter((s) => s.employeeId === user?.id || s.employeeName === user?.name);
  const customers = useCustomersStore((s) => s.customers);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);

  useEffect(() => {
    fetchCustomerPayments().then((all) => {
      // Employee: only show payments they recorded
      if (!isAdmin && user?.id) {
        setPayments(all.filter((p) => p.recordedBy === user.id));
      } else {
        setPayments(all);
      }
    }).catch(() => setPayments([]));
  }, []);

  const allActivities = buildFeed(base, sales, payments, customers);
  const shown = filter === "all" ? allActivities : allActivities.filter((a) => a.kind === filter);

  const totalSalesAmount = allActivities
    .filter((a) => a.kind === "sale")
    .reduce((s, a) => s + (a.amount ?? 0), 0);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)" }}
    >
      <StatusBar />
      <NavHeader title="Activity Log" backTo={`${base}/dashboard`} />

      {/* Summary strip */}
      <div className="px-4 pt-2 animate-fade-in-up">
        <div
          className="rounded-xl p-4 flex items-center justify-between"
          style={{ background: "var(--surface-3)" }}
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
              Total Recorded Activity
            </p>
            <p className="text-xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>
              {allActivities.length} events
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
              Sales Volume
            </p>
            <p className="text-base font-bold mt-1" style={{ color: "var(--brand-dark)" }}>
              {formatCurrency(totalSalesAmount)}
            </p>
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 px-4 pt-4 pb-2 overflow-x-auto">
        {FILTER_LABELS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="shrink-0 h-8 px-3 rounded-full text-[12px] font-semibold transition-all"
            style={{
              background: filter === f.key ? "var(--brand)" : "var(--muted)",
              color: filter === f.key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div className="flex flex-col px-4 pb-4 gap-3">
        {shown.length === 0 && (
          <div className="flex flex-col items-center py-16 gap-3">
            <TrendingUp size={40} style={{ color: "var(--text-secondary)", opacity: 0.3 }} />
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No activity recorded yet</p>
          </div>
        )}
        {shown.map((activity, i) => {
          const Icon = KIND_ICON[activity.kind];
          const colors = KIND_COLOR[activity.kind];
          return (
            <button
              key={activity.id}
              onClick={() => activity.linkPath && navigate(activity.linkPath)}
              className="flex items-start gap-3 p-3 rounded-xl text-left transition-all active:scale-[0.98] animate-fade-in-up"
              style={{
                background: "var(--surface-2)",
                animationDelay: `${i * 40}ms`,
                cursor: activity.linkPath ? "pointer" : "default",
              }}
            >
              {/* Kind icon */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: colors.bg }}
              >
                <Icon size={18} style={{ color: colors.icon }} strokeWidth={2} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                  {activity.title}
                </p>
                <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                  {activity.subtitle}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    {activity.actor}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--divider)" }}>·</span>
                  <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    {formatDateTime(activity.at)}
                  </span>
                </div>
              </div>

              {/* Amount */}
              {activity.amount != null && (
                <div className="text-right shrink-0">
                  <p className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(activity.amount)}
                  </p>
                  {activity.status === "success" && (
                    <CheckCircle2 size={12} style={{ color: "var(--brand)", marginLeft: "auto", marginTop: 2 }} />
                  )}
                  {activity.status === "warning" && (
                    <AlertTriangle size={12} style={{ color: "var(--warning)", marginLeft: "auto", marginTop: 2 }} />
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
