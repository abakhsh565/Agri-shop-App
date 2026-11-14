import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownUp,
  Banknote,
  BarChart3,
  BellRing,
  Building2,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Download,
  HandCoins,
  Package,
  Plus,
  Printer,
  Repeat,
  RotateCw,
  Share2,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import PeriodTabs from "@/components/ui/PeriodTabs";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import ListCard from "@/components/ui/ListCard";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { hubSection } from "@/lib/settingsHub";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useShopStore } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";
import { hasPermission } from "@/lib/tenantContext";
import { useBranchPeriodReport } from "@/lib/branchReports";
import {
  netProfitOf,
  postDueFinanceEntries,
  useFinanceRecurrences,
  useFinanceTotals,
} from "@/lib/financeEntries";
import { useMoneyTotals } from "@/lib/financeMoney";
import { formatCompactCurrency, formatCurrency } from "@/lib/formatters";
import { computeOverdueCreditTotal } from "@/lib/signalEngine";
import { pkMonthStart, pkMonthStartOf, pkToday, pkWeekStart } from "@/lib/pkDate";

/**
 * Financial overview — one screen, one appearance of each figure.
 *
 * IT REPLACES TWO SCREENS (owner, 2026-11-12): "Business overview" and the Finance hub drew the
 * same money from two different paths, so they could disagree about a number the owner had just
 * checked. Both are gone; this is the only financial overview, and `/settings/hub/overview`
 * forwards here.
 *
 * LAYOUT IS THE SALES REPORT'S, AND ONLY THE TOP OF IT (owner, 2026-11-12). The screen opens
 * exactly like `/settings/hub/sales`: headline, one scope line, the underline 1D–1Y tabs, then the
 * plate — two figures to a row, a hairline between rows, no surface behind them. The plate is the
 * only place figures live. There are NO cards, boxes or panels on this screen: the owner rejected
 * the boxed breakdown explicitly ("i dont want box desing"), so the composition is stated as plate
 * rows (sales, cost of goods, expenses) instead of a chart inside a box, and every list below is a
 * flat row with a hairline. The trend card that the sales screen carries under its plate is NOT
 * copied — that was the whole point of "sales design just for upper side".
 *
 * WHAT WAS REMOVED FROM THE FIRST MERGE, AND WHY (duplicated readings, not features):
 *   - the four figures repeated as a table AND as bars → they are plate rows once;
 *   - "cash taken" (a subset of money in) and "net movement" (money in − money out) → two
 *     figures, not four;
 *   - collected / remaining / percentage on both balance cards → each row opens the ledger that
 *     states those; here only what is owed matters;
 *   - low stock and expiring counts → they are alerts, and they are not money.
 *
 * WHERE EVERY NUMBER COMES FROM — one source per figure, so no two screens can disagree:
 *   - Gross sales, sales returns, net sales, cost of goods → `get_branch_period_report` (0253),
 *     the read the Sales and Profit reports use, for the SAME window the tabs show.
 *   - Operating expenses → the recorded expense rows (0254).
 *   - Net profit → `netProfitOf` (net sales − COGS − expenses); gross profit → gross − COGS.
 *   - Money in / out → `get_money_totals` (0262). Not profit, and never netted against it.
 *   - Customer receivables / supplier payables → the branch-scoped balances the two ledgers list.
 *   - Overdue credit → the S1 rule (`computeOverdueCreditTotal`).
 *   - Stock value → the branch figure `get_my_branches()` publishes.
 *
 * NULL IS NOT ZERO. A failed read or a column this role may not see prints "—"; an empty window
 * says so; a first period says there is nothing to compare against rather than inventing one.
 */

/** The report's five presets (the reference's 1D…1Y), plus the hand-picked window. */
type Preset = "day" | "week" | "month" | "quarter" | "year";
type Period = Preset | "custom";
/** Which way a figure has to move before the movement is good news. */
type GoodDirection = "up" | "down";

/** One cell of the plate: a figure, its name, and the movement under it. */
interface Cell {
  id: string;
  label: string;
  value: string;
  note: string;
  tone: string;
}

/** A PK day, moved by whole days. Dates are plain `YYYY-MM-DD`, so this stays a date. */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days between two PK days, inclusive of both ends. */
function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/** A PK day as a headline says it: "31 Oct". */
function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** A window as one line: a single day, a span inside a month, or two full dates. */
function rangeLabel(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const startMonth = start.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const endMonth = end.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  if (from === to) return `${start.getUTCDate()} ${startMonth} ${start.getUTCFullYear()}`;
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${start.getUTCDate()} – ${end.getUTCDate()} ${endMonth} ${end.getUTCFullYear()}`;
  }
  if (from.slice(0, 4) === to.slice(0, 4)) {
    return `${start.getUTCDate()} ${startMonth} – ${end.getUTCDate()} ${endMonth} ${end.getUTCFullYear()}`;
  }
  return `${start.getUTCDate()} ${startMonth} ${start.getUTCFullYear()} – ${end.getUTCDate()} ${endMonth} ${end.getUTCFullYear()}`;
}

/** Text for the print window: the labels are translated copy, but a quote in one would end the tag. */
function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A cadence's monthly cost: one number for "what these rules cost me a month". */
function monthlyRuleAmount(rule: { amount: number; repeatEvery: number; repeatUnit: string }): number {
  const every = Math.max(1, rule.repeatEvery);
  const perMonth =
    rule.repeatUnit === "month" ? 1 :
    rule.repeatUnit === "year" ? 1 / 12 :
    rule.repeatUnit === "week" ? 52 / 12 :
    365.25 / 12;
  return Math.round((rule.amount * perMonth) / every * 100) / 100;
}

/** A section heading that stands on the page — the Sales report's own label. */
function SectionHead({ title, first }: { title: string; first?: boolean }) {
  return (
    // 8px of air under the label: it sits above a card, and a label touching the card's top edge
    // reads as if it were inside it (owner, 2026-11-12).
    <p className={first ? "ds-section-label px-4 mt-6 mb-2" : "ds-section-label px-4 mt-5 mb-2"}>{title}</p>
  );
}

/**
 * One row of the plate — the Sales report's grid, verbatim: two figures to a row, 18px values,
 * 13px names, a hairline between rows and nothing drawn behind them.
 */
function PlateRow({ cells, divided }: { cells: Cell[]; divided: boolean }) {
  return (
    <div
      className="grid grid-cols-2 gap-x-4 py-4"
      style={divided ? { borderTop: "1px solid var(--hairline)" } : undefined}
    >
      {cells.map((cell) => (
        <div key={cell.id} className="min-w-0" data-testid={`finance-figure-${cell.id}`}>
          <p className="text-18 font-semibold leading-none tabular-nums break-words">{cell.value}</p>
          <p className="text-13 mt-2" style={{ color: "var(--text-secondary)" }}>{cell.label}</p>
          <p
            className="text-12 mt-1 font-semibold tabular-nums break-words"
            style={{ color: cell.tone }}
            data-testid={`finance-figure-note-${cell.id}`}
          >
            {cell.note}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * A row: glyph, name, one line of context, value, chevron. On the page it carries its own
 * hairline; inside a card it takes the card's gutter and the card draws the lines. One spec for
 * every row here, so a destination and a balance read at the same size.
 */
function FlatRow({
  icon: Icon,
  title,
  meta,
  description,
  value,
  onClick,
  testId,
  divided = true,
  inset = false,
}: {
  icon: LucideIcon;
  title: string;
  meta?: ReactNode;
  description?: string;
  value?: ReactNode;
  onClick: () => void;
  testId?: string;
  /** A rule above the row. Off inside a card, where ListCard owns the separators. */
  divided?: boolean;
  /** Its own 16px gutter, for a row that sits inside a card instead of on the page. */
  inset?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={"w-full flex items-center gap-3 py-3.5 text-start active:opacity-70" + (inset ? " px-4" : "")}
      style={divided ? { borderTop: "1px solid var(--hairline)" } : undefined}
    >
      <Icon size={18} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
      {/* ONE spec for every row on this screen, whatever the row's job: 15px semibold name,
          13px secondary line of context, 14px value. The list primitive's two roles (12px
          `meta`, 15px `description`) are for mixed lists; here every row is a peer, so a
          destination and a balance must read at the same size. */}
      <span className="min-w-0 flex-1">
        <span className="text-15 font-semibold block truncate">{title}</span>
        {meta && (
          <span className="text-13 block truncate" style={{ color: "var(--text-secondary)", marginTop: 4 }}>
            {meta}
          </span>
        )}
        {description && (
          <span className="text-13 block" style={{ color: "var(--text-secondary)", marginTop: 4 }}>
            {description}
          </span>
        )}
      </span>
      {value != null && (
        <span className="text-14 shrink-0 tabular-nums" style={{ color: "var(--text-secondary)" }}>{value}</span>
      )}
      <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
    </button>
  );
}

export default function AdminFinanceSectionPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const language = useThemeStore((s) => s.language);

  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const todayISO = pkToday();
  const rangeFrom =
    period === "custom"
      ? customFrom || pkMonthStart()
      : period === "day"
        ? todayISO
        : period === "week"
          ? pkWeekStart()
          : period === "quarter"
            ? pkMonthStartOf(todayISO, -2)
            : period === "year"
              ? `${todayISO.slice(0, 4)}-01-01`
              : pkMonthStart();
  const rangeTo = period === "custom" ? customTo || todayISO : todayISO;
  const windowDays = daysInclusive(rangeFrom, rangeTo);

  // The change is measured against the same number of days, ending the day before this window
  // starts — the rule the Sales report uses, so a month is never compared with a week.
  const prevTo = shiftDays(rangeFrom, -1);
  const prevFrom = shiftDays(prevTo, -(windowDays - 1));

  const reports = useBranchPeriodReport(rangeFrom, rangeTo);
  const prevReports = useBranchPeriodReport(prevFrom, prevTo);
  const totals = useFinanceTotals(rangeFrom, rangeTo);
  const prevTotals = useFinanceTotals(prevFrom, prevTo);
  const movement = useMoneyTotals(rangeFrom, rangeTo);
  const prevMovement = useMoneyTotals(prevFrom, prevTo);
  const recurring = useFinanceRecurrences(rangeFrom, rangeTo);

  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);
  const loadCustomers = useCustomersStore((s) => s.load);
  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const loadCompanies = useCompaniesStore((s) => s.load);

  const branches = useShopStore((s) => s.branches);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const activeBranchName = useShopStore((s) => s.activeBranchName);
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const openSwitcher = useShopStore((s) => s.openSwitcher);

  const role = useAuthStore((s) => s.user?.membershipRole);
  const isOwner = role === "owner";

  useEffect(() => {
    if (!customersReady) void loadCustomers();
    if (!companiesReady) void loadCompanies();
  }, [customersReady, loadCustomers, companiesReady, loadCompanies]);

  // Opening the book is what posts its due rows, because the app has no scheduler: the screen
  // must not say "next 5 Nov" while a 5 Nov expense is missing from the figures above it.
  const recurringPosted = useRef(false);
  useEffect(() => {
    if (!isOwner || recurringPosted.current) return;
    recurringPosted.current = true;
    void postDueFinanceEntries().then((count) => {
      if (count > 0) {
        recurring.retry();
        totals.retry();
        prevTotals.retry();
      }
    });
  }, [isOwner, recurring.retry, totals.retry, prevTotals.retry]);

  const canPayments = hasPermission("payments.view");

  const current = reports.rows?.find((row) => row.isCurrent) ?? null;
  const previous = prevReports.rows?.find((row) => row.isCurrent) ?? null;

  const netSales = current?.netSales ?? null;
  const cogs = current?.cogs ?? null;
  const expenses = totals.totals?.expense ?? null;
  const netProfit = netProfitOf(netSales, cogs, expenses);
  const previousProfit = netProfitOf(
    previous?.netSales ?? null,
    previous?.cogs ?? null,
    prevTotals.totals?.expense ?? null,
  );

  /** Gross profit is gross sales less cost of goods — before expenses, before returns' cost. */
  const grossProfitOf = (gross: number | null, cost: number | null) =>
    gross == null || cost == null ? null : Math.round((gross - cost) * 100) / 100;
  const grossProfit = grossProfitOf(current?.grossSales ?? null, cogs);
  const previousGrossProfit = grossProfitOf(previous?.grossSales ?? null, previous?.cogs ?? null);

  const moneyIn = movement.totals?.moneyIn ?? null;
  const moneyOut = movement.totals?.moneyOut ?? null;

  /** A figure in the short form the report's plate uses (Rs. 139.5K). */
  const money = (value: number | null | undefined) =>
    value == null ? "—" : formatCompactCurrency(value);

  /**
   * The line under a figure: what moved, by how much, and whether that direction is the good
   * one. A previous window of zero has no percentage to be a percentage OF, so the absolute move
   * is stated alone; two equal figures are labelled rather than coloured as a jump.
   */
  const delta = (
    value: number | null,
    before: number | null,
    good: GoodDirection,
  ): { note: string; tone: string } => {
    if (value == null) return { note: "—", tone: "var(--text-tertiary)" };
    if (before == null) return { note: t("finance.unknown"), tone: "var(--text-tertiary)" };
    const diff = value - before;
    if (diff === 0) return { note: t("finance.noChange"), tone: "var(--text-secondary)" };
    const favourable = good === "up" ? diff > 0 : diff < 0;
    const percent = before !== 0 ? ` (${Math.abs((diff / before) * 100).toFixed(0)}%)` : "";
    return {
      note: `${diff > 0 ? "+" : "−"}${formatCompactCurrency(Math.abs(diff))}${percent}`,
      tone: favourable ? "var(--brand-dark)" : "var(--error)",
    };
  };

  const netProfitNote = delta(netProfit, previousProfit, "up");
  const grossProfitNote = delta(grossProfit, previousGrossProfit, "up");
  const moneyInNote = delta(moneyIn, prevMovement.totals?.moneyIn ?? null, "up");
  const moneyOutNote = delta(moneyOut, prevMovement.totals?.moneyOut ?? null, "down");

  const reading =
    reports.rows === null ||
    prevReports.rows === null ||
    totals.totals === null ||
    prevTotals.totals === null ||
    movement.totals === null ||
    prevMovement.totals === null;

  const hasActivity =
    (netSales ?? 0) > 0 ||
    (cogs ?? 0) > 0 ||
    (expenses ?? 0) > 0 ||
    (moneyIn ?? 0) > 0 ||
    (moneyOut ?? 0) > 0;

  // ── The two standing balances: what is owed, not a receipt book ────────────────────────────
  const receivableDue = useMemo(
    () => customers.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0),
    [customers],
  );
  const payableDue = useMemo(
    () => companies.reduce((sum, c) => sum + Math.max(0, c.outstandingPayable), 0),
    [companies],
  );
  const overdueCredit = computeOverdueCreditTotal(customers);

  // ── The cost that falls due whether or not anything sells ─────────────────────────────────
  const activeRecurrences = recurring.rows ?? [];
  const recurringMonthly = activeRecurrences.reduce((sum, rule) => sum + monthlyRuleAmount(rule), 0);
  const nextRecurrence = activeRecurrences.reduce<string | null>(
    (next, rule) => (!next || rule.nextOn < next ? rule.nextOn : next),
    null,
  );
  const nextRecurrenceLabel = nextRecurrence
    ? new Date(`${nextRecurrence}T00:00:00Z`).toLocaleDateString(
        language === "ur" ? "ur-PK" : "en-GB",
        { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
      )
    : t("finance.recurring.noNext");

  /** The stock the money is sitting in — one figure; low stock and expiry belong to Alerts. */
  const inventoryValue = activeBranch?.inventoryValue ?? null;
  const inventoryIncomplete = activeBranch?.inventoryCostIncomplete === true;

  /**
   * The doors: each the screen that answers a detail question. Only the ones that are not
   * already a door on this page — the two balances above ARE the receivables and payables
   * ledgers, so they are not repeated here.
   */
  const JOB_LOOK: Record<string, { icon: LucideIcon; hintKey?: I18nKey; allowed: boolean }> = {
    cash: { icon: Banknote, hintKey: "financeHub.cashRowHint", allowed: canPayments },
    money: { icon: ArrowDownUp, hintKey: "money.rowHint", allowed: canPayments },
    reminders: { icon: BellRing, hintKey: "hub.finance.remindersHint", allowed: canPayments },
    receivables: { icon: HandCoins, allowed: false },
    payables: { icon: Building2, allowed: false },
  };
  const jobs = (hubSection("finance")?.rows ?? [])
    .filter((row) => JOB_LOOK[row.id]?.allowed)
    .map((row) => {
      const look = JOB_LOOK[row.id];
      return {
        id: row.id,
        icon: look.icon,
        hint: t((row.hintKey ?? look.hintKey) as I18nKey),
        title: t(row.labelKey as I18nKey),
        to: `${base}${row.to}`,
      };
    });

  // ── The period's heading ──────────────────────────────────────────────────────────────────
  const periodTitle =
    period === "day"
      ? t("sales.todayDate", { date: shortDay(todayISO) })
      : period === "week"
        ? t("period.week")
        : period === "month"
          ? t("period.month")
          : period === "quarter"
            ? t("sales.lastThreeMonths")
            : period === "year"
              ? t("period.year")
              : t("overall.custom");
  // The branch is the switcher's own label now, so the scope line does not repeat it — one
  // statement of the branch on the screen, and it is the control that changes it.
  const scopeLine = `${rangeLabel(rangeFrom, rangeTo)} · ${t("overall.vsPrevious")}`;

  const periodOptions: { key: Preset; label: string }[] = [
    { key: "day", label: t("sales.rangeDay") },
    { key: "week", label: t("sales.rangeWeek") },
    { key: "month", label: t("sales.rangeMonth") },
    { key: "quarter", label: t("sales.rangeQuarter") },
    { key: "year", label: t("sales.rangeYear") },
  ];

  /**
   * The plate, exactly as the Sales report draws it: profit first (the answer), then what made
   * it, then what it cost to run. Five figures, three rows, one hairline between rows.
   */
  const profitCell: Cell = {
    id: "net-profit",
    label: t("finance.netProfit"),
    value: money(netProfit),
    note: netProfitNote.note,
    tone: netProfitNote.tone,
  };
  const grossCell: Cell = {
    id: "gross-profit",
    label: t("finance.grossProfit"),
    value: money(grossProfit),
    note: grossProfitNote.note,
    tone: grossProfitNote.tone,
  };
  const salesCell: Cell = {
    id: "net-sales",
    label: t("finance.metric.netSales"),
    value: money(netSales),
    note: "",
    tone: "var(--text-tertiary)",
  };
  const cogsCell: Cell = {
    id: "cogs",
    label: t("finance.cogs"),
    value: money(cogs),
    note: "",
    tone: "var(--text-tertiary)",
  };
  const expensesCell: Cell = {
    id: "expenses",
    label: t("finance.operatingExpenses"),
    value: money(expenses),
    note: "",
    tone: "var(--text-tertiary)",
  };

  /** The figures on this screen, as rows — nothing is re-read, so an export matches the screen. */
  const figureRows = [
    { label: t("finance.netProfit"), value: money(netProfit), measure: netProfitNote.note },
    { label: t("finance.grossProfit"), value: money(grossProfit), measure: grossProfitNote.note },
    { label: t("finance.metric.netSales"), value: money(netSales), measure: "" },
    { label: t("finance.cogs"), value: money(cogs), measure: "" },
    { label: t("finance.operatingExpenses"), value: money(expenses), measure: "" },
    { label: t("finance.moneyIn"), value: money(moneyIn), measure: moneyInNote.note },
    { label: t("finance.moneyOut"), value: money(moneyOut), measure: moneyOutNote.note },
    { label: t("overall.customerReceivable"), value: formatCurrency(receivableDue), measure: t("overall.oweYou") },
    { label: t("overall.supplierPayable"), value: formatCurrency(payableDue), measure: t("overall.youOwe") },
    { label: t("overview.inventoryValue"), value: inventoryValue == null ? "—" : formatCurrency(inventoryValue), measure: "" },
  ];

  async function exportFigures() {
    setExportOpen(false);
    try {
      const csv = toCsv(
        [
          { label: t("common.total"), value: (r: (typeof figureRows)[number]) => r.label },
          { label: t("sales.amountsInPkr"), value: (r: (typeof figureRows)[number]) => r.value },
          { label: t("finance.netProfitRule"), value: (r: (typeof figureRows)[number]) => r.measure },
        ],
        figureRows,
      );
      const outcome = await exportCsv(csvFileName("financial-overview"), csv, t("financeHub.financialOverview"));
      addToast(outcome === "shared" ? t("data.exportedShared") : t("data.exported"), "success");
    } catch {
      addToast(t("data.exportFailed"), "error");
    }
  }

  /**
   * Print, in the Sales report's own shape: a plain sheet of the figures the screen is showing,
   * opened in a new window and sent to the printer. No hidden page, no second query — what is on
   * screen is what is on paper, with the window and the branch printed at the top.
   */
  function printStatement() {
    setExportOpen(false);
    const win = window.open("", "_blank");
    if (!win) {
      addToast(t("finance.printBlocked"), "error");
      return;
    }
    const rows = figureRows
      .map((row) => `<tr><td>${esc(row.label)}</td><td>${esc(row.value)}</td></tr>`)
      .join("");
    win.document.write(`<!doctype html>
<html dir="${language === "ur" ? "rtl" : "ltr"}"><head><meta charset="utf-8">
<title>${esc(t("financeHub.financialOverview"))}</title>
<style>
  body { font-family: Inter, system-ui, -apple-system, sans-serif; padding: 32px; color: #111; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 8px; }
  p { margin: 0; color: #555; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td { padding: 6px 0; border-bottom: 1px solid #ddd; }
  td + td { text-align: end; }
</style></head>
<body>
  <h1>${esc(t("financeHub.financialOverview"))}</h1>
  <p>${esc(periodTitle)}</p>
  <p>${esc(scopeLine)} · ${esc(activeBranchName ?? t("sales.thisBranch"))} · ${esc(t("sales.amountsInPkr"))}</p>
  <h2>${esc(t("finance.performance"))}</h2>
  <table>${rows}</table>
</body></html>`);
    win.document.close();
    win.focus();
    win.setTimeout(() => win.print(), 250);
  }

  /** Re-read every read this screen draws from, then say so — the figures never guess. */
  function refreshFigures() {
    setExportOpen(false);
    reports.retry();
    prevReports.retry();
    totals.retry();
    prevTotals.retry();
    movement.retry();
    prevMovement.retry();
    recurring.retry();
    void loadCustomers();
    void loadCompanies();
    addToast(t("sales.reportRefreshed"), "success");
  }

  async function shareFigures() {
    setExportOpen(false);
    const text = [
      `${periodTitle} — ${scopeLine}`,
      ...figureRows.map((row) => `${row.label}: ${row.value}`),
    ].join("\n");
    try {
      const outcome = await exportText(text, t("financeHub.financialOverview"));
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
        title={t("financeHub.financialOverview")}
        backTo={`${base}/settings`}
        historyBack
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
        title={t("financeHub.financialOverview")}
        actions={[
          // Refresh first: it is the only action about the figures already on screen, and the rest
          // leave this screen. Record money covers income, expense and drawing by its own tabs
          // (`?kind=`), so those three are not repeated here (owner, 2026-11-12).
          { id: "refresh", icon: RotateCw, title: t("sales.refreshReport"), description: t("sales.refreshReportHint"), onClick: refreshFigures },
          ...(isOwner
            ? [
                {
                  id: "record" as const,
                  icon: Plus,
                  title: t("money.recordAction"),
                  description: t("money.recordHint"),
                  onClick: () => navigate(`${base}/settings/hub/finance/record`, { state: { from: "finance" } }),
                },
              ]
            : []),
          { id: "print", icon: Printer, title: t("finance.print"), description: t("finance.printHint"), onClick: printStatement },
          { id: "export", icon: Download, title: t("data.export"), description: t("data.exportHint"), onClick: () => { void exportFigures(); } },
          { id: "share", icon: Share2, title: t("sales.shareReport"), description: t("sales.shareReportHint"), onClick: () => { void shareFigures(); } },
          {
            id: "period" as const,
            icon: CalendarRange,
            title: t("sales.changeDateRange"),
            description: t("sales.changeDateRangeHint"),
            onClick: () => { setExportOpen(false); setRangeOpen(true); },
          },
        ]}
      />

      {/* ── The window, named before it is measured — the Sales report's header, with the
          branch it is measured in on the right: the branch is part of the scope line above every
          figure, so switching it belongs next to the heading, not in a comparison list below
          (that list is gone — the switcher replaced it). ── */}
      <div className="px-4 pt-1 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-22 font-bold leading-tight" data-testid="finance-headline">{periodTitle}</h1>
          <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }} data-testid="finance-scope">
            {scopeLine}
          </p>
        </div>
        <button
          type="button"
          onClick={() => openSwitcher()}
          data-testid="finance-branch-switch"
          className="shrink-0 flex items-center gap-1 h-8 mt-0.5 ps-2.5 pe-2 rounded-full text-13 font-semibold active:opacity-70"
          style={{ background: "var(--tone-card)", color: "var(--text-primary)" }}
        >
          <span className="max-w-[7.5rem] truncate">{activeBranchName ?? t("sales.thisBranch")}</span>
          <ChevronDown size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
        </button>
      </div>

      <div className="px-4 pt-4">
        <PeriodTabs
          variant="underline"
          options={periodOptions}
          value={period === "custom" ? null : period}
          onChange={(key) => setPeriod(key)}
          onFilter={() => setRangeOpen(true)}
          filterActive={period === "custom"}
          label={t("finance.periodControl")}
          filterLabel={t("admin.selectDateRange")}
          testIdPrefix="finance-period"
        />
      </div>

      {/* ── The plate: what the period kept, what made it, what it cost ──────────────────── */}
      <div className="px-4 pt-6" data-testid="finance-profit">
        <p className="ds-section-label">{t("finance.performance")}</p>
        <div className="mt-1">
          <PlateRow cells={[profitCell, grossCell]} divided={false} />
          <PlateRow cells={[salesCell, cogsCell]} divided />
          <PlateRow cells={[expensesCell]} divided />
        </div>
        <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>
          {t("finance.netProfitRule")}
          {current != null && current.unknownLines > 0 ? ` ${t("finance.unknownCost")}` : ""}
        </p>
        {!reading && !hasActivity && (
          <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }} data-testid="finance-no-activity">
            {t("finance.noActivity")}
          </p>
        )}
      </div>

      {/* ── Money that moved: two figures, not four — cash, never profit ─────────────────── */}
      <div className="px-4 pt-4" data-testid="finance-cash">
        <p className="ds-section-label">{t("finance.moneyMoved")}</p>
        <div className="mt-1">
          <PlateRow
            cells={[
              { id: "money-in", label: t("finance.moneyIn"), value: money(moneyIn), note: moneyInNote.note, tone: moneyInNote.tone },
              { id: "money-out", label: t("finance.moneyOut"), value: money(moneyOut), note: moneyOutNote.note, tone: moneyOutNote.tone },
            ]}
            divided={false}
          />
        </div>
        <p className="text-11" style={{ color: "var(--text-tertiary)" }} data-testid="finance-cash-note">
          {t("finance.plateNote")}
        </p>
      </div>

      {/* The standing cost that leaves the till whether or not anything sells. It sits in a box of
          its own, under the cash figures it competes with (owner, 2026-11-12: "add these part in
          box") — the plate above stays flat, the row groups below are surfaces. */}
      <div className="mx-4 mt-2">
        <ListCard>
          <FlatRow
            icon={Repeat}
            title={t("finance.recurring.title")}
            meta={`${t("finance.recurring.monthly")} · ${nextRecurrenceLabel}`}
            value={activeRecurrences.length ? formatCurrency(recurringMonthly) : "—"}
            onClick={() => navigate(`${base}/settings/hub/finance/money`)}
            testId="finance-recurring"
            divided={false}
            inset
          />
        </ListCard>
      </div>

      {/* ── Owed and owing: the two balances, each the door to its ledger ────────────────── */}
      <div data-testid="finance-balances">
        <p className="ds-section-label px-4 mt-5 mb-2">{t("overall.balances")}</p>
        <ListCard className="mx-4">
          <FlatRow
            icon={HandCoins}
            title={t("overall.customerReceivable")}
            meta={overdueCredit > 0 ? t("overall.overdue", { amount: formatCurrency(overdueCredit) }) : t("overall.oweYou")}
            value={formatCurrency(receivableDue)}
            onClick={() => navigate(`${base}/settings/overview/customers`)}
            testId="finance-receivables"
            divided={false}
            inset
          />
          <FlatRow
            icon={Building2}
            title={t("overall.supplierPayable")}
            meta={t("overall.youOwe")}
            value={formatCurrency(payableDue)}
            onClick={() => navigate(`${base}/settings/overview/suppliers`)}
            testId="finance-payables"
            divided={false}
            inset
          />
        </ListCard>
      </div>

      {/* ── Where the money is sitting ──────────────────────────────────────────────────── */}
      <div>
        <SectionHead title={t("overall.inventory")} />
        <div className="mx-4">
          <ListCard>
            <FlatRow
              icon={Package}
              title={t("overview.inventoryValue")}
              meta={t("overall.inventoryHint")}
              value={inventoryValue == null ? "—" : `${inventoryIncomplete ? "≥ " : ""}${formatCurrency(inventoryValue)}`}
              onClick={() => navigate(`${base}/inventory/stockvalues`)}
              testId="finance-inventory-value"
              divided={false}
              inset
            />
          </ListCard>
        </div>
      </div>

      {/* ── The doors to the detail. The first row draws the one rule above it; a second rule on
          this wrapper made a double line under the heading. Foot room keeps the assistant button
          off the last row. ── */}
      <div className="px-4 mt-6 pb-24">
        <div>
          {jobs.map((job) => (
            <FlatRow
              key={job.id}
              icon={job.icon}
              title={job.title}
              description={job.hint}
              onClick={() => navigate(job.to)}
              testId={`hub-row-${job.id}`}
            />
          ))}
          <FlatRow
            icon={BarChart3}
            title={t("overall.reportSales")}
            description={t("overall.reportSalesHint")}
            onClick={() => navigate(`${base}/settings/hub/sales`)}
            testId="report-sales"
          />
          <FlatRow
            icon={TrendingUp}
            title={t("overall.reportProfit")}
            description={t("overall.reportProfitHint")}
            onClick={() => navigate(`${base}/reports/profit`)}
            testId="report-profit"
          />
        </div>
      </div>

      <DateRangeSheet
        open={rangeOpen}
        from={customFrom}
        to={customTo}
        max={todayISO}
        onClose={() => setRangeOpen(false)}
        onApply={(from, to) => {
          setCustomFrom(from);
          setCustomTo(to);
          setPeriod("custom");
          setRangeOpen(false);
        }}
        onClear={() => {
          setCustomFrom("");
          setCustomTo("");
          setPeriod("month");
          setRangeOpen(false);
        }}
      />
    </div>
  );
}
