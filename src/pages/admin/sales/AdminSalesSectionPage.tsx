import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Ban,
  CalendarRange,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  ReceiptText,
  RotateCw,
  Share2,
  Undo2,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import PeriodTabs from "@/components/ui/PeriodTabs";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import ListRow from "@/components/ui/ListRow";
import Sheet from "@/components/ui/Sheet";
import { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { Skeleton } from "@/components/ui/Skeleton";
import SalesActivitySheet, { type SalesActivityKind } from "@/components/sales/SalesActivitySheet";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { formatCompactCurrency, formatCurrency } from "@/lib/formatters";
import { pkDateFromISO, pkMonthStart, pkMonthStartOf, pkToday, pkWeekStart } from "@/lib/pkDate";
import { useSalesStore } from "@/stores/salesStore";
import { useShopStore } from "@/stores/shopStore";
import type { Sale } from "@/types";
import { useBranchPeriodReport } from "@/lib/branchReports";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { refundsBySale, useReturns } from "@/lib/salesActivity";

/**
 * Sales, as one screen: the report the owner reads before deciding anything.
 *
 * SHAPE (owner's reference, 2026-10-31):
 *
 *   1. What the period is worth          → six figures, two to a row, flat on the page
 *   2. How many sales made it            → completed sales and the average behind them
 *   3. Which way it is moving            → the trend, by day, week or month
 *   4. How today is going                → today beside the same weekday a week ago
 *   5. Which branch contributed what     → branch performance
 *   6. Where the ledgers live            → all sales, returns, voided sales
 *
 * THE HEADLINE GRID AND LEDGER ROWS STAY FLAT. The owner reads the period figures as one table,
 * not six unrelated widgets, and the ledger rows are destinations rather than data. The trend
 * and branch comparison are carded because the owner reads each as a distinct panel (owner's
 * instruction, 2026-11-03).
 *
 * EVERY FIGURE IS DERIVED FROM THE LEDGERS, never from a sample:
 *
 *   - Gross sales is the sum of the period's non-voided sale totals.
 *   - Sales returns are the refunds recorded against THOSE sales (`refundsBySale`), which is the
 *     same per-sale attribution `netSalesOf` uses — so a refund of last month's sale reduces
 *     last month's net, not this month's.
 *   - Completed sales is the count behind that gross, and the average is gross ÷ that count.
 *   - Outstanding credit is what those same sales still owe, stated as a share of their gross.
 *   - Each change is against the window of the SAME LENGTH ending the day before this one
 *     starts, so a month is never compared with a week.
 *   - Return rate is returns ÷ gross, carried by the export even where the grid has no tile.
 *   - Branch performance is `get_branch_period_report` (0253): each branch's gross sales,
 *     refunds and net sales for the SAME window the strip above is showing. It was lifetime
 *     sales from `get_my_branches()` before, which made a report headed "this month" compare
 *     two branches by every month before it. The database resolves it because the session's own
 *     sales feed is scoped to the branch it is working in; grouping that feed on the client
 *     could only ever draw one branch and call it the business.
 *
 * THE MENU BEHIND THE DOTS DOES REAL THINGS. Every row there is a behaviour the app can keep:
 * the date range opens the same picker as the filter; export writes a CSV of exactly the
 * figures on this page or opens a printable copy for Save as PDF; share uses the platform
 * share sheet and falls back to the clipboard; refresh re-reads both ledgers. Nothing is drawn
 * as an option it cannot perform.
 *
 * THE TREND IS ALSO A DOOR. Tapping the chart opens the best sellers of the same window —
 * the products behind the line, ranked by revenue, from the sale items the ledger already
 * carries.
 */

/**
 * The report's five presets (the reference's 1D…1Y), plus the hand-picked window.
 *
 * `quarter` is three calendar months ending with this one — the same unit every ledger groups
 * by — not 90 days, which would put a different set of sales under the tab tomorrow.
 */
type Preset = "day" | "week" | "month" | "quarter" | "year";
type Period = Preset | "custom";
/** Which series the trend card is drawing. */
type TrendMetric = "net" | "returns";

/** Which way a figure has to move before the movement is good news. */
type GoodDirection = "up" | "down";

/** Every figure the report's headline grid states, derived from one window of sales. */
interface Totals {
  gross: number;
  refunds: number;
  net: number;
  count: number;
  average: number;
  /** Still unpaid on these sales — credit the shop is carrying, not money it kept. */
  outstanding: number;
}

/**
 * One change against the previous window, already written as the row shows it.
 *
 * A percentage needs a previous figure to be a percentage OF; when there was none, the absolute
 * change is stated alone rather than printed as an infinite rise. A zero-to-zero move is not a
 * jump in either direction, so it is labelled instead of coloured.
 */
interface DeltaLine {
  text: string;
  direction: "up" | "down" | "flat";
  /** True when this direction is the good one for the figure in question. */
  favourable: boolean;
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

/** A month, as a chart axis says it: "Oct". */
function shortMonth(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
}

/** The same window of sales, summed the one way every screen sums it. */
function totalsOf(list: Sale[], refunds: Map<string, number>): Totals {
  let gross = 0;
  let refunded = 0;
  let outstanding = 0;
  for (const sale of list) {
    const refund = refunds.get(sale.id) ?? 0;
    gross += sale.totalAmount;
    refunded += refund;
    outstanding += sale.outstandingBalance;
  }
  return {
    gross,
    refunds: refunded,
    net: gross - refunded,
    count: list.length,
    average: list.length > 0 ? gross / list.length : 0,
    outstanding,
  };
}

/**
 * The change between two windows, written as "+Rs. 168.35 (12.5%)".
 *
 * `format` is the figure's own formatter: money in rupees, a count in whole numbers. The sign
 * always states the DIRECTION of the move; whether that direction is good is decided by the
 * caller, because a rise in refunds is not the same news as a rise in sales.
 */
function deltaOf(
  current: number,
  previous: number,
  format: (value: number) => string,
  good: GoodDirection,
): DeltaLine {
  const diff = current - previous;
  const direction: DeltaLine["direction"] = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const favourable = direction === "flat" ? true : good === "up" ? direction === "up" : direction === "down";
  if (previous === 0) {
    return { text: diff === 0 ? "" : `${diff > 0 ? "+" : "−"}${format(Math.abs(diff))}`, direction, favourable };
  }
  const percent = Math.abs((diff / previous) * 100);
  const shown = percent >= 10 ? percent.toFixed(0) : percent.toFixed(1);
  return {
    text: `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${format(Math.abs(diff))} (${shown}%)`,
    direction,
    favourable,
  };
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

/** One CSV field, quoted only when it has to be. */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Names arrive from the database; a printable document must not treat them as markup. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

/** One drawn bucket of the trend: its span, its label, and the two series it carries. */
interface Bucket {
  label: string;
  from: string;
  to: string;
  gross: number;
  returns: number;
  net: number;
}

export default function AdminSalesSectionPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  // Settings when opened from the menu, the Reports hub when opened from its Sales tile.
  const returnTo = useReturnTo(`${base}/settings`);
  const { addToast } = useUIStore();
  const { language } = useThemeStore();

  const sales = useSalesStore((s) => s.sales);
  const salesReady = useSalesStore((s) => s.ready);
  const loadSales = useSalesStore((s) => s.load);
  const branchName = useShopStore((s) => s.activeBranchName);
  const { returns, refresh: refreshReturns } = useReturns();

  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [metric, setMetric] = useState<TrendMetric>("net");
  const [openSheet, setOpenSheet] = useState<SalesActivityKind | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [topOpen, setTopOpen] = useState(false);
  const [bucketOpen, setBucketOpen] = useState<number | null>(null);

  // A direct link can land here before the shell has read the ledgers; ask for them rather than
  // drawing an empty report that looks like a branch with no sales.
  useEffect(() => {
    if (!salesReady) void loadSales();
  }, [salesReady, loadSales]);


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
  // starts — not a fixed "last month", which would compare windows of different lengths.
  const prevTo = shiftDays(rangeFrom, -1);
  const prevFrom = shiftDays(prevTo, -(windowDays - 1));

  const refunds = useMemo(() => refundsBySale(returns), [returns]);

  const periodSales = useMemo(
    () =>
      sales.filter((sale) => {
        if (sale.isVoided) return false;
        const day = pkDateFromISO(sale.createdAt);
        return day >= rangeFrom && day <= rangeTo;
      }),
    [sales, rangeFrom, rangeTo],
  );

  const buckets = useMemo<Bucket[]>(() => {
    // Days for a single-day report (and a short custom window), weeks for a month, months for
    // anything longer: thirty daily points on a phone is a texture, not a trend.
    const byDay = period === "day" || (period === "custom" && windowDays <= 14);
    const byWeek = !byDay && (period === "month" || (period === "custom" && windowDays <= 35));
    const spans: { label: string; from: string; to: string }[] = [];

    if (byDay) {
      for (let start = rangeFrom; start <= rangeTo; start = shiftDays(start, 1)) {
        spans.push({ label: String(Number(start.slice(8, 10))), from: start, to: start });
      }
    } else if (byWeek) {
      let index = 0;
      for (let start = rangeFrom; start <= rangeTo; start = shiftDays(start, 7)) {
        const weekEnd = shiftDays(start, 6);
        spans.push({
          label: t("overall.week", { n: String(++index) }),
          from: start,
          to: weekEnd > rangeTo ? rangeTo : weekEnd,
        });
      }
    } else {
      let start = pkMonthStartOf(rangeFrom);
      while (start <= rangeTo) {
        const next = pkMonthStartOf(start, 1);
        const monthEnd = shiftDays(next, -1);
        spans.push({
          label: shortMonth(start),
          from: start,
          to: monthEnd > rangeTo ? rangeTo : monthEnd,
        });
        start = next;
      }
    }

    const drawn: Bucket[] = spans.map((span) => ({ ...span, gross: 0, returns: 0, net: 0 }));
    for (const sale of periodSales) {
      const day = pkDateFromISO(sale.createdAt);
      const bucket = drawn.find((b) => day >= b.from && day <= b.to);
      if (!bucket) continue;
      const refund = refunds.get(sale.id) ?? 0;
      bucket.gross += sale.totalAmount;
      bucket.returns += refund;
      bucket.net += sale.totalAmount - refund;
    }
    return drawn;
  }, [period, windowDays, rangeFrom, rangeTo, periodSales, refunds, t]);

  // The period's own figures, summed from the same rows the chart draws — the grid and the line
  // can never disagree about what was sold.
  const totals = useMemo(() => totalsOf(periodSales, refunds), [periodSales, refunds]);
  const grossTotal = totals.gross;
  const returnsTotal = totals.refunds;
  const netTotal = totals.net;
  const completed = totals.count;
  const average = totals.average;
  const returnRate = grossTotal > 0 ? (returnsTotal / grossTotal) * 100 : 0;

  // The previous window of the same length, by the same per-sale refund attribution.
  const previousTotals = useMemo(() => {
    const list = sales.filter((sale) => {
      if (sale.isVoided) return false;
      const day = pkDateFromISO(sale.createdAt);
      return day >= prevFrom && day <= prevTo;
    });
    return totalsOf(list, refunds);
  }, [sales, refunds, prevFrom, prevTo]);

  // Today beside the same weekday a week ago. Fixed to the calendar rather than to the selected
  // window, so this line always answers "how is today going" whatever the tabs are showing.
  const daily = useMemo(() => {
    const lastWeekDay = shiftDays(todayISO, -7);
    let todayGross = 0;
    let lastWeekGross = 0;
    for (const sale of sales) {
      if (sale.isVoided) continue;
      const day = pkDateFromISO(sale.createdAt);
      if (day === todayISO) todayGross += sale.totalAmount;
      else if (day === lastWeekDay) lastWeekGross += sale.totalAmount;
    }
    return { todayGross, lastWeekGross };
  }, [sales, todayISO]);

  // The headline is a sentence about the window, so it reads in sentence case: a tab label
  // ("This Month") is title-cased for a chip, a headline is not.
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
  const scopeLine = `${rangeLabel(rangeFrom, rangeTo)} · ${branchName ?? t("sales.thisBranch")} · ${t("overall.vsPrevious")}`;

  // ── Branch performance ──────────────────────────────────────────────────────────
  // The same window the report is showing, resolved per branch at the database (0253). The
  // client cannot group its own sales feed into a branch comparison: that feed holds only the
  // branch the session is working in. A branch whose figures could not be read is absent, not
  // drawn as zeros, and the card says so when the whole read fails.
  const { rows: periodBranchRows, failed: branchFailed } = useBranchPeriodReport(rangeFrom, rangeTo);
  const branchRows = useMemo(
    () => [...(periodBranchRows ?? [])].sort((a, b) => (b.grossSales ?? 0) - (a.grossSales ?? 0)),
    [periodBranchRows],
  );
  const maxBranchSales = Math.max(1, ...branchRows.map((branch) => branch.grossSales ?? 0));

  // ── Best sellers of the same window ─────────────────────────────────────────────
  const topProducts = useMemo(() => {
    const byName = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const sale of periodSales) {
      for (const item of sale.items) {
        const name = item.productName || item.variantName;
        if (!name) continue;
        const entry = byName.get(name) ?? { name, qty: 0, revenue: 0 };
        entry.qty += item.qty;
        entry.revenue += item.lineTotal;
        byName.set(name, entry);
      }
    }
    const list = [...byName.values()].sort((a, b) => b.revenue - a.revenue);
    const total = list.reduce((sum, product) => sum + product.revenue, 0);
    return list.map((product) => ({
      ...product,
      share: total > 0 ? (product.revenue / total) * 100 : 0,
    }));
  }, [periodSales]);

  const money = (value: number) => (salesReady ? formatCurrency(value) : "—");
  // The headline figures are read at a glance, so they use the short form (Rs. 139.5K). The
  // detail sheets, the branch rows and the export keep the full rupee amount — a ledger is
  // read number by number, not skimmed.
  const compactMoney = (value: number) => (salesReady ? formatCompactCurrency(value) : "—");
  // The bucket whose exact figures the sheet states, or null when it is closed.
  const openBucket = bucketOpen != null ? buckets[bucketOpen] ?? null : null;
  const metricTotal = metric === "net" ? netTotal : returnsTotal;
  const previousTotal = metric === "net" ? previousTotals.net : previousTotals.refunds;
  const change =
    previousTotal > 0 ? ((metricTotal - previousTotal) / previousTotal) * 100 : null;

  // ── The chart ────────────────────────────────────────────────────────────────────
  const values = buckets.map((b) => (metric === "net" ? b.net : b.returns));
  const peak = Math.max(0, ...values);
  const W = 320;
  const H = 108;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? W / 2 : (index / (values.length - 1)) * W;
    const y = peak > 0 ? H - 8 - (value / peak) * (H - 20) : H - 2;
    return [x, y] as const;
  });
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  // The five presets, short enough to sit on one line at 320px: 1D · 1W · 1M · 3M · 1Y.
  const periodOptions: { key: Preset; label: string }[] = [
    { key: "day", label: t("sales.rangeDay") },
    { key: "week", label: t("sales.rangeWeek") },
    { key: "month", label: t("sales.rangeMonth") },
    { key: "quarter", label: t("sales.rangeQuarter") },
    { key: "year", label: t("sales.rangeYear") },
  ];

  // ── The report's own actions ────────────────────────────────────────────────────
  const periodLine = `${rangeFrom} – ${rangeTo}`;

  /** The same figures the screen shows, in the order it shows them. */
  function reportRows(): (string | number)[][] {
    return [
      [t("hub.sales.reportTitle")],
      [periodLine],
      [scopeLine],
      [t("sales.amountsInPkr")],
      [],
      [t("sales.overview")],
      [t("hub.sales.grossSales"), grossTotal],
      [t("sales.netSales"), netTotal],
      [t("sales.title"), completed],
      [t("hub.sales.averageSale"), Math.round(average)],
      [t("sales.refunds"), returnsTotal],
      [t("sales.outstandingCredit"), totals.outstanding],
      [t("hub.sales.returnRate"), `${returnRate.toFixed(1)}%`],
      [],
      [t("sales.dailyGross")],
      [t("sales.today"), daily.todayGross],
      [t("sales.sameDayLastWeek"), daily.lastWeekGross],
      [],
      [
        t("overall.branchPerformance"),
        t("hub.sales.grossSales"),
        t("hub.sales.salesReturns"),
        t("sales.netSales"),
      ],
      ...branchRows.map((branch) => [
        branch.branchName,
        branch.grossSales ?? "",
        branch.returns ?? "",
        branch.netSales ?? "",
      ]),
      [],
      [t("sales.topProductsTitle"), t("sales.revenue"), t("sales.quantity"), t("sales.share")],
      ...topProducts.map((product) => [
        product.name,
        product.revenue,
        product.qty,
        `${product.share.toFixed(1)}%`,
      ]),
    ];
  }

  function downloadCsv() {
    const csv = reportRows().map((row) => row.map(csvCell).join(",")).join("\r\n");
    // The BOM keeps Excel from reading the Urdu headings as the wrong encoding.
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sales-report_${rangeFrom}_${rangeTo}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportOpen(false);
    addToast(t("sales.reportDownloaded"), "success");
  }

  function exportPdf() {
    const win = window.open("", "_blank");
    if (!win) {
      addToast(t("sales.shareFailed"), "error");
      return;
    }
    const direction = language === "ur" ? "rtl" : "ltr";
    const figures: [string, string][] = [
      [t("hub.sales.grossSales"), money(grossTotal)],
      [t("sales.netSales"), money(netTotal)],
      [t("sales.title"), salesReady ? String(completed) : "—"],
      [t("hub.sales.averageSale"), money(average)],
      [t("sales.refunds"), money(returnsTotal)],
      [t("sales.outstandingCredit"), money(totals.outstanding)],
      [t("hub.sales.returnRate"), salesReady ? `${returnRate.toFixed(1)}%` : "—"],
      [t("sales.today"), money(daily.todayGross)],
      [t("sales.sameDayLastWeek"), money(daily.lastWeekGross)],
    ];
    const figureRows = figures
      .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
      .join("");
    const branchRowsHtml = branchRows
      .map(
        (branch) =>
          `<tr><td>${escapeHtml(branch.branchName)}</td>` +
          `<td>${branch.grossSales != null ? escapeHtml(formatCurrency(branch.grossSales)) : "—"}</td>` +
          `<td>${branch.returns != null ? escapeHtml(formatCurrency(branch.returns)) : "—"}</td>` +
          `<td>${branch.netSales != null ? escapeHtml(formatCurrency(branch.netSales)) : "—"}</td></tr>`,
      )
      .join("");
    const productRowsHtml = topProducts
      .map(
        (product) =>
          `<tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(formatCurrency(product.revenue))}</td>` +
          `<td>${escapeHtml(String(product.qty))}</td><td>${product.share.toFixed(1)}%</td></tr>`,
      )
      .join("");

    win.document.write(`<!doctype html>
<html dir="${direction}"><head><meta charset="utf-8">
<title>${escapeHtml(t("hub.sales.reportTitle"))}</title>
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
  <h1>${escapeHtml(t("hub.sales.reportTitle"))}</h1>
  <p>${escapeHtml(scopeLine)}</p>
  <p>${escapeHtml(periodLine)} · ${escapeHtml(t("sales.amountsInPkr"))}</p>
  <h2>${escapeHtml(t("sales.overview"))}</h2>
  <table>${figureRows}</table>
  ${branchRowsHtml ? `<h2>${escapeHtml(t("overall.branchPerformance"))}</h2><table>${branchRowsHtml}</table>` : ""}
  ${productRowsHtml ? `<h2>${escapeHtml(t("sales.topProductsTitle"))}</h2><table>${productRowsHtml}</table>` : ""}
</body></html>`);
    win.document.close();
    win.focus();
    win.setTimeout(() => win.print(), 250);
    setExportOpen(false);
  }

  async function shareReport() {
    const text =
      `${t("hub.sales.reportTitle")} (${periodLine})\n` +
      `${t("hub.sales.grossSales")}: ${formatCurrency(grossTotal)}\n` +
      `${t("sales.netSales")}: ${formatCurrency(netTotal)}\n` +
      `${t("sales.refunds")}: ${formatCurrency(returnsTotal)}\n` +
      `${t("hub.sales.completedSales")}: ${completed}`;
    setOptionsOpen(false);
    if (navigator.share) {
      try {
        await navigator.share({ title: t("hub.sales.reportTitle"), text });
        addToast(t("sales.reportShared"), "success");
        return;
      } catch (error) {
        // A sheet the person dismissed is not a failure. Any OTHER refusal (a browser that
        // advertises share but blocks it) falls through to the clipboard rather than doing
        // nothing at all when the row is tapped.
        if ((error as DOMException | undefined)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      addToast(t("sales.reportCopied"), "success");
    } catch {
      addToast(t("sales.shareFailed"), "error");
    }
  }

  async function refreshReport() {
    setOptionsOpen(false);
    refreshReturns();
    await loadSales();
    addToast(t("sales.reportRefreshed"), "success");
  }

  /** A change line, in the colour of its own news: a rise in refunds is not a rise in sales. */
  const noteOf = (delta: DeltaLine) =>
    !salesReady
      ? { text: "—", tone: "var(--text-tertiary)" }
      : delta.direction === "flat"
        ? { text: t("sales.noChange"), tone: "var(--text-tertiary)" }
        : { text: delta.text, tone: delta.favourable ? "var(--brand-dark)" : "var(--error)" };

  // The reference's plate, in its order: value, what it measures, and how it moved against the
  // window of the same length just before this one. Outstanding credit is a balance rather than
  // a flow, so it states its share of the period's gross instead of a change it cannot have.
  const overviewRows = [
    [
      {
        testId: "sales-hub-gross",
        value: compactMoney(grossTotal),
        label: t("hub.sales.grossSales"),
        note: noteOf(deltaOf(grossTotal, previousTotals.gross, formatCompactCurrency, "up")),
      },
      {
        testId: "sales-hub-net-sales",
        value: compactMoney(netTotal),
        label: t("sales.netSales"),
        note: noteOf(deltaOf(netTotal, previousTotals.net, formatCompactCurrency, "up")),
      },
    ],
    [
      {
        testId: "sales-hub-completed",
        value: salesReady ? completed.toLocaleString("en-PK") : "—",
        label: t("sales.title"),
        note: noteOf(
          deltaOf(completed, previousTotals.count, (value) => value.toLocaleString("en-PK"), "up"),
        ),
      },
      {
        testId: "sales-hub-average",
        value: compactMoney(average),
        label: t("hub.sales.averageSale"),
        note: noteOf(deltaOf(average, previousTotals.average, formatCompactCurrency, "up")),
      },
    ],
    [
      {
        testId: "sales-hub-refunds",
        value: compactMoney(returnsTotal),
        label: t("sales.refunds"),
        note: noteOf(deltaOf(returnsTotal, previousTotals.refunds, formatCompactCurrency, "down")),
      },
      {
        testId: "sales-hub-outstanding",
        value: compactMoney(totals.outstanding),
        label: t("sales.outstandingCredit"),
        note: {
          text: !salesReady
            ? "—"
            : grossTotal > 0
              ? t("sales.ofGross", {
                  pct: String(Math.round((totals.outstanding / grossTotal) * 100)),
                })
              : "—",
          tone: "var(--text-tertiary)",
        },
      },
    ],
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="sales-hub-page"
    >
      <StatusBar />
      <NavHeader
        title={t("hub.sales.reportTitle")}
        backTo={returnTo}
        right={
          <SectionActionsButton
            onClick={() => setOptionsOpen(true)}
            label={t("sales.reportOptions")}
            testId="sales-report-menu"
          />
        }
      />

      <div className="px-4 pt-1">
        <h1 className="text-22 font-bold leading-tight" data-testid="sales-headline">
          {periodTitle}
        </h1>
        <p
          className="text-13 mt-1"
          style={{ color: "var(--text-secondary)" }}
          data-testid="sales-scope"
        >
          {scopeLine}
        </p>
      </div>

      <div className="px-4 pt-4">
        <PeriodTabs
          variant="underline"
          options={periodOptions}
          value={period === "custom" ? null : period}
          onChange={(key) => setPeriod(key)}
          onFilter={() => setRangeOpen(true)}
          filterActive={period === "custom"}
          label={t("overview.periodLabel")}
          filterLabel={t("admin.selectDateRange")}
          testIdPrefix="sales-period"
        />
      </div>

      {/* ── 1. What the period is worth, and which way it moved ─────────────────────── */}
      {/* The reference's plate: no cards, two figures to a row, one hairline between rows. A
          box around each figure would draw six boxes where the report is one table. */}
      <div className="px-4 pt-6" data-testid="sales-hub-overview">
        <p className="ds-section-label">{t("sales.overview")}</p>
        <div className="mt-1">
          {overviewRows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              className="grid grid-cols-2 gap-x-4 py-4"
              style={rowIndex > 0 ? { borderTop: "1px solid var(--hairline)" } : undefined}
            >
              {row.map((tile) => (
                <div key={tile.testId} className="min-w-0" data-testid={tile.testId}>
                  <p className="text-18 font-semibold leading-none tabular-nums break-words">
                    {tile.value}
                  </p>
                  <p className="text-13 mt-2" style={{ color: "var(--text-secondary)" }}>
                    {tile.label}
                  </p>
                  <p
                    className="text-12 mt-1 font-semibold tabular-nums break-words"
                    style={{ color: tile.note.tone }}
                    data-testid={`${tile.testId}-note`}
                  >
                    {tile.note.text}
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── 2. Today beside the same weekday a week ago ─────────────────────────────── */}
      <div className="px-4 pt-2 pb-5" data-testid="sales-hub-daily">
        <p className="ds-section-label">{t("sales.dailyGross")}</p>
        <div className="grid grid-cols-2 gap-x-4 pt-3">
          <div className="min-w-0">
            <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("sales.today")}</p>
            <p className="text-18 font-semibold mt-1 tabular-nums break-words">
              {compactMoney(daily.todayGross)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-13" style={{ color: "var(--text-secondary)" }}>
              {t("sales.sameDayLastWeek")}
            </p>
            <p className="text-18 font-semibold mt-1 tabular-nums break-words">
              {compactMoney(daily.lastWeekGross)}
            </p>
          </div>
        </div>
      </div>

      {/* ── 3. Which way it is moving ──────────────────────────────────────────────── */}
      {/* The trend is its own panel: the chart, its metric switch and its bucket targets read as
          one object, separate from the headline grid above. */}
      <div className="px-4 pt-4">
        <div
          data-testid="sales-hub-trend"
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
        >
          <p className="text-14 font-bold">{t("hub.sales.salesTrend")}</p>
          <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {t("hub.sales.trendHint")}
          </p>

          <div
            className="flex items-center gap-1 mt-3 p-1 rounded-full w-fit"
            style={{ background: "var(--tone-sunken)" }}
            role="group"
            aria-label={t("hub.sales.salesTrend")}
          >
            {([
              { key: "net" as const, label: t("sales.netSales") },
              { key: "returns" as const, label: t("hub.sales.returns") },
            ]).map((option) => {
              const selected = metric === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMetric(option.key)}
                  data-testid={`sales-trend-${option.key}`}
                  className="h-7 px-3 rounded-full text-11 font-semibold transition-colors"
                  style={
                    selected
                      ? { background: "var(--tone-card)", color: "var(--text-primary)" }
                      : { background: "transparent", color: "var(--text-secondary)" }
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <p className="text-18 font-semibold mt-3 tabular-nums break-words">
            {compactMoney(metricTotal)}
          </p>
          <p className="text-11 mt-0.5 flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
            {change != null && (
              <span
                className="inline-flex items-center gap-0.5 font-semibold"
                style={{ color: change >= 0 ? "var(--brand-dark)" : "var(--error)" }}
                data-testid="sales-trend-change"
              >
                {change >= 0 ? "+" : "−"}
                {Math.abs(Math.round(change))}% {t("overall.vsPrevious")}
              </span>
            )}
            <span>
              {t(metric === "net" ? "hub.sales.totalRevenue" : "hub.sales.totalReturns")}
            </span>
          </p>

          {/* Each bucket is its own target. A chart-wide button would answer "what is behind the
              line" but never "what is this week" — the question the owner actually asks. The
              hit areas are real buttons over the drawing, so a tap, a keyboard focus and a
              screen reader all reach the same weekly figure. */}
          <div className="relative mt-3 rounded-[var(--radius-tile)]">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full"
              role="img"
              aria-label={`${t("hub.sales.salesTrend")}: ${money(metricTotal)}`}
              data-testid="sales-trend-chart"
            >
              <path d={area} fill="var(--brand-light)" />
              <path
                d={line}
                fill="none"
                stroke="var(--brand)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.map(([x, y], index) => (
                <circle key={index} cx={x} cy={y} r="2" fill="var(--brand)" />
              ))}
            </svg>
            <div className="absolute inset-0 flex" dir="ltr">
              {buckets.map((bucket, index) => (
                <button
                  key={`${bucket.from}-${index}`}
                  type="button"
                  onClick={() => setBucketOpen(index)}
                  aria-label={`${bucket.label}: ${t("sales.netSales")} ${money(bucket.net)}, ${t("hub.sales.returns")} ${money(bucket.returns)}`}
                  data-testid={`sales-trend-bucket-${index}`}
                  className="flex-1 h-full ds-pressable rounded-[var(--radius-tile)]"
                  style={{ background: "transparent" }}
                />
              ))}
            </div>
          </div>

          {/* The axis stays left-to-right in both languages: the line is drawn in time order,
              so reversing only the labels would put "Week 1" under the last point in Urdu. */}
          <div className="flex mt-1" dir="ltr">
            {buckets.map((bucket, index) => (
              <span
                key={`${bucket.from}-${index}`}
                className="flex-1 min-w-0 text-9 text-center truncate"
                style={{ color: "var(--text-secondary)" }}
                data-testid={`sales-trend-label-${index}`}
              >
                {bucket.label}
              </span>
            ))}
          </div>

          {peak === 0 && (
            <p className="text-11 mt-2" style={{ color: "var(--text-tertiary)" }}>
              {t(metric === "net" ? "sales.noSales" : "sales.noReturns")}
            </p>
          )}

          <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
            {t("sales.trendTapHint")}
          </p>

          {/* The products behind the line keep their door; it is just no longer the only one
              the chart offers. */}
          <button
            type="button"
            onClick={() => setTopOpen(true)}
            data-testid="sales-trend-open-top"
            className="flex items-center gap-1 mt-2 text-11 font-semibold active:opacity-70"
            style={{ color: "var(--brand-dark)" }}
          >
            {t("sales.topProductsTitle")}
            <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {/* ── 4. Which branch contributed what ───────────────────────────────────────── */}
      {/* The branch comparison is its own panel, matching the trend above. */}
      <div className="px-4 pt-4">
        <div
          data-testid="sales-hub-branches"
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
        >
          <p className="text-14 font-bold">{t("overall.branchPerformance")}</p>
          <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {t("sales.branchCompareHint")}
          </p>

          {branchFailed ? (
            <p className="text-12 mt-3" style={{ color: "var(--text-secondary)" }} data-testid="sales-branches-failed">
              {t("sales.branchReadFailed")}
            </p>
          ) : periodBranchRows === null ? (
            <div className="flex flex-col gap-3 mt-3" aria-busy="true">
              <Skeleton w="100%" h="34px" />
              <Skeleton w="100%" h="34px" />
            </div>
          ) : branchRows.length === 0 ? (
            <p className="text-12 mt-3" style={{ color: "var(--text-secondary)" }}>
              {t("sales.noBranchInScope")}
            </p>
          ) : (
            <div className="flex flex-col gap-3.5 mt-3">
              {branchRows.map((branch) => (
                <div key={branch.branchId} data-testid={`sales-branch-${branch.branchId}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-13 font-semibold truncate min-w-0">
                      {branch.branchName}
                      {branch.isCurrent && (
                        <span className="text-10 font-normal ms-1.5" style={{ color: "var(--text-secondary)" }}>
                          {t("shop.current")}
                        </span>
                      )}
                    </p>
                    <p className="text-13 font-bold tabular-nums shrink-0">
                      {branch.grossSales != null ? formatCurrency(branch.grossSales) : "—"}
                    </p>
                  </div>
                  {/* `flex` so the fill grows from the row's inline start: in Urdu the bar has
                      to begin under the name, which sits on the right. */}
                  <div
                    className="mt-1.5 h-1.5 rounded-full overflow-hidden flex"
                    style={{ background: "var(--tone-sunken)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(0, Math.min(100, ((branch.grossSales ?? 0) / maxBranchSales) * 100))}%`,
                        background: "var(--brand)",
                      }}
                    />
                  </div>
                  {/* The two figures behind that gross, for the same window: refunds are stated
                      rather than netted into the bar, so a branch with heavy returns is visible. */}
                  <div className="flex items-baseline justify-between gap-3 mt-1">
                    <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
                      {t("hub.sales.salesReturns")}{" "}
                      <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {branch.returns == null ? "—" : formatCurrency(branch.returns)}
                      </span>
                    </p>
                    <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
                      {t("sales.netSales")}{" "}
                      <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {branch.netSales == null ? "—" : formatCurrency(branch.netSales)}
                      </span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 5. Where the ledgers live ──────────────────────────────────────────────── */}
      {/* The "Returns analysis" card that used to sit here is gone (owner, 2026-10-30): its two
          figures are already in the KPI plate and its one action is the "View returns" row two
          lines below. A card whose whole job is a link to the row under it is furniture. */}
      {/* Unboxed and line-free, like every section hub: each row is a different place. */}
      <div className="pt-3 pb-8">
        <ListRow
          testId="hub-row-all"
          icon={ReceiptText}
          title={t("hub.sales.viewAllSales")}
          trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
          onClick={() => navigate(`${base}/sales`)}
        />
        <ListRow
          testId="hub-row-returns"
          icon={Undo2}
          title={t("hub.sales.viewReturns")}
          trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
          onClick={() => setOpenSheet("returns")}
        />
        {/* The one ledger with no other door: All Sales filters voided rows out, so removing this
            row would make them unreadable anywhere in the app. */}
        <ListRow
          testId="hub-row-voided"
          icon={Ban}
          title={t("hub.sales.voided")}
          trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
          onClick={() => setOpenSheet("voided")}
        />
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

      <SalesActivitySheet
        kind={openSheet ?? "returns"}
        open={openSheet !== null}
        onClose={() => setOpenSheet(null)}
      />

      {/* ── Report options, behind the dots in the header ─────────────────────────── */}
      <Sheet
        open={optionsOpen}
        title={t("sales.reportOptions")}
        onClose={() => setOptionsOpen(false)}
        closeButton={false}
      >
        <div className="pt-1 pb-2">
          <ListRow
            testId="report-option-range"
            icon={CalendarRange}
            title={t("sales.changeDateRange")}
            description={t("sales.changeDateRangeHint")}
            trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            onClick={() => {
              setOptionsOpen(false);
              setRangeOpen(true);
            }}
          />
          <ListRow
            testId="report-option-export"
            icon={Download}
            title={t("sales.exportReport")}
            description={t("sales.exportReportHint")}
            trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            onClick={() => {
              setOptionsOpen(false);
              setExportOpen(true);
            }}
          />
          <ListRow
            testId="report-option-share"
            icon={Share2}
            title={t("sales.shareReport")}
            description={t("sales.shareReportHint")}
            trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            onClick={() => void shareReport()}
          />
          <ListRow
            testId="report-option-refresh"
            icon={RotateCw}
            title={t("sales.refreshReport")}
            description={t("sales.refreshReportHint")}
            onClick={() => void refreshReport()}
          />
        </div>
      </Sheet>

      {/* ── Export: two formats the app can really produce ────────────────────────── */}
      <Sheet
        open={exportOpen}
        title={t("sales.exportReport")}
        onClose={() => setExportOpen(false)}
        closeButton={false}
      >
        <div className="pt-1 pb-2">
          <ListRow
            testId="export-report-csv"
            icon={FileSpreadsheet}
            title={t("sales.exportExcel")}
            description={t("sales.exportExcelHint")}
            onClick={downloadCsv}
          />
          <ListRow
            testId="export-report-pdf"
            icon={FileText}
            title={t("sales.exportPdf")}
            description={t("sales.exportPdfHint")}
            onClick={exportPdf}
          />
        </div>
      </Sheet>

      {/* ── One bucket of the line: its exact figures, not the axis's shape ────────── */}
      <Sheet
        open={openBucket != null}
        title={openBucket?.label ?? ""}
        onClose={() => setBucketOpen(null)}
        closeButton={false}
      >
        {openBucket && (
          <div className="px-4 pb-2" data-testid="sales-bucket-sheet">
            <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
              {openBucket.from} – {openBucket.to}
            </p>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div
                className="rounded-[var(--radius-card)] p-3.5 min-w-0"
                style={{ background: "var(--tone-card)" }}
              >
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                  {t("sales.netSales")}
                </p>
                <p
                  className="text-18 font-bold mt-1 tabular-nums break-words"
                  data-testid="sales-bucket-net"
                >
                  {formatCurrency(openBucket.net)}
                </p>
                <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  {t("sales.netSalesHint")}
                </p>
              </div>
              <div
                className="rounded-[var(--radius-card)] p-3.5 min-w-0"
                style={{ background: "var(--tone-card)" }}
              >
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                  {t("hub.sales.returns")}
                </p>
                <p
                  className="text-18 font-bold mt-1 tabular-nums break-words"
                  style={{ color: openBucket.returns > 0 ? "var(--error)" : "var(--text-primary)" }}
                  data-testid="sales-bucket-returns"
                >
                  {formatCurrency(openBucket.returns)}
                </p>
                <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  {t("sales.returnsValue")}
                </p>
              </div>
            </div>
            <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>
              {t("hub.sales.grossSales")}{" "}
              <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {formatCurrency(openBucket.gross)}
              </span>
            </p>
          </div>
        )}
      </Sheet>

      {/* ── Best sellers: the products behind the selected window's line ──────────── */}
      <Sheet
        open={topOpen}
        title={t("sales.topProductsTitle")}
        onClose={() => setTopOpen(false)}
        closeButton={false}
      >
        <div className="px-4 pb-2">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("sales.topProductsHint")}
          </p>
          <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>{periodLine}</p>

          {topProducts.length === 0 ? (
            <p className="text-12 mt-4" style={{ color: "var(--text-secondary)" }}>
              {t("sales.noProductsInPeriod")}
            </p>
          ) : (
            <div className="flex flex-col gap-3 mt-4">
              {topProducts.map((product) => (
                <div key={product.name} data-testid={`top-product-${product.name}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-13 font-semibold truncate min-w-0">{product.name}</p>
                    <p className="text-12 font-bold tabular-nums shrink-0">
                      {product.share.toFixed(0)}%
                    </p>
                  </div>
                  <div
                    className="mt-1.5 h-6 rounded-[var(--radius-tile)] overflow-hidden flex"
                    style={{ background: "var(--tone-sunken)" }}
                    role="img"
                    aria-label={`${product.name}: ${product.share.toFixed(0)}%`}
                  >
                    <div
                      className="h-full rounded-[var(--radius-tile)]"
                      style={{
                        width: `${Math.max(2, Math.min(100, product.share))}%`,
                        background: "var(--brand)",
                      }}
                    />
                  </div>
                  <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>
                    {formatCurrency(product.revenue)} ·{" "}
                    {t("sales.soldQty", { count: product.qty.toLocaleString("en-PK") })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
