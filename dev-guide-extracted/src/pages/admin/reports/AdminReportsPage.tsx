import { useMemo, useState } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { formatCurrency, getStockStatus } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { TrendingUp, Receipt, Wallet, AlertTriangle } from "lucide-react";

type Period = "today" | "week" | "month" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

function startOf(period: Period): number {
  const now = new Date();
  if (period === "today") { const d = new Date(now); d.setHours(0, 0, 0, 0); return +d; }
  if (period === "week") { const d = new Date(now); d.setDate(d.getDate() - 7); return +d; }
  if (period === "month") { const d = new Date(now); d.setMonth(d.getMonth() - 1); return +d; }
  return 0;
}

export default function AdminReportsPage() {
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const [period, setPeriod] = useState<Period>("month");
  const mockSales = useSalesStore((s) => s.sales);
  const mockProducts = useProductsStore((s) => s.products);
  const mockCustomers = useCustomersStore((s) => s.customers);
  const mockCompanies = useCompaniesStore((s) => s.companies);

  // Cost lookup: variantId -> current base cost (PRD §14 COGS input; admin-only).
  const variantCost = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of mockProducts) for (const v of p.variants) map[v.id] = v.costPrice;
    return map;
  }, [mockProducts]);

  const report = useMemo(() => {
    const from = startOf(period);
    const sales = mockSales.filter((s) => !s.isVoided && +new Date(s.createdAt) >= from);

    let revenue = 0, cogs = 0, collected = 0, credit = 0;
    const byEmployee: Record<string, { name: string; total: number }> = {};
    const byProduct: Record<string, { name: string; total: number; qty: number }> = {};

    for (const s of sales) {
      revenue += s.totalAmount;
      collected += s.amountPaid;
      credit += s.outstandingBalance;
      byEmployee[s.employeeId] ??= { name: s.employeeName, total: 0 };
      byEmployee[s.employeeId].total += s.totalAmount;
      for (const it of s.items) {
        cogs += (variantCost[it.variantId] ?? 0) * it.qty;
        byProduct[it.productId] ??= { name: it.productName, total: 0, qty: 0 };
        byProduct[it.productId].total += it.lineTotal;
        byProduct[it.productId].qty += it.qty;
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
      if (getStockStatus(v.stockQty, v.lowStockThreshold) !== "in_stock") lowStock++;
    }

    return {
      revenue, cogs, grossProfit, margin, collected, credit,
      count: sales.length, topEmployees, topProducts,
      outstandingCredit, supplierPayable, lowStock,
    };
  }, [period, mockSales, mockProducts, mockCustomers, mockCompanies, variantCost]);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title="Reports" backTo="/admin/more" />

      {/* Period filter */}
      <div className="flex gap-2 px-4 pt-3 overflow-x-auto">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className="shrink-0 h-8 px-4 rounded-full text-xs font-bold transition-colors"
            style={{
              background: period === p.key ? "var(--brand)" : "var(--surface-2)",
              color: period === p.key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Gross profit hero (admin-only, PRD §14) */}
      <div className="px-4 pt-4">
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
              <div key={e.name} className="flex items-center justify-between px-4 py-3"
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
