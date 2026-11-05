import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownUp,
  Banknote,
  BellRing,
  Building2,
  ChevronRight,
  Download,
  HandCoins,
  Plus,
  Share2,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import Sheet from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { hubSection } from "@/lib/settingsHub";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import { hasPermission } from "@/lib/tenantContext";
import { useBranchCash, useBranchPeriodReport } from "@/lib/branchReports";
import { useFinanceTotals, monthWindow, netProfitOf, trendPercent } from "@/lib/financeEntries";
import { useMoneyTotals } from "@/lib/financeMoney";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";

/**
 * Finance, drawn as the owner's reference (2026-10-29): the period's net profit as the one
 * figure the screen opens with, the four balances beside it, the arithmetic that produced the
 * profit, then the jobs inside the section.
 *
 * WHERE EVERY NUMBER COMES FROM.
 *   - Net sales, cost of goods and profit are `get_branch_period_report` (0253), the same read
 *     the Sales and Profit reports use. They are per branch, and this screen is about the branch
 *     it names — never a sum of other branches presented as "the business".
 *   - Cash position is `get_branch_cash` (0253): money taken on this month's sales. It is not a
 *     till balance; the app records no opening balance, so a balance would be invented.
 *   - Operating expenses are the recorded expense rows (0254) for the same month.
 *   - Receivables and payables are the balances the database derives for this branch's customers
 *     and suppliers, read from the stores the rest of the app already uses.
 *   - Net profit subtracts the recorded expenses from the sales profit. That is this screen's
 *     own figure and the rule is printed under it (`finance.netProfitRule`), because the Sales
 *     report's profit has never included a rent bill and the two must not silently disagree.
 *
 * NULL IS NOT ZERO. A read that failed or a column this role may not see prints "—", never a
 * confident 0, exactly as the reports and cash screens do.
 */
export default function AdminFinanceSectionPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();


  const day = pkToday();
  const window = useMemo(() => monthWindow(day), [day]);

  const language = useThemeStore((s) => s.language);

  const reports = useBranchPeriodReport(window.from, window.to);
  const prevReports = useBranchPeriodReport(window.prevFrom, window.prevTo);
  const cashReports = useBranchCash(window.from, window.to);
  const prevCashReports = useBranchCash(window.prevFrom, window.prevTo);
  const totals = useFinanceTotals(window.from, window.to);
  const prevTotals = useFinanceTotals(window.prevFrom, window.prevTo);
  // Money that actually moved, which is not the profit figure above it. Both months are read
  // because the screen may need the previous one when the current month has no activity yet.
  const movement = useMoneyTotals(window.from, window.to);
  const prevMovement = useMoneyTotals(window.prevFrom, window.prevTo);

  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);
  const loadCustomers = useCustomersStore((s) => s.load);
  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const loadCompanies = useCompaniesStore((s) => s.load);

  const role = useAuthStore((s) => s.user?.membershipRole);
  const isOwner = role === "owner";
  const branchName = useShopStore((s) => s.activeBranchName);

  useEffect(() => {
    if (!customersReady) void loadCustomers();
    if (!companiesReady) void loadCompanies();
  }, [customersReady, loadCustomers, companiesReady, loadCompanies]);

  const canPayments = hasPermission("payments.view");
  const canCustomers = hasPermission("customers.view");
  const canCompanies = hasPermission("companies.view");

  const current = reports.rows?.find((row) => row.isCurrent) ?? null;
  const previous = prevReports.rows?.find((row) => row.isCurrent) ?? null;
  const branchCash = cashReports.rows?.find((row) => row.isCurrent) ?? null;
  const prevBranchCash = prevCashReports.rows?.find((row) => row.isCurrent) ?? null;

  const expenses = totals.totals?.expense ?? null;
  const previousExpenses = prevTotals.totals?.expense ?? null;

  const hasActivity = (
    report: typeof current,
    cash: typeof branchCash,
    expense: number | null,
    moved: typeof movement.totals,
  ) =>
    (report?.netSales ?? 0) > 0 ||
    (report?.returns ?? 0) > 0 ||
    (cash?.cashTaken ?? 0) > 0 ||
    (cash?.received ?? 0) > 0 ||
    (cash?.paid ?? 0) > 0 ||
    (expense ?? 0) > 0 ||
    (moved?.entries ?? 0) > 0;

  const currentHasActivity = hasActivity(current, branchCash, expenses, movement.totals);
  const previousHasActivity = hasActivity(previous, prevBranchCash, previousExpenses, prevMovement.totals);
  const reportingDataReady =
    reports.rows !== null &&
    prevReports.rows !== null &&
    cashReports.rows !== null &&
    prevCashReports.rows !== null &&
    totals.totals !== null &&
    prevTotals.totals !== null &&
    movement.totals !== null &&
    prevMovement.totals !== null;

  // On the first day of a month a business legitimately has no rows yet. Printing a confident
  // zero makes the whole page look disconnected from the October data one tap away. Show the
  // latest month that actually has activity, and name it in the header; when the current month
  // gets its first sale/expense/cash movement this naturally switches back to it.
  const showingPreviousMonth = reportingDataReady && !currentHasActivity && previousHasActivity;
  const selectedReport = showingPreviousMonth ? previous : current;
  const selectedCash = showingPreviousMonth ? prevBranchCash : branchCash;
  const selectedExpenses = showingPreviousMonth ? previousExpenses : expenses;
  const selectedMovement = showingPreviousMonth ? prevMovement.totals : movement.totals;

  const netSales = selectedReport?.netSales ?? null;
  const cogs = selectedReport?.cogs ?? null;
  const netProfit = netProfitOf(netSales, cogs, selectedExpenses);
  const previousProfit = netProfitOf(previous?.netSales ?? null, previous?.cogs ?? null, previousExpenses);
  const trend = showingPreviousMonth ? null : trendPercent(netProfit, previousProfit);

  const selectedFrom = showingPreviousMonth ? window.prevFrom : window.from;
  const reportingMonth = new Date(`${selectedFrom}T00:00:00Z`).toLocaleDateString(
    language === "ur" ? "ur-PK" : "en-PK",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  const receivables = useMemo(
    () => customers.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0),
    [customers],
  );
  const payables = useMemo(
    () => companies.reduce((sum, c) => sum + Math.max(0, c.outstandingPayable), 0),
    [companies],
  );

  /** A figure, or the honest mark for one that could not be read. */
  const money = (value: number | null | undefined) =>
    value == null ? "—" : formatCurrency(value);

  // A failed read is not "still reading". The hero waits for the two months it needs to choose
  // the reporting month; when one fails, the figure stays unknown rather than silently falling
  // back to a different period or drawing a zero that would flatter the month.
  const reportingReading =
    (reports.rows === null && !reports.failed) ||
    (prevReports.rows === null && !prevReports.failed) ||
    (cashReports.rows === null && !cashReports.failed) ||
    (prevCashReports.rows === null && !prevCashReports.failed) ||
    (totals.totals === null && !totals.failed) ||
    (prevTotals.totals === null && !prevTotals.failed) ||
    (movement.totals === null && !movement.failed) ||
    (prevMovement.totals === null && !prevMovement.failed);

  const metrics: { id: string; icon: LucideIcon; label: string; value: string; caption: string }[] = [
    {
      id: "cash",
      icon: Wallet,
      label: t("finance.metric.cash"),
      value: money(selectedCash?.cashTaken),
      caption: t("finance.metric.cashCaption"),
    },
    {
      id: "net-sales",
      icon: Receipt,
      label: t("finance.metric.netSales"),
      value: money(netSales),
      caption: t("finance.metric.netSalesCaption"),
    },
    {
      id: "receivables",
      icon: HandCoins,
      label: t("finance.metric.receivables"),
      value: customersReady ? formatCurrency(receivables) : "—",
      caption: t("finance.metric.receivablesCaption"),
    },
    {
      id: "payables",
      icon: Building2,
      label: t("finance.metric.payables"),
      value: companiesReady ? formatCurrency(payables) : "—",
      caption: t("finance.metric.payablesCaption"),
    },
  ];

  /**
   * The arithmetic the hero figure was made of. Each bar is measured against net sales, so the
   * four rows are the same whole divided differently — not four independent progress bars.
   */
  const performance: { id: string; labelKey: I18nKey; value: number | null; tone: "brand" | "muted" }[] = [
    { id: "net-sales", labelKey: "finance.metric.netSales", value: netSales, tone: "brand" },
    { id: "cogs", labelKey: "finance.cogs", value: cogs, tone: "muted" },
    { id: "expenses", labelKey: "finance.operatingExpenses", value: selectedExpenses, tone: "muted" },
    { id: "net-profit", labelKey: "finance.netProfit", value: netProfit, tone: "brand" },
  ];
  const barBase = netSales != null && netSales > 0 ? netSales : null;

  /**
   * The jobs inside the section, in the catalogue's order and with its destinations.
   *
   * There is one money row, not three. The statement, the recorded ledger and the payment list
   * are the same movements, so they share one screen; recording is that screen's own action and
   * appears in the header sheet for the owner only, because the database refuses the write from
   * anyone else.
   */
  const JOB_LOOK: Record<string, { icon: LucideIcon; hintKey?: I18nKey; allowed: boolean }> = {
    cash: { icon: Banknote, hintKey: "financeHub.cashRowHint", allowed: canPayments },
    receivables: { icon: HandCoins, hintKey: "financeHub.receivablesRowHint", allowed: canCustomers },
    payables: { icon: Building2, hintKey: "financeHub.payablesRowHint", allowed: canCompanies },
    reminders: { icon: BellRing, hintKey: "hub.finance.remindersHint", allowed: canPayments },
    // The one money destination (2026-10-31): the statement, the recorded-entry ledger and the
    // payment list are one list behind this row. Recording is the screen's own action, not a
    // second destination on this hub.
    money: { icon: ArrowDownUp, hintKey: "money.rowHint", allowed: canPayments },
  };
  const jobs = (hubSection("finance")?.rows ?? [])
    .filter((row) => JOB_LOOK[row.id]?.allowed)
    .map((row) => ({
      id: row.id,
      icon: JOB_LOOK[row.id].icon,
      hint: t((row.hintKey ?? JOB_LOOK[row.id].hintKey) as I18nKey),
      title: t(row.labelKey as I18nKey),
      to: `${base}${row.to}`,
    }));

  const [exportOpen, setExportOpen] = useState(false);
  const { addToast } = useUIStore();

  /** The figures on this screen, as rows — nothing is re-read, so an export matches the screen. */
  const figureRows = [
    { label: t("finance.netProfit"), value: money(netProfit), measure: t("finance.netProfitRule") },
    ...metrics.map((m) => ({ label: m.label, value: m.value, measure: m.caption })),
    ...performance.map((row) => ({ label: t(row.labelKey), value: money(row.value), measure: "" })),
  ];

  async function exportFigures() {
    setExportOpen(false);
    try {
      const csv = toCsv(
        [
          { label: t("finance.netProfit"), value: (r: (typeof figureRows)[number]) => r.label },
          { label: t("common.total"), value: (r: (typeof figureRows)[number]) => r.value },
        ],
        figureRows,
      );
      const outcome = await exportCsv(csvFileName("finance"), csv, t("settings.menu.finance"));
      addToast(outcome === "shared" ? t("data.exportedShared") : t("data.exported"), "success");
    } catch {
      addToast(t("data.exportFailed"), "error");
    }
  }

  async function shareFigures() {
    setExportOpen(false);
    const text = figureRows.map((r) => `${r.label}: ${r.value}`).join("\n");
    try {
      const outcome = await exportText(text, t("settings.menu.finance"));
      addToast(outcome === "shared" ? t("sales.reportShared") : t("sales.reportCopied"), "success");
    } catch {
      addToast(t("sales.shareFailed"), "error");
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="finance-hub-page"
    >
      <StatusBar />
      <NavHeader
        title={t("settings.menu.finance")}
        backTo={`${base}/settings`}
        right={
          <SectionActionsButton
            onClick={() => setExportOpen(true)}
            label={t("data.moreActions")}
            testId="finance-hub-actions"
          />
        }
      />

      <SectionActionsSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={t("settings.menu.finance")}
        actions={[
          // One write action, not four (owner, 2026-10-31). Quick add and the three named kinds
          // are the same form; the merged screen already offers them as tabs and a sentence.
          ...(isOwner
            ? [
                {
                  id: "record" as const,
                  icon: Plus,
                  title: t("money.recordAction"),
                  description: t("money.recordHint"),
                  onClick: () => navigate(`${base}/settings/hub/finance/record`),
                },
              ]
            : []),
          { id: "export", icon: Download, title: t("data.export"), description: t("data.exportHint"), onClick: () => { void exportFigures(); } },
          { id: "share", icon: Share2, title: t("sales.shareReport"), description: t("sales.shareReportHint"), onClick: () => { void shareFigures(); } },
        ]}
      />

      <div className="px-4 pt-3">
        <h1 className="text-22 font-bold">{t("financeHub.financialOverview")}</h1>
        <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
          {t("finance.overviewSubtitle")}
        </p>
        <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>
          {t("creditList.scope", { branch: branchName ?? t("hub.inventory.selectedBranch") })}
        </p>
        <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }} data-testid="finance-hub-period">
          {t("finance.periodLabel", { month: reportingMonth })}
        </p>
        {showingPreviousMonth && (
          <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }} data-testid="finance-hub-period-note">
            {t("finance.latestActiveMonth")}
          </p>
        )}
      </div>

      {/* The one figure the screen opens with. */}
      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="finance-hub-overview"
        >
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {t("finance.netProfit")}
          </p>
          {reportingReading ? (
            <Skeleton w="180px" h="32px" className="mt-1" />
          ) : (
            <p
              className="text-28 font-bold mt-1 tabular-nums break-words"
              style={{ color: netProfit != null && netProfit < 0 ? "var(--error)" : "var(--brand-dark)" }}
              data-testid="finance-hub-net-profit"
            >
              {money(netProfit)}
            </p>
          )}
          {trend !== null ? (
            <p
              className="text-11 mt-1 flex items-center gap-1"
              style={{ color: trend >= 0 ? "var(--success)" : "var(--error)" }}
              data-testid="finance-hub-trend"
            >
              {trend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              {t("finance.vsPrevious", { percent: String(Math.abs(trend)) })}
            </p>
          ) : (
            // "No previous period" is a fact about the ledger only when this period's figure is
            // known. An unread figure already prints "—" and needs no comparison sentence.
            !reportingReading && netProfit != null && !showingPreviousMonth && (
              <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>
                {t("finance.firstPeriod")}
              </p>
            )
          )}
          <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
            {t("finance.netProfitRule")}
          </p>
        </div>
      </div>

      {/* Money that moved, stated apart from profit. A reader who sees only "net profit" can
          mistake a month of credit sales for a month of cash; these three figures say what
          actually crossed the counter, and the line under them says it is not profit. */}
      <div className="px-4 pt-3">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
          data-testid="finance-hub-movement"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-13 font-bold">{t("finance.moneyMoved")}</p>
            <button
              type="button"
              onClick={() => {
                const to = showingPreviousMonth ? window.prevTo : window.to;
                navigate(`${base}/settings/hub/finance/money?from=${selectedFrom}&to=${to}`);
              }}
              className="text-11 font-semibold shrink-0 active:opacity-60"
              style={{ color: "var(--brand-dark)" }}
              data-testid="finance-hub-movement-link"
            >
              {t("finance.viewStatement")}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {[
              { id: "in", label: t("finance.moneyIn"), value: selectedMovement?.moneyIn, tone: "var(--brand-dark)" },
              { id: "out", label: t("finance.moneyOut"), value: selectedMovement?.moneyOut, tone: "var(--text-primary)" },
              { id: "net", label: t("money.net"), value: selectedMovement?.net, tone: "var(--brand-dark)" },
            ].map((figure) => (
              <div key={figure.id} className="min-w-0">
                <p className="text-10 truncate" style={{ color: "var(--text-secondary)" }}>
                  {figure.label}
                </p>
                <p
                  className="text-14 font-bold mt-0.5 tabular-nums break-words"
                  style={{
                    color: figure.id === "net" && (figure.value ?? 0) < 0 ? "var(--error)" : figure.tone,
                  }}
                  data-testid={`finance-hub-movement-${figure.id}`}
                >
                  {selectedMovement === null ? "—" : money(figure.value)}
                </p>
              </div>
            ))}
          </div>
          <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
            {t("finance.moneyMovedRule")}
          </p>
        </div>
      </div>

      {/* The four balances, two by two, as the reference lays them out. */}
      <div className="px-4 pt-3 grid grid-cols-2 gap-2">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.id}
              className="rounded-[var(--radius-card)] p-3 border min-w-0"
              style={{ background: "var(--surface)", borderColor: "var(--divider)" }}
              data-testid={`finance-hub-metric-${metric.id}`}
            >
              <Icon size={16} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
              <p className="text-12 mt-2 truncate" style={{ color: "var(--text-secondary)" }}>
                {metric.label}
              </p>
              {reportingReading && metric.id === "net-sales" ? (
                <Skeleton w="80%" h="20px" className="mt-1" />
              ) : (
                <p className="text-16 font-bold mt-0.5 tabular-nums break-words">{metric.value}</p>
              )}
              <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>
                {metric.caption}
              </p>
            </div>
          );
        })}
      </div>

      {/* The period's arithmetic, as bars measured against net sales. */}
      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
          data-testid="finance-hub-performance"
        >
          <p className="text-13 font-bold">{t("finance.performance")}</p>
          <div className="mt-3 flex flex-col gap-3">
            {performance.map((row) => {
              const width =
                barBase != null && row.value != null
                  ? Math.max(0, Math.min(100, (row.value / barBase) * 100))
                  : 0;
              return (
                <div key={row.id} data-testid={`finance-hub-perf-${row.id}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-12 min-w-0 truncate" style={{ color: "var(--text-secondary)" }}>
                      {t(row.labelKey)}
                    </span>
                    <span className="text-12 font-semibold tabular-nums shrink-0">
                      {money(row.value)}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1 rounded-full overflow-hidden"
                    style={{ background: "var(--muted)" }}
                    role="presentation"
                  >
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${width}%`,
                        background: row.tone === "brand" ? "var(--brand)" : "var(--text-tertiary)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-10 mt-3" style={{ color: "var(--text-tertiary)" }}>
            {selectedReport != null && selectedReport.unknownLines > 0
              ? t("finance.unknownCost")
              : t("finance.performanceNote")}
          </p>
        </div>
      </div>

      {/* The jobs inside the section — the same rows the Settings menu reads, so a job cannot be
          renamed on one screen and not the other. */}
      {/* Unboxed, like every other section hub (owner's correction, 2026-10-29). A card around a
          list of different destinations grouped nothing and made this one section's rows read as
          a different kind of control from Sales and Customers. `ListRow` still owns the height,
          insets and press state. */}
      <div className="pt-2 pb-8">
        {jobs.map((job) => {
          const Icon = job.icon;
          return (
            <ListRow
              key={job.id}
              testId={`hub-row-${job.id}`}
              icon={Icon}
              title={job.title}
              description={job.hint}
              trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
              onClick={() => navigate(job.to)}
            />
          );
        })}
      </div>
    </div>
  );
}
