import { useMemo, useState } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { formatCurrency, getStockStatus, productLowStockThreshold } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { TrendingUp, Receipt, Wallet, AlertTriangle, Calendar, BarChart3 } from "lucide-react";
import { pkToday } from "@/lib/pkDate";
import { useT } from "@/lib/i18n";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";

type Period = "today" | "week" | "month" | "all" | "custom";

const PERIODS: { key: Period; labelKey: string }[] = [
  { key: "today", labelKey: "sales.today" },
  { key: "week", labelKey: "sales.thisWeek" },
  { key: "month", labelKey: "sales.thisMonth" },
  { key: "all", labelKey: "sales.allTime" },
  { key: "custom", labelKey: "admin.customDateRange" },
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
  const t = useT();
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
  // Every figure below is derived from these four stores, so the report body
  // waits for all of them rather than settling from empty arrays.
  // Every read is its own hook call — combining them inside one expression would
  // short-circuit and change the hook order while data is loading.
  const salesReady = useSalesStore((s) => s.ready);
  const productsReady = useProductsStore((s) => s.ready);
  const customersReady = useCustomersStore((s) => s.ready);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const ready = salesReady && productsReady && customersReady && companiesReady;

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
        // Recorded line COGS (snapshot taken at sale time). The variant lookup is
        // only a fallback for lines written before COGS snapshots existed — it must
        // not be the primary source, because the products store holds ACTIVE
        // products only, so a deactivated product would silently cost zero.
        cogs += it.cogsAmount ?? (variantCost[it.variantId ?? ''] ?? 0) * it.qty;
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
    // Same inventory rule as the dashboard and alerts (see
    // productLowStockThreshold): the product is "low" only while it still has
    // sellable stock, and it is measured against its most demanding variant.
    let lowStock = 0;
    for (const p of mockProducts) {
      const threshold = productLowStockThreshold(p.variants);
      if (p.stockQty > 0 && getStockStatus(p.stockQty, threshold) !== "in_stock") lowStock++;
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
      <NavHeader title={t("admin.reports")} />

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
            {t(p.labelKey)}
          </button>
        ))}
      </div>

      {/* Custom date range summary */}
      {period === "custom" && (customFrom || customTo) && (
        <div className="px-4 pt-1 pb-1">
          <p className="text-xs font-semibold" style={{ color: "var(--brand-dark)" }}>
            {customFrom || t("admin.from")} → {customTo || todayISO}
          </p>
        </div>
      )}

      {!ready ? (
        <div className="px-4 pt-3">
          <SkeletonList rows={4} />
        </div>
      ) : (
        <>
      {/* Gross profit hero */}
      <div className="px-4 pt-3">
        <div className="rounded-[var(--radius-card)] p-5" style={{ background: "var(--brand)" }}>
          <p className="ds-section-label" style={{ color: "rgba(0,0,0,0.55)" }}>
            {t("admin.grossProfit")}
          </p>
          <p className="text-34 font-bold leading-tight" style={{ color: "#0a0a0a" }}>
            {formatCurrency(report.grossProfit)}
          </p>
          <div className="flex items-center gap-1.5 mt-1" style={{ color: "rgba(0,0,0,0.7)" }}>
            <TrendingUp size={13} />
            <span className="text-xs font-semibold">{t("reports.marginRevenue", { margin: report.margin.toFixed(1), revenue: formatCurrency(report.revenue) })}</span>
          </div>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-3">
        <Stat icon={Receipt} label={t("admin.transactions")} value={String(report.count)} />
        <Stat icon={Wallet} label={t("reports.costOfGoods")} value={formatCurrency(report.cogs)} />
        <Stat icon={Wallet} label={t("reports.cashCollected")} value={formatCurrency(report.collected)} tone="good" />
        <Stat icon={Wallet} label={t("reports.onCredit")} value={formatCurrency(report.credit)} tone={report.credit > 0 ? "warn" : undefined} />
      </div>

      {/* Standing balances */}
      <div className="px-4 pt-5">
        <SectionTitle>{t("reports.standingBalances")}</SectionTitle>
        <ListCard>
          <ListRow
            title={t("reports.customerCreditOutstanding")}
            trailing={<span className="ds-row-strong" style={{ color: report.outstandingCredit > 0 ? "var(--warning)" : "var(--brand-dark)" }}>{formatCurrency(report.outstandingCredit)}</span>}
          />
          <ListRow
            title={t("reports.supplierPayable")}
            trailing={<span className="ds-row-strong" style={{ color: report.supplierPayable > 0 ? "var(--error)" : "var(--brand-dark)" }}>{formatCurrency(report.supplierPayable)}</span>}
          />
        </ListCard>
      </div>

      {/* Top employees */}
      {report.topEmployees.length > 0 && (
        <div className="px-4 pt-5">
          <SectionTitle>{t("reports.salesByEmployee")}</SectionTitle>
          <ListCard>
            {report.topEmployees.map((e, i) => (
              <ListRow
                key={`${e.name}-${i}`}
                title={e.name}
                trailing={<span className="ds-row-strong">{formatCurrency(e.total)}</span>}
              />
            ))}
          </ListCard>
        </div>
      )}

      {/* Top products */}
      {report.topProducts.length > 0 && (
        <div className="px-4 pt-5 pb-2">
          <SectionTitle>{t("reports.topProducts")}</SectionTitle>
          <ListCard>
            {report.topProducts.map((p) => (
              <ListRow
                key={p.name}
                title={p.name}
                meta={`${p.qty} units sold`}
                trailing={<span className="ds-row-strong">{formatCurrency(p.total)}</span>}
              />
            ))}
          </ListCard>
        </div>
      )}

      {/* Inventory alert */}
      {report.lowStock > 0 && (
        <div className="px-4 pt-3 pb-6">
          <div className="flex items-center gap-3 rounded-[var(--radius-card)] p-4" style={{ background: "rgba(245,158,11,0.12)" }}>
            <AlertTriangle size={18} style={{ color: "var(--warning)" }} />
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>
              <span className="font-bold">{report.lowStock}</span> variant{report.lowStock > 1 ? "s" : ""} low or out of stock — check Inventory.
            </p>
          </div>
        </div>
      )}

      {report.count === 0 && (
        <div className="flex flex-col items-center py-16 gap-2">
          <BarChart3 size={28} className="mx-auto block" style={{ color: "var(--text-tertiary)" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("reports.noSalesInPeriod")}</p>
        </div>
      )}

        </>
      )}

      {/* Custom date modal */}
      {showDateModal && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setShowDateModal(false)}>
          <div className="w-full max-w-[390px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4"
            style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-bold text-center" style={{ color: "var(--text-primary)" }}>{t("admin.selectDateRange")}</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="ds-section-label mb-1" style={{ color: "var(--text-secondary)" }}>{t("admin.from")}</p>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full outline-none" />
              </div>
              <div className="flex-1">
                <p className="ds-section-label mb-1" style={{ color: "var(--text-secondary)" }}>{t("admin.to")}</p>
                <input type="date" value={customTo} max={todayISO} onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full outline-none" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setCustomFrom(""); setCustomTo(""); }}
                className="flex-1 h-12 rounded-full text-sm font-bold" style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}>{t("reports.clear")}</button>
              <button onClick={() => setShowDateModal(false)}
                className="flex-1 h-12 rounded-full text-sm font-bold" style={{ background: "var(--brand)", color: "#0a0a0a" }}>{t("reports.apply")}</button>
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
    <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--tone-card)" }}>
      <Icon size={16} style={{ color: "var(--text-secondary)" }} />
      <p className="ds-section-label mt-2" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <p className="text-base font-bold mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{children}</p>
  );
}

