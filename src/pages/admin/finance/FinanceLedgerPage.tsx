import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Download,
  Plus,
  Receipt,
  Repeat,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import ListCard from "@/components/ui/ListCard";
import PeriodTabs from "@/components/ui/PeriodTabs";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import SearchBar from "@/components/ui/SearchBar";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { hasPermission } from "@/lib/tenantContext";
import { useAuthStore } from "@/stores/authStore";
import {
  useFinanceEntries,
  useFinanceRecurrences,
  monthWindow,
  postDueFinanceEntries,
  stopFinanceRecurrence,
  CATEGORY_KEY,
  METHOD_KEY,
  KIND_LABEL_KEY,
  REPEAT_KEY,
  type FinanceEntryKind,
  type FinanceRecurrence,
  type RepeatUnit,
} from "@/lib/financeEntries";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";
import { downloadCsv } from "@/lib/csv";

/**
 * Every income, expense and drawing the branch recorded, in one list the owner can read and
 * export.
 *
 * SHAPE (owner's instruction, 2026-10-30). The screen states its own name in the app bar and no
 * longer repeats it inside the page: the period, the arithmetic, the search and then the rows. The
 * calendar in the app bar picks a hand-entered window; the two presets beside it stay, and while a
 * custom window is showing neither preset claims to be the one in force.
 *
 * WHY THIS SCREEN EXISTS. The Finance overview can say "12,000 spent" on rent bills and salaries
 * together, and that figure is only trustworthy if the rows behind it can be seen. The form wrote
 * them (0254) and the totals read them; this is the third reader, with the same gate and the same
 * branch scope, so the ledger can never list a row the overview did not count or miss one it did.
 *
 * WHO WROTE IT. Each row carries the name of the account that recorded it (0255). A row that says
 * "rent" without saying who recorded it is a row the owner cannot ask about; when the account is
 * gone the line says so rather than inventing a name.
 *
 * REPEATING MONEY. A rule is drawn once, in its own strip, with the next day it will post and a
 * way to stop it. The rows it already wrote are money and stay. Posting happens HERE, when the
 * owner opens the ledger, because the app has no scheduler that runs while it is closed; the rows
 * are dated the day they fell due, not the day they were posted.
 *
 * THE EXPORT IS THE VISIBLE LIST. Whatever the search and the filter show is what the file
 * contains — exporting "all" while the screen shows only expenses would hand the owner a document
 * that disagrees with the screen they were looking at when they tapped export.
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

const EVERY_KEY = {
  day: "finance.repeat.everyDays",
  week: "finance.repeat.everyWeeks",
  month: "finance.repeat.everyMonths",
} as const;

export default function FinanceLedgerPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const language = useThemeStore((s) => s.language);
  const role = useAuthStore((s) => s.user?.membershipRole);

  const day = pkToday();
  const thisMonth = useMemo(() => monthWindow(day), [day]);
  const [period, setPeriod] = useState<"month" | "previous">("month");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);

  const window = custom ?? (period === "month" ? thisMonth : { from: thisMonth.prevFrom, to: thisMonth.prevTo });

  const { rows, failed, retry } = useFinanceEntries(window.from, window.to);
  const recurrences = useFinanceRecurrences(window.from, window.to);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [stopping, setStopping] = useState<FinanceRecurrence | null>(null);
  const [stoppingBusy, setStoppingBusy] = useState(false);

  const canRead = hasPermission("payments.view");
  const isOwner = role === "owner";

  // Posting once per visit, before the rows are read: the read is what the screen is for, and a
  // rule that fell due while the app was closed should already be in the month it belongs to.
  const posted = useRef(false);
  useEffect(() => {
    if (!isOwner || posted.current) return;
    posted.current = true;
    void postDueFinanceEntries().then((count) => {
      if (count > 0) retry();
    });
  }, [isOwner, retry]);

  // The totals on the plate are the rows filtered nothing, so they describe the period even while
  // one kind is selected below — the filter changes the list, never the period's arithmetic.
  const totals = useMemo(() => {
    const sum: Record<FinanceEntryKind, number> = { income: 0, expense: 0, drawing: 0 };
    for (const row of rows ?? []) sum[row.kind] += row.amount;
    return sum;
  }, [rows]);

  const net = totals.income - totals.expense - totals.drawing;

  const money = (value: number | null) => (value == null ? "—" : formatCurrency(value));

  const kindLabel = (kind: FinanceEntryKind) => t(KIND_LABEL_KEY[kind]);
  const categoryLabel = (category: string) =>
    CATEGORY_KEY[category] ? t(CATEGORY_KEY[category]) : category || t("finance.unknown");
  const methodLabel = (method: string) =>
    METHOD_KEY[method as keyof typeof METHOD_KEY] ? t(METHOD_KEY[method as keyof typeof METHOD_KEY]) : method;

  const repeatWords = (unit: RepeatUnit, every: number) => {
    if (unit === "none") return t("finance.repeat.none");
    return every <= 1 ? t(REPEAT_KEY[unit]) : t(EVERY_KEY[unit], { n: every });
  };

  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(language === "ur" ? "ur-PK" : "en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  /**
   * The list, narrowed by the chips and by one search box.
   *
   * The search reads the words the row PRINTS (the translated category and method) as well as the
   * stored ones, so typing "نقد" finds a cash row in Urdu and typing "bank" finds it in English.
   * Amount and date are in the haystack too: "5000" and "28 Oct" are how an owner looks for a
   * receipt they remember by its figure or its day.
   */
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      if (filter !== "all" && row.kind !== filter) return false;
      if (!term) return true;
      const haystack = [
        kindLabel(row.kind),
        categoryLabel(row.category),
        row.category,
        methodLabel(row.method),
        row.method,
        row.counterparty ?? "",
        row.note ?? "",
        row.createdByName ?? "",
        row.occurredOn,
        shortDate(row.occurredOn),
        String(row.amount),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
    // The label helpers close over `t` and `language`, both of which change the words searched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, search, language]);

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
      t("finance.ledger.addedByColumn"),
      t("finance.amount"),
    ];
    const body = filtered.map((row) => [
      row.occurredOn,
      kindLabel(row.kind),
      categoryLabel(row.category),
      methodLabel(row.method),
      row.counterparty ?? "",
      row.note ?? "",
      row.createdByName ?? t("finance.ledger.addedUnknown"),
      // Signed, so a spreadsheet sums the column into the same net the screen shows.
      (row.kind === "income" ? 1 : -1) * row.amount,
    ]);
    downloadCsv(`custom-income-expense_${window.from}_${window.to}.csv`, [header, ...body]);
    addToast(t("finance.ledger.exported"), "success");
  }

  async function stopRepeating() {
    if (!stopping || stoppingBusy) return;
    setStoppingBusy(true);
    try {
      await stopFinanceRecurrence(stopping.id);
      addToast(t("finance.ledger.repeatStopped"), "success");
      setStopping(null);
      recurrences.retry();
    } catch {
      addToast(t("finance.ledger.stopFailed"), "error");
    } finally {
      setStoppingBusy(false);
    }
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
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRangeOpen(true)}
              aria-label={t("finance.ledger.choosePeriod")}
              data-testid="finance-ledger-calendar"
              className="flex items-center justify-center size-11 rounded-full active:opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              <CalendarDays size={18} />
            </button>
            <button
              type="button"
              onClick={exportCsv}
              aria-label={t("finance.ledger.export")}
              data-testid="finance-ledger-export"
              className="flex items-center justify-center size-11 rounded-full active:opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              <Download size={18} />
            </button>
          </div>
        }
      />

      <div className="px-4 pt-1">
        <PeriodTabs
          options={[
            { key: "month", label: t("finance.ledger.thisMonth") },
            { key: "previous", label: t("finance.ledger.lastMonth") },
          ]}
          value={custom ? null : period}
          onChange={(key) => {
            setCustom(null);
            setPeriod(key);
          }}
          label={t("finance.ledger.period")}
          filterLabel={t("finance.ledger.period")}
          testIdPrefix="finance-ledger-period"
        />
      </div>

      {custom && (
        <div className="px-4 pt-2 flex items-center gap-2">
          <span
            className="text-11 px-3 py-1.5 rounded-full min-w-0 truncate"
            style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
            data-testid="finance-ledger-range"
          >
            {t("finance.ledger.customRange", { from: shortDate(custom.from), to: shortDate(custom.to) })}
          </span>
          <button
            type="button"
            onClick={() => setCustom(null)}
            aria-label={t("common.clear")}
            data-testid="finance-ledger-range-clear"
            className="flex items-center justify-center size-8 rounded-full active:opacity-60"
            style={{ color: "var(--text-secondary)" }}
          >
            <X size={14} />
          </button>
        </div>
      )}

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

          {/* The rules, stated once. A rule is not money: what it posts is in the totals above. */}
          {recurrences.rows && recurrences.rows.length > 0 && (
            <div className="px-4 pt-4" data-testid="finance-ledger-repeating">
              <p className="text-13 font-bold">{t("finance.ledger.repeating")}</p>
              <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {t("finance.ledger.repeatingHint")}
              </p>
              <div className="flex flex-col gap-2 mt-2">
                {recurrences.rows.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded-[var(--radius-card)] p-3 flex items-center gap-3"
                    style={{ background: "var(--tone-card)" }}
                    data-testid={`finance-recurrence-${rule.id}`}
                  >
                    <Repeat size={16} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-13 font-bold truncate">{categoryLabel(rule.category)}</p>
                      <p className="text-10 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                        {repeatWords(rule.repeatUnit, rule.repeatEvery)}
                        {" · "}
                        {t("finance.ledger.nextOn", { date: shortDate(rule.nextOn) })}
                      </p>
                    </div>
                    <p className="text-13 font-bold tabular-nums shrink-0">{formatCurrency(rule.amount)}</p>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => setStopping(rule)}
                        aria-label={t("finance.ledger.stopRepeat")}
                        data-testid={`finance-recurrence-stop-${rule.id}`}
                        className="size-11 rounded-full flex items-center justify-center shrink-0 active:opacity-60"
                        style={{ color: "var(--error)" }}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

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

          <div className="px-4 pt-3">
            <SearchBar
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch("")}
              placeholder={t("finance.ledger.search")}
              data-testid="finance-ledger-search"
            />
          </div>

          {/* A quiet text action, not a page-wide button: adding money is one of the things this
              screen can do, not the reason it exists. */}
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
            {isOwner ? (
              <button
                type="button"
                onClick={() => navigate(`${base}/settings/hub/finance/record?kind=income`)}
                data-testid="finance-ledger-add"
                className="flex items-center gap-1.5 text-13 font-semibold active:opacity-60"
                style={{ color: "var(--brand-dark)" }}
              >
                <Plus size={15} />
                {t("finance.add")}
              </button>
            ) : (
              <span />
            )}
            <p className="text-12 tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {rows === null ? "—" : filtered.length}
            </p>
          </div>

          <div className="px-4 pb-6">
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
                title={search.trim() || filter !== "all" ? t("finance.ledger.emptyFiltered") : t("finance.ledger.empty")}
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
                      badge={
                        row.recurrenceId ? (
                          <Repeat
                            size={12}
                            aria-label={repeatWords(row.repeatUnit ?? "none", row.repeatEvery ?? 1)}
                            style={{ color: "var(--text-tertiary)" }}
                          />
                        ) : undefined
                      }
                      meta={t("finance.ledger.addedBy", {
                        name: row.createdByName ?? t("finance.ledger.addedUnknown"),
                      })}
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
        </>
      )}

      <DateRangeSheet
        open={rangeOpen}
        from={custom?.from ?? window.from}
        to={custom?.to ?? window.to}
        max={day}
        onClose={() => setRangeOpen(false)}
        onApply={(from, to) => {
          setCustom({ from, to });
          setRangeOpen(false);
        }}
        onClear={() => {
          setCustom(null);
          setRangeOpen(false);
        }}
      />

      <ConfirmDialog
        open={Boolean(stopping)}
        title={t("finance.ledger.stopRepeatTitle")}
        message={t("finance.ledger.stopRepeatMessage", {
          category: stopping ? categoryLabel(stopping.category) : "",
        })}
        confirmLabel={t("finance.ledger.stopRepeat")}
        destructive
        loading={stoppingBusy}
        onConfirm={stopRepeating}
        onCancel={() => setStopping(null)}
      />
    </div>
  );
}
