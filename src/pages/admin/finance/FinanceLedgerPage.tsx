import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Plus,
  Receipt,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import ListCard from "@/components/ui/ListCard";
import PeriodTabs from "@/components/ui/PeriodTabs";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useShopStore } from "@/stores/shopStore";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { hasPermission } from "@/lib/tenantContext";
import { useAuthStore } from "@/stores/authStore";
import { useFinanceEntries, monthWindow, CATEGORY_KEY, METHOD_KEY, KIND_LABEL_KEY } from "@/lib/financeEntries";
import type { FinanceEntryKind } from "@/lib/financeEntries";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";

/**
 * Every income, expense and drawing the branch recorded, in one list the owner can read and
 * export.
 *
 * WHY THIS SCREEN EXISTS. The Finance overview can say "12,000 spent" on rent bills and salaries
 * together, and that figure is only trustworthy if the rows behind it can be seen. The form wrote
 * them (0254) and the totals read them; this is the third reader, with the same gate and the same
 * branch scope, so the ledger can never list a row the overview did not count or miss one it did.
 *
 * THE EXPORT IS THE VISIBLE LIST. Whatever the filter shows is what the file contains — exporting
 * "all" while the screen shows only expenses would hand the owner a document that disagrees with
 * the screen they were looking at when they tapped export.
 *
 * NOTHING HERE COMPUTES A BALANCE. Net recorded money is the three totals added and subtracted,
 * and it says so; it is not profit, and the row above it in the app (net profit) has its own
 * arithmetic on the overview.
 */

type Filter = "all" | FinanceEntryKind;

const KIND_ICON: Record<FinanceEntryKind, LucideIcon> = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  drawing: Undo2,
};

/** One CSV field, quoted only when it has to be. */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function FinanceLedgerPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const language = useThemeStore((s) => s.language);
  const branchName = useShopStore((s) => s.activeBranchName);
  const role = useAuthStore((s) => s.user?.membershipRole);

  const day = pkToday();
  const thisMonth = useMemo(() => monthWindow(day), [day]);
  const [period, setPeriod] = useState<"month" | "previous">("month");
  const window = period === "month" ? thisMonth : { from: thisMonth.prevFrom, to: thisMonth.prevTo };

  const { rows, failed, retry } = useFinanceEntries(window.from, window.to);
  const [filter, setFilter] = useState<Filter>("all");

  const canRead = hasPermission("payments.view");
  const isOwner = role === "owner";

  // The totals on the plate are the rows filtered nothing, so they describe the period even while
  // one kind is selected below — the filter changes the list, never the period's arithmetic.
  const totals = useMemo(() => {
    const sum: Record<FinanceEntryKind, number> = { income: 0, expense: 0, drawing: 0 };
    for (const row of rows ?? []) sum[row.kind] += row.amount;
    return sum;
  }, [rows]);

  const net = totals.income - totals.expense - totals.drawing;

  const filtered = useMemo(
    () => (rows ?? []).filter((row) => filter === "all" || row.kind === filter),
    [rows, filter],
  );

  const money = (value: number | null) => (value == null ? "—" : formatCurrency(value));

  const kindLabel = (kind: FinanceEntryKind) => t(KIND_LABEL_KEY[kind]);
  const categoryLabel = (category: string) =>
    CATEGORY_KEY[category] ? t(CATEGORY_KEY[category]) : category || t("finance.unknown");
  const methodLabel = (method: string) =>
    METHOD_KEY[method as keyof typeof METHOD_KEY] ? t(METHOD_KEY[method as keyof typeof METHOD_KEY]) : method;

  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(language === "ur" ? "ur-PK" : "en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  function exportCsv() {
    if (!filtered.length) {
      addToast(t("finance.ledger.exportEmpty"), "info");
      return;
    }
    const header = [
      t("finance.ledger.date"),
      t("finance.ledger.kind"),
      t("finance.category"),
      t("finance.method"),
      t("finance.counterparty"),
      t("finance.description"),
      t("finance.amount"),
    ];
    const body = filtered.map((row) => [
      row.occurredOn,
      kindLabel(row.kind),
      categoryLabel(row.category),
      methodLabel(row.method),
      row.counterparty ?? "",
      row.note ?? "",
      // Signed, so a spreadsheet sums the column into the same net the screen shows.
      (row.kind === "income" ? 1 : -1) * row.amount,
    ]);
    const csv = [header, ...body].map((line) => line.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `recorded-money_${window.from}_${window.to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    addToast(t("finance.ledger.exported"), "success");
  }

  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: t("finance.ledger.all") },
    { id: "income", label: t("finance.ledger.income") },
    { id: "expense", label: t("finance.ledger.expense") },
    { id: "drawing", label: t("finance.ledger.drawing") },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="finance-ledger-page"
    >
      <StatusBar />
      <NavHeader
        title={t("finance.ledger.title")}
        backTo={`${base}/settings/hub/finance`}
        right={
          <button
            type="button"
            onClick={exportCsv}
            aria-label={t("finance.ledger.export")}
            data-testid="finance-ledger-export"
            className="flex items-center justify-center size-8 rounded-full active:opacity-60"
            style={{ color: "var(--text-primary)" }}
          >
            <Download size={18} />
          </button>
        }
      />

      <div className="px-4 pt-1">
        <h1 className="text-22 font-bold leading-tight">{t("finance.ledger.title")}</h1>
        <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
          {t("finance.ledger.subtitle")}
        </p>
        <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>
          {t("creditList.scope", { branch: branchName ?? t("hub.inventory.selectedBranch") })}
        </p>
      </div>

      <div className="px-4 pt-3">
        <PeriodTabs
          options={[
            { key: "month", label: t("finance.ledger.thisMonth") },
            { key: "previous", label: t("finance.ledger.lastMonth") },
          ]}
          value={period}
          onChange={setPeriod}
          label={t("finance.ledger.period")}
          filterLabel={t("finance.ledger.period")}
          testIdPrefix="finance-ledger-period"
        />
      </div>

      {!canRead ? (
        <p className="px-4 pt-4 text-12" style={{ color: "var(--text-secondary)" }}>
          {t("finance.ownerOnly")}
        </p>
      ) : (
        <>
          {/* The period's arithmetic, then the three parts it is made of. */}
          <div className="px-4 pt-3">
            <div
              className="rounded-[var(--radius-card)] p-4"
              style={{ background: "var(--surface)" }}
              data-testid="finance-ledger-summary"
            >
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("finance.ledger.net")}
              </p>
              {rows === null && !failed ? (
                <Skeleton w="160px" h="30px" className="mt-1" />
              ) : (
                <p
                  className="text-22 font-bold mt-1 tabular-nums break-words"
                  data-testid="finance-ledger-net"
                  style={{ color: net < 0 ? "var(--error)" : "var(--text-primary)" }}
                >
                  {failed ? "—" : money(net)}
                </p>
              )}

              <div className="grid grid-cols-3 gap-2 mt-3">
                {(["income", "expense", "drawing"] as FinanceEntryKind[]).map((kind) => (
                  <div key={kind} className="min-w-0">
                    <p className="text-10 truncate" style={{ color: "var(--text-secondary)" }}>
                      {kindLabel(kind)}
                    </p>
                    <p
                      className="text-13 font-bold mt-0.5 tabular-nums break-words"
                      data-testid={`finance-ledger-total-${kind}`}
                      style={{
                        color:
                          kind === "income"
                            ? "var(--brand-dark)"
                            : kind === "expense"
                              ? "var(--text-primary)"
                              : "var(--text-secondary)",
                      }}
                    >
                      {failed || (rows === null && !failed) ? "—" : money(totals[kind])}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* The visible list is the exported list, so the filter says which document a tap on
              export produces. */}
          <div className="px-4 pt-4 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
            {chips.map((chip) => {
              const selected = chip.id === filter;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFilter(chip.id)}
                  aria-pressed={selected}
                  data-testid={`finance-ledger-filter-${chip.id}`}
                  className="shrink-0 h-9 px-4 rounded-full text-12 font-semibold transition-colors"
                  style={
                    selected
                      ? { background: "var(--brand)", color: "var(--ink-fg)" }
                      : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
                  }
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          <div className="px-4 pt-4 pb-6">
            {failed ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                  {t("finance.ledger.failed")}
                </p>
                <Button variant="outline" onClick={retry} testId="finance-ledger-retry">
                  {t("common.retry")}
                </Button>
              </div>
            ) : rows === null ? (
              <div className="flex flex-col gap-2">
                <Skeleton w="100%" h="64px" />
                <Skeleton w="100%" h="64px" />
                <Skeleton w="100%" h="64px" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title={t("finance.ledger.empty")}
                subtitle={t("finance.ledger.emptyHint")}
              />
            ) : (
              <ListCard>
                {filtered.map((row) => {
                  const Icon = KIND_ICON[row.kind];
                  const signed = (row.kind === "income" ? 1 : -1) * row.amount;
                  const detail = [shortDate(row.occurredOn), methodLabel(row.method)]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <ListRow
                      key={row.id}
                      testId={`finance-entry-${row.id}`}
                      icon={Icon}
                      title={categoryLabel(row.category)}
                      description={[detail, row.counterparty || row.note].filter(Boolean).join(" · ")}
                      trailing={
                        <span
                          className="text-13 font-bold tabular-nums shrink-0"
                          style={{
                            color:
                              row.kind === "income"
                                ? "var(--brand-dark)"
                                : row.kind === "expense"
                                  ? "var(--text-primary)"
                                  : "var(--text-secondary)",
                          }}
                        >
                          {`${signed > 0 ? "+" : "−"}${formatCurrency(Math.abs(signed))}`}
                        </span>
                      }
                    />
                  );
                })}
              </ListCard>
            )}
          </div>

          {isOwner && (
            <div className="px-4 pb-8 mt-auto">
              <Button
                fullWidth
                size="lg"
                onClick={() => navigate(`${base}/settings/hub/finance/record?kind=expense`)}
                testId="finance-ledger-add"
              >
                <Plus size={18} className="me-2" />
                {t("finance.add")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
