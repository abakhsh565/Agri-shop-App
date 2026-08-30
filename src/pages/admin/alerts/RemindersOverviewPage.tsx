import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency } from "@/lib/formatters";
import { Bell, Clock, AlertTriangle, ChevronRight } from "lucide-react";

interface ReminderLogEntry {
  id: string;
  customerId: string;
  type: "gentle" | "firmer" | "final";
  message: string;
  sentAt: string;
}

interface ReminderConfig {
  enabled: boolean;
  startDays: number;
  anchor: string;
  repeat: string;
  escalation: Array<{ label: string; tone: string; day: number }>;
}

const TYPE_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  gentle: { color: "#3b82f6", bg: "#eff6ff", label: "Gentle" },
  firmer: { color: "#f59e0b", bg: "#fffbeb", label: "Firmer" },
  final: { color: "#ef4444", bg: "#fef2f2", label: "Final" },
};

function getReminderConfig(customerId: string): ReminderConfig | null {
  try {
    const raw = localStorage.getItem("reminder_config_" + customerId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function getReminderLogs(customerId: string): ReminderLogEntry[] {
  try {
    const raw = localStorage.getItem("reminder_logs_" + customerId);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  return days + "d ago";
}

export default function RemindersOverviewPage() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customers = useCustomersStore((s) => s.customers);
  const sales = useSalesStore((s) => s.sales);

  // Build list of customers with active reminders
  const reminderCustomers = customers
    .filter((c) => !c.isArchived && c.outstandingBalance > 0)
    .map((c) => {
      const config = getReminderConfig(c.id);
      const logs = getReminderLogs(c.id);
      const lastLog = logs.length > 0 ? logs[0] : null;
      const customerSales = sales.filter((s) => s.customerId === c.id);
      return {
        customer: c,
        config,
        logs,
        lastLog,
        salesCount: customerSales.length,
      };
    })
    .sort((a, b) => {
      // Configured first, then by outstanding balance
      if (a.config && !b.config) return -1;
      if (!a.config && b.config) return 1;
      return b.customer.outstandingBalance - a.customer.outstandingBalance;
    });

  const configuredCount = reminderCustomers.filter((rc) => rc.config).length;
  const totalLogsSent = reminderCustomers.reduce((sum, rc) => sum + rc.logs.length, 0);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title="Reminders" />

      <div className="flex flex-col gap-3 px-4 pt-4 pb-8">
        {/* Summary */}
        <div className="flex gap-2.5">
          <div
            className="flex-1 rounded-[14px] p-3.5"
            style={{ background: "#FAEEDA" }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#854F0B" }}>CONFIGURED</p>
            <p className="text-[20px] font-bold mt-0.5" style={{ color: "#633806" }}>{configuredCount}</p>
          </div>
          <div
            className="flex-1 rounded-[14px] p-3.5"
            style={{ background: "#F1EFE8" }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#5F5E5A" }}>SENT TODAY</p>
            <p className="text-[20px] font-bold mt-0.5" style={{ color: "#444441" }}>{totalLogsSent}</p>
          </div>
          <div
            className="flex-1 rounded-[14px] p-3.5"
            style={{ background: "var(--surface-2)" }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>OUTSTANDING</p>
            <p className="text-[20px] font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>{reminderCustomers.length}</p>
          </div>
        </div>

        {/* Customer reminder list */}
        {reminderCustomers.length === 0 ? (
          <div
            className="rounded-[14px] p-8 flex flex-col items-center gap-3"
            style={{ border: "1px solid var(--divider)" }}
          >
            <div
              className="size-12 rounded-full flex items-center justify-center"
              style={{ background: "var(--surface-2)" }}
            >
              <Bell size={20} style={{ color: "var(--text-secondary)" }} />
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              No outstanding customers
            </p>
            <p className="text-xs text-center" style={{ color: "var(--text-secondary)" }}>
              All customers have settled their balances.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {reminderCustomers.map((rc) => (
              <button
                key={rc.customer.id}
                onClick={() => navigate("/admin/customers/" + rc.customer.id)}
                className="flex items-center gap-3 rounded-[14px] p-4 transition-opacity active:opacity-70 text-left w-full"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
              >
                <div
                  className="size-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: rc.config ? "#FAEEDA" : "var(--surface-2)", color: rc.config ? "#854F0B" : "var(--text-secondary)" }}
                >
                  {rc.customer.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {rc.customer.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {rc.config ? (
                      <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: "#FAEEDA", color: "#854F0B" }}>
                        {rc.config.repeat === "escalate" ? "Escalating" : rc.config.repeat === "interval" ? "Repeating" : "One-time"}
                      </span>
                    ) : (
                      <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Not configured</span>
                    )}
                    {rc.lastLog && (
                      <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        Last: {formatRelativeTime(rc.lastLog.sentAt)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
                    {formatCurrency(rc.customer.outstandingBalance)}
                  </span>
                  <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
