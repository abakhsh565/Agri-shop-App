import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, Building2, ChevronRight, Download, History, Package, Share2, TrendingUp, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";
import { useUIStore } from "@/stores/uiStore";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
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
 * EACH ROW PREVIEWS ITS ANSWER (owner's follow-up, 2026-10-29). A list of sentences still made
 * the owner open four screens to learn four numbers they already ask for every morning, so the
 * four money rows carry their figure under the sentence: the month's net sales and profit, the
 * customers' outstanding balance, and what is still owed to suppliers. The figure is read from
 * the same sources those reports read — `get_branch_period_report` for the month, the customer
 * and company stores for the standing balances — so the preview cannot disagree with the screen
 * it opens. Rows with no single money answer (Inventory, Activity) keep the sentence alone.
 *
 * THE DESTINATIONS AND THE SENTENCES COME FROM `lib/settingsHub` — the same catalogue the
 * Settings menu reads. This page owns only which glyph each report wears and which permission
 * its destination asks for, so re-pointing a report or rewording what it answers is one line in
 * the catalogue.
 *
 * EVERY ROW OPENS A SCREEN THAT EXISTS:
 *
 *   Sales     → the branch's sales report (net, returns, trend, branch split)
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
  profit: { icon: TrendingUp, permission: "reports.view" },
  customers: { icon: Users, permission: "customers.view" },
  suppliers: { icon: Building2, permission: "companies.view" },
  inventory: { icon: Package },
  activity: { icon: History, permission: "activity.view" },
};

/** The label each previewed figure wears, or nothing for a row with no money answer. */
const FIGURE_LABEL: Record<string, string> = {
  sales: "reports.figureSales",
  profit: "reports.figureProfit",
  customers: "reports.figureReceivables",
  suppliers: "reports.figurePayables",
};

export default function AdminReportsHubPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

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

  // The previews cover the same window the screens they open open on: this PK month.
  const month = pkToday().substring(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const { rows: branchRows } = useBranchPeriodReport(
    `${month}-01`,
    new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
  );

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
    const text = figureRows.map((r) => `${r.report}: ${r.figure} (${r.measure})`).join("\n");
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
        backTo={`${base}/settings`}
        right={<SectionActionsButton onClick={() => setMenuOpen(true)} label={t("data.export")} testId="reports-actions" />}
      />

      <SectionActionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("settings.menu.reports")}
        actions={[
          { id: "export", icon: Download, title: t("data.export"), description: t("data.exportHint"), onClick: () => { void exportFigures(); } },
          { id: "share", icon: Share2, title: t("sales.shareReport"), description: t("sales.shareReportHint"), onClick: () => { void shareFigures(); } },
        ]}
      />

      <div className="pt-1 pb-6">
        {visible.map((row) => {
          const figure = figureFor(row.id);
          return (
            <ListRow
              key={row.id}
              testId={`reports-row-${row.id}`}
              icon={row.icon}
              onClick={() =>
                navigate(`${base}${row.to}`, {
                  state: { from: `${base}/settings/hub/reports` },
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
              {figure && (
                <p className="text-12 mt-1" data-testid={`reports-figure-${row.id}`}>
                  <span className="font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {figure.text}
                  </span>
                  <span style={{ color: "var(--text-tertiary)" }}> · {figure.label}</span>
                </p>
              )}
            </ListRow>
          );
        })}
      </div>
    </div>
  );
}
