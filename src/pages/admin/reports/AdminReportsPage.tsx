import { useMemo, useState } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { formatCurrency, getStockStatus } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { TrendingUp, Receipt, Wallet, AlertTriangle, Calendar } from "lucide-react";
import { pkToday } from "@/lib/pkDate";

type Period = "today" | "week" | "month" | "all" | "custom";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
  { key: "custom", label: "Custom" },
];

function startOf(period: Period, customFrom?: string, customTo?: string): { from: number; to: number } {
  const now = new Date();
  if (period === "today") {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    return { from: +d, to: +now };
  }
  if (period === "week") {
    const d = new Date(now); d.setDate(d.getDate() - 7);
    return { from: +d, to: +now };
  }
  if (period === "month") {
    const d = new Date(now); d.setMonth(d.getMonth() - 1);
    return { from: +d, to: +now };
  }
  if (period === "custom") {
    const from = customFrom ? new Date(customFrom + "T00:00:00").getTime() : 0;
    const to = customTo ? new Date(customTo + "T23:59:59").getTime() : +now;
    return { from, to };
  }
  return { from: 0, to: +now };
}

export default function AdminReportsPage() {
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const [period, setPeriod] = useState<Period>("month");
  const [showDateModal, setShowDateModal] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const mockSales = useSalesStore((s) => s.sales);
  const mockProducts = useProductsStore((s) => s.products);
  const mockCustomers = useCustomersStore((s) => s.customers);
  const mockCompanies = useCompaniesStore((s) => s.companies);

  const variantCost = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of mockProducts) for (const v of p.variants) map[v.id] = v.costPrice;
    return map;
  }, [mockProducts]);

  const now = new Date();
  const todayISO = pkToday();

  const report = useMemo(() => {
    const { from, to } = startOf(period, customFrom, customTo);
    const sales = mockSales.filter((s) => !s.isVoided && +new Date(s.createdAt) >= from && +new Date(s.createdAt) <= to);

    let revenue = 0, cogs = 0, collected = 0, credit = 0;
    const byEmployee: Record<string, { name: string; total: number }> = {};
    const byProduct: Record<string, { name: string; total: number; qty: number }> = {};

    for (const s of sales) {
      revenue += s.totalAmount;
      collected += s.amountPaid;
      credit += s.outstandingBalance;
      byEmployee[s.employeeId ?? 'unknown'] ??= { name: s.employeeName, total: 0 };
      byEmployee[s.employeeId ?? 'unknown'].total += s.totalAmount;
      for (const it of s.items) {
        cogs += (variantCost[it.variantId ?? ''] ?? 0) * it.qty;
        byProduct[it.productId ?? 'unknown'] ??= { name: it.productName, total: 0, qty: 0 };
        byProduct[it.productId ?? 'unknown'].total += it.lineTotal;
        byProduct[it.productId ?? 'unknown'].qty += it.qty;
      }
    }

    const grossProfit = revenue - cogs;
    const margin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const topEmployees = Object.values(byEmployee).sort((a, b) => b.total - a.total).slice(0, 4);
    const topProducts = Object.values(byProduct).sort((a, b) => b.total - a.total).slice(0, 5);

    const outstandingCredit = mockCustomers.reduce((t, c) => t + c.outstandingBalance, 0);
    const supplierPayable = mockCompanies.reduce((t, c) => t + c.outstandingPayable, 0);
    let lowStock = 0;
    for (const p of mockProducts) for (const v of p.variants) {
      if (getStockStatus(p.stockQty, v.lowStockThreshold) !== "in_stock") lowStock++;
    }

    return {
      revenue, cogs, grossProfit, margin, collected, credit,
      count: sales.length, topEmployees, topProducts,
      outstandingCredit, supplierPayable, lowStock,
    };
  }, [period, customFrom, customTo, mockSales, mockProducts, mockCustomers, mockCompanies, variantCost]);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title="Reports" />

      {/* Period filter — horizontal scroll */}
      <div
        className="flex gap-2 px-4 pt-3 pb-1 overflow-x-auto"
        style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}
      >
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => {
              setPeriod(p.key);
              if (p.key === "custom") setShowDateModal(true);
            }}
            className="shrink-0 h-8 px-4 rounded-full text-xs font-bold whitespace-nowrap transition-colors"
            style={{
              background: period === p.key ? "var(--brand)" : "var(--surface-2)",
              color: period === p.key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {p.key === "custom" && <Calendar size={12} className="inline me-1 -mt-0.5" />}
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date range summary */}
      {period === "custom" && (customFrom || customTo) && (
        <div className="px-4 pt-1 pb-1">
          <p className="text-xs font-semibold" style={{ color: "var(--brand-dark)" }}>
            {customFrom || "Start"} → {customTo || todayISO}
          </p>
        </div>
      )}

      {/* Gross profit hero */}
      <div className="px-4 pt-3">
        <div className="rounded-[16px] p-5" style={{ background: "var(--brand)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(0,0,0,0.55)" }}>
            Gross Profit
          </p>
          <p className="text-[34px] font-bold leading-tight" style={{ color: "#0a0a0a" }}>
            {formatCurrency(report.grossProfit)}
          </p>
          <div className="flex items-center gap-1.5 mt-1" style={{ color: "rgba(0,0,0,0.7)" }}>
            <TrendingUp size={13} />
            <span className="text-xs font-semibold">{report.margin.toFixed(1)}% margin · Revenue {formatCurrency(report.revenue)}</span>
          </div>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-3">
        <Stat icon={Receipt} label="Transactions" value={String(report.count)} />
        <Stat icon={Wallet} label="Cost of goods" value={formatCurrency(report.cogs)} />
        <Stat icon={Wallet} label="Cash collected" value={formatCurrency(report.collected)} tone="good" />
        <Stat icon={Wallet} label="On credit" value={formatCurrency(report.credit)} tone={report.credit > 0 ? "warn" : undefined} />
      </div>

      {/* Standing balances */}
      <div className="px-4 pt-5">
        <SectionTitle>Standing balances</SectionTitle>
        <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
          <BalanceRow label="Customer credit outstanding" value={formatCurrency(report.outstandingCredit)} tone={report.outstandingCredit > 0 ? "warn" : "good"} />
          <BalanceRow label="Supplier payable" value={formatCurrency(report.supplierPayable)} tone={report.supplierPayable > 0 ? "bad" : "good"} last />
        </div>
      </div>

      {/* Top employees */}
      {report.topEmployees.length > 0 && (
        <div className="px-4 pt-5">
          <SectionTitle>Sales by employee</SectionTitle>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
            {report.topEmployees.map((e, i, arr) => (
              <div key={`${e.name}-${i}`} className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--divider)" : "none", background: "var(--surface)" }}>
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>{e.name}</span>
                <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(e.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top products */}
      {report.topProducts.length > 0 && (
        <div className="px-4 pt-5 pb-2">
          <SectionTitle>Top products</SectionTitle>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
            {report.topProducts.map((p, i, arr) => (
              <div key={p.name} className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--divider)" : "none", background: "var(--surface)" }}>
                <div>
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                  <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{p.qty} units sold</p>
                </div>
                <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inventory alert */}
      {report.lowStock > 0 && (
        <div className="px-4 pt-3 pb-6">
          <div className="flex items-center gap-3 rounded-[14px] p-4" style={{ background: "rgba(245,158,11,0.12)" }}>
            <AlertTriangle size={18} style={{ color: "var(--warning)" }} />
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>
              <span className="font-bold">{report.lowStock}</span> variant{report.lowStock > 1 ? "s" : ""} low or out of stock — check Inventory.
            </p>
          </div>
        </div>
      )}

      {report.count === 0 && (
        <div className="flex flex-col items-center py-16 gap-2">
          <p className="text-3xl">📊</p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No sales in this period</p>
        </div>
      )}

      {/* Custom date modal */}
      {showDateModal && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setShowDateModal(false)}>
          <div className="w-full max-w-[390px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4"
            style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-bold text-center" style={{ color: "var(--text-primary)" }}>Select Date Range</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="text-xs font-bold uppercase mb-1" style={{ color: "var(--text-secondary)" }}>From</p>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full h-11 rounded-full px-4 text-sm outline-none" style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }} />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold uppercase mb-1" style={{ color: "var(--text-secondary)" }}>To</p>
                <input type="date" value={customTo} max={todayISO} onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full h-11 rounded-full px-4 text-sm outline-none" style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setCustomFrom(""); setCustomTo(""); }}
                className="flex-1 h-12 rounded-full text-sm font-bold" style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}>Clear</button>
              <button onClick={() => setShowDateModal(false)}
                className="flex-1 h-12 rounded-full text-sm font-bold" style={{ background: "var(--brand)", color: "#0a0a0a" }}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Receipt; label: string; value: string; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "var(--brand-dark)" : tone === "warn" ? "var(--warning)" : "var(--text-primary)";
  return (
    <div className="rounded-[14px] p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}>
      <Icon size={16} style={{ color: "var(--text-secondary)" }} />
      <p className="text-[10px] font-bold uppercase tracking-wider mt-2" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <p className="text-base font-bold mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-secondary)" }}>{children}</p>
  );
}

function BalanceRow({ label, value, tone, last }: { label: string; value: string; tone: "good" | "warn" | "bad"; last?: boolean }) {
  const color = tone === "good" ? "var(--brand-dark)" : tone === "bad" ? "var(--error)" : "var(--warning)";
  return (
    <div className="flex items-center justify-between px-4 py-3.5"
      style={{ borderBottom: last ? "none" : "1px solid var(--divider)", background: "var(--surface)" }}>
      <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="text-sm font-bold" style={{ color }}>{value}</span>
    </div>
  );
}
