import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, Building2, CalendarDays, ChevronRight, Download, FileText, History, Package, Share2, TrendingUp, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import BalanceDateSheet, { type BalancePeriod } from "@/components/ui/BalanceDateSheet";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";
import { useUIStore } from "@/stores/uiStore";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { hasPermission } from "@/lib/tenantContext";
import { hubSection } from "@/lib/settingsHub";
import { useBranchPeriodReport } from "@/lib/branchReports";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";

/**
 * Reports, as the app's one section grammar has it: a list of destinations, not a keypad.
 *
 * SHAPE (owner's correction, 2026-10-29). The board first drew six tall tiles; every other
 * section — Inventory, Customers, Sales — states a job as one unboxed row with a glyph, a name
 * and the sentence that says what opening it answers. Six tiles made Reports the only screen
 * whose destinations could not be read, only guessed at, and gave the same six places a second
 * visual language. This is the row grammar from `AdminInventorySectionPage`: no card around the
 * list, no header repeating the bar, one row per report.
 *
 * THE OVERVIEW PREVIEWS THE ANSWERS (owner's follow-up, 2026-10-29). A list of sentences still
 * made the owner open four screens to learn four numbers they already ask for every morning. The
 * four money figures now sit in one overview card above the directory: the selected period's net
 * sales and profit, then the customers' outstanding balance and what is still owed to suppliers.
 * The figure is read from the same sources those reports read — `get_branch_period_report` for the
 * selected window, the customer and company stores for the standing balances — so the preview
 * cannot disagree with the screen it opens. The window defaults to all dates and is chosen from
 * the overflow menu; the directory itself remains a list of destinations. Rows with no single
 * money answer (Inventory, Activity) keep the sentence alone.
 *
 * THE DIRECTORY IS GROUPED BY THE DECISION. Sales and profit answer whether the period worked;
 * customers and suppliers answer where money is stuck; stock and activity answer what needs a
 * physical follow-up. This keeps a low-tech owner from having to decode a flat list of seven nouns.
 *
 * THE DESTINATIONS AND THE SENTENCES COME FROM `lib/settingsHub` — the same catalogue the
 * Settings menu reads. This page owns only which glyph each report wears and which permission
 * its destination asks for, so re-pointing a report or rewording what it answers is one line in
 * the catalogue.
 *
 * EVERY ROW OPENS A SCREEN THAT EXISTS:
 *
 *   Sales     → the sales section hub
 *   Detailed  → the long-form sales report at `/reports`
 *   Profit    → the profit report, on the app's one profit calculation
 *   Customers → the credit ledger: balances, limits, overdue
 *   Suppliers → the payable ledger: how much of what was bought is still owed
 *   Inventory → the stock hub: products, movements, low stock, expiry
 *   Activity  → the branch's audit trail
 *
 * A figure that could not be read is "—", never zero, and a figure still loading is "—" too:
 * a quiet month and an unanswered question must not look the same.
 *
 * A row the person cannot open is not drawn. The menu already hides sections the account has no
 * permission for, and a row that bounces to a guard would be the same dead end with an extra tap.
 * `hasPermission` is the same check the router's guards use.
 */
interface RowMeta {
  icon: LucideIcon;
  /** The destination's own permission, when it asks for more than settings.view. */
  permission?: string;
}

const ROW_META: Record<string, RowMeta> = {
  sales: { icon: BarChart3, permission: "sales.view" },
  detailed: { icon: FileText, permission: "reports.view" },
  profit: { icon: TrendingUp, permission: "reports.view" },
  customers: { icon: Users, permission: "customers.view" },
  suppliers: { icon: Building2, permission: "companies.view" },
  inventory: { icon: Package },
  activity: { icon: History, permission: "activity.view" },
};

/** The label each previewed figure wears, or nothing for a row with no money answer. */
const FIGURE_LABEL: Record<string, string> = {
  sales: "sales.netSales",
  profit: "reports.profit",
  customers: "reports.figureReceivables",
  suppliers: "reports.figurePayables",
};

/** The owner's questions, in the order they are usually asked. */
const REPORT_GROUPS: { id: string; labelKey: string; rowIds: string[] }[] = [
  { id: "performance", labelKey: "reports.groupPerformance", rowIds: ["sales", "detailed", "profit"] },
  { id: "balances", labelKey: "reports.groupBalances", rowIds: ["customers", "suppliers"] },
  { id: "operations", labelKey: "reports.groupOperations", rowIds: ["inventory", "activity"] },
];

export default function AdminReportsHubPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const backTo = useReturnTo(`${base}/more`);

  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);
  const loadCustomers = useCustomersStore((s) => s.load);
  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const loadCompanies = useCompaniesStore((s) => s.load);

  const canCustomers = hasPermission("customers.view");
  const canCompanies = hasPermission("companies.view");

  useEffect(() => {
    if (canCustomers && !customersReady) void loadCustomers();
    if (canCompanies && !companiesReady) void loadCompanies();
  }, [canCustomers, canCompanies, customersReady, companiesReady, loadCustomers, loadCompanies]);

  const [period, setPeriod] = useState<BalancePeriod>("all");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const todayISO = pkToday();
  const weekStart = useMemo(() => {
    const d = new Date(`${todayISO}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  }, [todayISO]);
  const periodWindow = useMemo(() => {
    switch (period) {
      case "today":
        return { from: todayISO, to: todayISO };
      case "week":
        return { from: weekStart, to: todayISO };
      case "month":
        return { from: `${todayISO.slice(0, 7)}-01`, to: todayISO };
      case "year":
        return { from: `${todayISO.slice(0, 4)}-01-01`, to: todayISO };
      case "custom":
        return { from: customFrom || todayISO, to: customTo || todayISO };
      default:
        return { from: "2000-01-01", to: todayISO };
    }
  }, [period, todayISO, weekStart, customFrom, customTo]);
  const { rows: branchRows } = useBranchPeriodReport(periodWindow.from, periodWindow.to);
  const periodLabel = useMemo(() => {
    if (period === "all") return t("period.allDates");
    if (period === "today") return t("period.today");
    if (period === "week") return t("period.week");
    if (period === "month") return t("period.month");
    if (period === "year") return t("period.year");
    const day = (iso: string) =>
      new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
    return `${day(periodWindow.from)} – ${day(periodWindow.to)}`;
  }, [period, periodWindow.from, periodWindow.to, t]);

  const sales = useMemo(() => {
    if (!branchRows || branchRows.some((row) => row.netSales == null)) return null;
    return branchRows.reduce((sum, row) => sum + (row.netSales ?? 0), 0);
  }, [branchRows]);

  const profit = useMemo(() => {
    if (!branchRows || branchRows.some((row) => row.profit == null)) return null;
    const total = branchRows.reduce((sum, row) => sum + (row.profit ?? 0), 0);
    // A floor is labelled as one: some sale lines in this window carry no recorded cost, so the
    // real figure is higher and the row must not present the known part as the whole.
    const floor = branchRows.some((row) => row.unknownLines > 0);
    return { total, floor };
  }, [branchRows]);

  const receivables = useMemo(
    () =>
      customersReady
        ? customers.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0)
        : null,
    [customers, customersReady],
  );

  const payables = useMemo(
    () =>
      companiesReady
        ? companies.reduce((sum, c) => sum + Math.max(0, c.outstandingPayable), 0)
        : null,
    [companies, companiesReady],
  );

  const figureFor = (id: string): { label: string; text: string } | null => {
    const labelKey = FIGURE_LABEL[id];
    if (!labelKey) return null;
    const label = t(labelKey);
    if (id === "sales") {
      return { label, text: sales == null ? "—" : formatCurrency(sales) };
    }
    if (id === "profit") {
      if (!profit) return { label, text: "—" };
      return {
        label,
        text: profit.floor
          ? `≥ ${formatCurrency(profit.total)}`
          : formatCurrency(profit.total),
      };
    }
    if (id === "customers") {
      return { label, text: receivables == null ? "—" : formatCurrency(receivables) };
    }
    return { label, text: payables == null ? "—" : formatCurrency(payables) };
  };

  const rows = hubSection("reports")?.rows ?? [];
  const visible = rows
    .map((row) => ({ ...row, ...(ROW_META[row.id] ?? { icon: BarChart3 }) }))
    .filter((row) => !row.permission || hasPermission(row.permission));
  const visibleIds = new Set(visible.map((row) => row.id));
  const summaryTop = (["sales", "profit"] as const).flatMap((id) => {
    const figure = visibleIds.has(id) ? figureFor(id) : null;
    return figure ? [{ id, ...figure }] : [];
  });
  const summaryBalances = (["customers", "suppliers"] as const).flatMap((id) => {
    const figure = visibleIds.has(id) ? figureFor(id) : null;
    return figure ? [{ id, ...figure }] : [];
  });
  const reportGroups = REPORT_GROUPS
    .map((group) => ({
      ...group,
      rows: visible.filter((row) => group.rowIds.includes(row.id)),
    }))
    .filter((group) => group.rows.length > 0);
  const groupedIds = new Set(reportGroups.flatMap((group) => group.rows.map((row) => row.id)));
  const ungrouped = visible.filter((row) => !groupedIds.has(row.id));
  if (ungrouped.length > 0) {
    reportGroups.push({ id: "more", labelKey: "reports.groupMore", rowIds: [], rows: ungrouped });
  }

  const [menuOpen, setMenuOpen] = useState(false);
  const { addToast } = useUIStore();

  /** The figures this screen is showing — one row per report, with the label it wears on screen. */
  const figureRows = visible
    .map((row) => ({ row, figure: figureFor(row.id) }))
    .filter((entry): entry is { row: (typeof visible)[number]; figure: { label: string; text: string } } => entry.figure !== null)
    .map(({ row, figure }) => ({ report: t(row.labelKey), figure: figure.text, measure: figure.label }));

  async function exportFigures() {
    setMenuOpen(false);
    try {
      const csv = toCsv(
        [
          { label: t("reports.period"), value: () => periodLabel },
          { label: t("settings.menu.reports"), value: (r: { report: string }) => r.report },
          { label: t("sales.netSales"), value: (r: { figure: string }) => r.figure },
          { label: t("finance.performance"), value: (r: { measure: string }) => r.measure },
        ],
        figureRows,
      );
      const outcome = await exportCsv(csvFileName("reports"), csv, t("settings.menu.reports"));
      addToast(outcome === "shared" ? t("data.exportedShared") : t("data.exported"), "success");
    } catch {
      addToast(t("data.exportFailed"), "error");
    }
  }

  async function shareFigures() {
    setMenuOpen(false);
    const text = [
      `${t("reports.period")}: ${periodLabel}`,
      ...figureRows.map((r) => `${r.report}: ${r.figure} (${r.measure})`),
    ].join("\n");
    try {
      const outcome = await exportText(text, t("settings.menu.reports"));
      addToast(outcome === "shared" ? t("sales.reportShared") : t("sales.reportCopied"), "success");
    } catch {
      addToast(t("sales.shareFailed"), "error");
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="reports-hub-page"
    >
      <StatusBar />
      <NavHeader
        title={t("settings.menu.reports")}
        backTo={backTo}
        right={<SectionActionsButton onClick={() => setMenuOpen(true)} label={t("common.more")} testId="reports-actions" />}
      />

      <SectionActionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("settings.menu.reports")}
        actions={[
          { id: "period", icon: CalendarDays, title: t("period.sheetTitle"), description: t("reports.chooseDatesHint"), onClick: () => { setMenuOpen(false); setPeriodOpen(true); } },
          { id: "export", icon: Download, title: t("data.export"), description: t("data.exportHint"), onClick: () => { void exportFigures(); } },
          { id: "share", icon: Share2, title: t("sales.shareReport"), description: t("sales.shareReportHint"), onClick: () => { void shareFigures(); } },
        ]}
      />

      <BalanceDateSheet
        open={periodOpen}
        onClose={() => setPeriodOpen(false)}
        title={t("period.sheetTitle")}
        value={period}
        from={customFrom}
        to={customTo}
        max={todayISO}
        onChange={(key, from, to) => {
          setPeriod(key);
          setCustomFrom(from);
          setCustomTo(to);
        }}
        testIdPrefix="reports-period"
      />

      <div className="px-4 pt-3">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)" }}
          data-testid="reports-overview"
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-10" style={{ color: "var(--text-secondary)" }}>
              {t("reports.period")}
            </p>
            <p className="text-11 font-semibold" data-testid="reports-period-label">
              {periodLabel}
            </p>
          </div>

          {summaryTop.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {summaryTop.map((metric) => (
                <div key={metric.id} className={metric.id === "profit" ? "text-end" : ""}>
                  <p className="text-10 leading-snug" style={{ color: "var(--text-secondary)" }}>
                    {metric.label}
                  </p>
                  <p
                    className="text-22 font-bold mt-1 tabular-nums break-words"
                    data-testid={`reports-figure-${metric.id}`}
                  >
                    {metric.text}
                  </p>
                </div>
              ))}
            </div>
          )}

          {summaryBalances.length > 0 && (
            <div
              className={summaryTop.length > 0 ? "mt-4 pt-3 border-t" : ""}
              style={summaryTop.length > 0 ? { borderColor: "var(--hairline)" } : undefined}
            >
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                {t("reports.balancesNow")}
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-2">
                {summaryBalances.map((metric) => (
                  <div key={metric.id} className={metric.id === "suppliers" ? "text-end" : ""}>
                    <p className="text-10 leading-snug" style={{ color: "var(--text-secondary)" }}>
                      {metric.label}
                    </p>
                    <p
                      className="text-18 font-bold mt-1 tabular-nums break-words"
                      data-testid={`reports-figure-${metric.id}`}
                    >
                      {metric.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="pb-6">
        {reportGroups.map((group) => (
          <div key={group.id}>
            <p className="ds-section-label px-4 pt-5 pb-1">{t(group.labelKey)}</p>
            {group.rows.map((row) => (
              <ListRow
                key={row.id}
                testId={`reports-row-${row.id}`}
                icon={row.icon}
                onClick={() =>
                  navigate(`${base}${row.to}`, {
                    state: { from: `${base}/reports/directory` },
                  })
                }
                trailing={
                  <ChevronRight
                    size={14}
                    style={{ color: "var(--text-secondary)" }}
                    className="shrink-0"
                  />
                }
              >
                <p className="ds-row-label truncate">{t(row.labelKey)}</p>
                {row.hintKey && <p className="ds-row-desc">{t(row.hintKey)}</p>}
              </ListRow>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
