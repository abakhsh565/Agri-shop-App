import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Download,
  Pencil,
  Plus,
  Repeat,
  Share2,
  X,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import BalanceDateSheet, { type BalancePeriod } from "@/components/ui/BalanceDateSheet";
import SearchBar from "@/components/ui/SearchBar";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { Skeleton } from "@/components/ui/Skeleton";
import FinanceEntrySheet from "@/components/finance/FinanceEntrySheet";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { hasPermission } from "@/lib/tenantContext";
import {
  MONEY_SOURCE_KEY,
  useMoneyStatement,
  useMoneyTotals,
  type MoneyMovement,
} from "@/lib/financeMoney";
import {
  CATEGORY_KEY,
  METHOD_KEY,
  REPEAT_KEY,
  postDueFinanceEntries,
  stopFinanceRecurrence,
  useFinanceRecurrences,
  type FinanceRecurrence,
} from "@/lib/financeEntries";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";

/**
 * Money — every movement in the branch, in one list.
 *
 * WHY ONE SCREEN. The owner had three lists that answered the same question: the
 * recorded-entry ledger, the customer/supplier payment list, and the statement. Each showed a
 * different slice of the same money, and a reader had to know which slice a movement fell into
 * before they could find it. The statement already reads all of those ledgers in one query (0262),
 * so this screen is that query with the controls the other two needed:
 *
 *   - the period, on the same Today / This week / This month / This year / Custom sheet as the
 *     rest of the app;
 *   - the direction and "Recorded" filters, over one list;
 *   - recorded rows open the correction sheet, because those are the only movements this app
 *     writes by hand; sales and payments stay read-only and are corrected in their own books;
 *   - the repeating strip, so a cadence can still be seen and stopped where its rows appear.
 *
 * The three totals come from `get_money_totals`, an aggregate over the same statement rows, so the
 * figures cannot describe a different set of movements from the list below them.
 *
 * WHAT IT DOES NOT DO. It does not write a sale, a customer payment or a supplier payment. Those
 * move stock and settle debts; they belong to the screen that owns them. The one write here is
 * "Record money", the merged income/expense/drawing form, and it is owner-only at the database.
 */

type Filter = "all" | "in" | "out" | "recorded";

const EVERY_KEY = {
  day: "finance.repeat.everyDays",
  week: "finance.repeat.everyWeeks",
  month: "finance.repeat.everyMonths",
} as const;

export default function MoneyStatementPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const language = useThemeStore((s) => s.language);
  const role = useAuthStore((s) => s.user?.membershipRole);
  const isOwner = role === "owner";
  // More is the parent hub on the employee and Co-Owner shells; only the owner shell keeps
  // the Finance section as its parent.
  const parent = base === "/admin" ? `${base}/settings/hub/finance` : `${base}/more`;
  const { addToast } = useUIStore();

  const day = pkToday();
  const weekStart = useMemo(() => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  }, [day]);

  // The Finance hub can link here for the month it is showing. Without this, "View statement"
  // opened the current month and disagreed with the figures that sent the reader here.
  const [searchParams] = useSearchParams();
  const linkedFrom = searchParams.get("from") ?? "";
  const linkedTo = searchParams.get("to") ?? "";
  const hasLinkedPeriod =
    /^\d{4}-\d{2}-\d{2}$/.test(linkedFrom) && /^\d{4}-\d{2}-\d{2}$/.test(linkedTo);
  const [period, setPeriod] = useState<BalancePeriod>(hasLinkedPeriod ? "custom" : "month");
  const [custom, setCustom] = useState({ from: hasLinkedPeriod ? linkedFrom : "", to: hasLinkedPeriod ? linkedTo : "" });
  const [periodOpen, setPeriodOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [stopping, setStopping] = useState<FinanceRecurrence | null>(null);
  const [stoppingBusy, setStoppingBusy] = useState(false);

  const window = useMemo(() => {
    switch (period) {
      case "all":
        return { from: "2000-01-01", to: day };
      case "today":
        return { from: day, to: day };
      case "week":
        return { from: weekStart, to: day };
      case "year":
        return { from: `${day.slice(0, 4)}-01-01`, to: day };
      case "custom":
        return { from: custom.from || day, to: custom.to || day };
      default:
        return { from: `${day.slice(0, 7)}-01`, to: day };
    }
  }, [period, custom, day, weekStart]);

  const statement = useMoneyStatement(window.from, window.to);
  const totals = useMoneyTotals(window.from, window.to);
  const recurrences = useFinanceRecurrences(window.from, window.to);

  const canRead = hasPermission("payments.view");

  // Posting happens when the owner opens the book, because the app has no scheduler behind it.
  // The rows are dated the day they fell due, and the reads below are retried only when this
  // call actually wrote something.
  const posted = useRef(false);
  useEffect(() => {
    if (!isOwner || posted.current) return;
    posted.current = true;
    void postDueFinanceEntries().then((count) => {
      if (count > 0) {
        statement.retry();
        totals.retry();
        recurrences.retry();
      }
    });
  }, [isOwner, statement.retry, totals.retry, recurrences.retry]);

  const sourceLabel = (source: MoneyMovement["source"]) => t(MONEY_SOURCE_KEY[source]);

  const codeLabel = (value: string | null, map: Readonly<Partial<Record<string, string>>>) => {
    if (!value) return "";
    const key = map[value];
    return key ? t(key as I18nKey) : value;
  };

  const methodLabel = (value: string | null) => {
    if (!value) return "";
    if (value === "bank_transfer") return t("sale.bankTransfer");
    if (value === "cash") return t("sale.cash");
    return codeLabel(value, METHOD_KEY);
  };

  const categoryLabel = (value: string) =>
    CATEGORY_KEY[value] ? t(CATEGORY_KEY[value]) : value || t("finance.unknown");

  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(language === "ur" ? "ur-PK" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  const money = (value: number | null | undefined) =>
    value == null ? "—" : formatCurrency(value);

  const periodLabel =
    period === "all"
      ? t("period.allDates")
      : period === "today"
        ? t("period.today")
        : period === "week"
          ? t("period.week")
          : period === "month"
            ? t("period.month")
            : period === "year"
              ? t("period.year")
              : `${shortDate(window.from)} – ${shortDate(window.to)}`;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (statement.rows ?? []).filter((row) => {
      if (filter === "in" && row.direction !== "in") return false;
      if (filter === "out" && row.direction !== "out") return false;
      if (filter === "recorded" && !row.source.startsWith("finance_")) return false;
      if (!term) return true;
      return [
        sourceLabel(row.source),
        row.source,
        row.party ?? "",
        row.reference ?? "",
        codeLabel(row.reference, CATEGORY_KEY),
        row.note ?? "",
        row.method ?? "",
        methodLabel(row.method),
        row.occurredOn,
        shortDate(row.occurredOn),
        String(row.amount),
        formatCurrency(row.amount),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
    // The label helpers close over `t` and `language`; both change the words searched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement.rows, filter, search, language]);

  const groups = useMemo(() => {
    const map = new Map<string, MoneyMovement[]>();
    for (const row of filtered) {
      const list = map.get(row.occurredOn) ?? [];
      list.push(row);
      map.set(row.occurredOn, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const signed = (row: MoneyMovement) =>
    `${row.direction === "in" ? "+" : "−"}${formatCurrency(row.amount)}`;

  const repeatWords = (rule: FinanceRecurrence) =>
    rule.repeatEvery <= 1
      ? t(REPEAT_KEY[rule.repeatUnit])
      : t(EVERY_KEY[rule.repeatUnit as "day" | "week" | "month"], { n: rule.repeatEvery });

  async function download() {
    if (!filtered.length) {
      addToast(t("money.exportEmpty"), "info");
      return;
    }
    const csv = toCsv(
      [
        { label: t("finance.ledger.date"), value: (row: MoneyMovement) => row.occurredOn },
        { label: t("money.direction"), value: (row: MoneyMovement) => (row.direction === "in" ? t("money.in") : t("money.out")) },
        { label: t("money.source.sale"), value: (row: MoneyMovement) => sourceLabel(row.source) },
        { label: t("money.party"), value: (row: MoneyMovement) => row.party ?? "" },
        { label: t("money.reference"), value: (row: MoneyMovement) => row.reference ?? "" },
        { label: t("money.method"), value: (row: MoneyMovement) => methodLabel(row.method) },
        { label: t("money.note"), value: (row: MoneyMovement) => row.note ?? "" },
        { label: t("finance.amount"), value: (row: MoneyMovement) => (row.direction === "in" ? row.amount : -row.amount) },
      ],
      filtered,
    );
    try {
      const outcome = await exportCsv(csvFileName("money"), csv, t("money.title"));
      addToast(outcome === "shared" ? t("data.exportedShared") : t("money.exported"), "success");
    } catch {
      addToast(t("data.exportFailed"), "error");
    }
  }

  async function share() {
    if (!filtered.length) {
      addToast(t("money.exportEmpty"), "info");
      return;
    }
    const lines = [
      `${t("money.title")} · ${shortDate(window.from)} – ${shortDate(window.to)}`,
      `${t("money.in")}: ${money(totals.totals?.moneyIn)}`,
      `${t("money.out")}: ${money(totals.totals?.moneyOut)}`,
      `${t("money.net")}: ${money(totals.totals?.net)}`,
      "",
      ...filtered.slice(0, 40).map((row) =>
        `${shortDate(row.occurredOn)} · ${sourceLabel(row.source)} · ${signed(row)}${row.party ? ` · ${row.party}` : ""}`,
      ),
    ];
    try {
      const outcome = await exportText(lines.join("\n"), t("money.title"));
      addToast(outcome === "shared" ? t("sales.reportShared") : t("money.shareCopied"), "success");
    } catch {
      addToast(t("money.shareFailed"), "error");
    }
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

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t("cashPosition.filterAll") },
    { key: "in", label: t("cashPosition.received") },
    { key: "out", label: t("cashPosition.paid") },
    { key: "recorded", label: t("money.filter.recorded") },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="money-statement-page"
    >
      <StatusBar />
      <NavHeader
        title={t("money.title")}
        backTo={parent}
        historyBack
        right={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPeriodOpen(true)}
              aria-label={t("money.choosePeriod")}
              data-testid="money-statement-calendar"
              className="flex items-center justify-center size-11 rounded-full active:opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              <CalendarDays size={18} />
            </button>
            <SectionActionsButton
              onClick={() => setActionsOpen(true)}
              label={t("data.moreActions")}
              testId="money-statement-actions"
            />
          </div>
        }
      />

      <SectionActionsSheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={t("money.title")}
        actions={[
          { id: "export", icon: Download, title: t("money.export"), onClick: () => { void download(); } },
          { id: "share", icon: Share2, title: t("money.share"), onClick: () => { void share(); } },
        ]}
      />

      {!canRead ? (
        <p className="px-4 pt-4 text-12" style={{ color: "var(--text-secondary)" }}>
          {t("finance.ownerOnly")}
        </p>
      ) : (
        <>
          <div className="px-4 pt-3">
            <div
              className="rounded-[var(--radius-card)] p-4"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
              data-testid="money-statement-summary"
            >
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "in", label: t("money.in"), value: totals.totals?.moneyIn, tone: "var(--brand-dark)" },
                  { id: "out", label: t("money.out"), value: totals.totals?.moneyOut, tone: "var(--text-primary)" },
                  { id: "net", label: t("money.net"), value: totals.totals?.net, tone: "var(--brand-dark)" },
                ].map((figure) => (
                  <div key={figure.id} className="min-w-0">
                    <p className="text-10 truncate" style={{ color: "var(--text-secondary)" }}>
                      {figure.label}
                    </p>
                    {totals.totals === null && !totals.failed ? (
                      <Skeleton w="80%" h="18px" className="mt-1" />
                    ) : (
                      <p
                        className="text-14 font-bold mt-0.5 tabular-nums break-words"
                        style={{
                          color:
                            figure.id === "net" && (figure.value ?? 0) < 0 ? "var(--error)" : figure.tone,
                        }}
                        data-testid={`money-statement-${figure.id}`}
                      >
                        {totals.failed ? "—" : money(figure.value)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {isOwner && (
            <div className="px-4 pt-2">
              <button
                type="button"
                onClick={() => navigate(`${base}/settings/hub/finance/record`)}
                data-testid="money-record"
                className="min-h-11 flex items-center gap-1.5 text-13 font-semibold active:opacity-60"
                style={{ color: "var(--brand-dark)" }}
              >
                <Plus size={15} />
                {t("money.recordAction")}
              </button>
            </div>
          )}

          <div className="flex gap-2 px-4 pt-3 flex-wrap">
            {filters.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setFilter(entry.key)}
                aria-pressed={filter === entry.key}
                data-testid={`money-filter-${entry.key}`}
                className="h-8 px-3.5 rounded-full text-12 font-semibold transition-colors"
                style={
                  filter === entry.key
                    ? { background: "var(--brand)", color: "#0a0a0a" }
                    : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
                }
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="px-4 pt-3">
            <SearchBar
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch("")}
              placeholder={t("money.search")}
              data-testid="money-statement-search"
            />
          </div>

          {recurrences.rows && recurrences.rows.length > 0 && (
            <div className="px-4 pt-4" data-testid="money-repeating">
              <p className="text-13 font-bold">{t("finance.ledger.repeating")}</p>
              <div className="flex flex-col gap-2 mt-2">
                {recurrences.rows.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded-[var(--radius-card)] p-3 flex items-center gap-3"
                    style={{ background: "var(--tone-card)" }}
                    data-testid={`money-recurrence-${rule.id}`}
                  >
                    <Repeat size={16} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-13 font-bold truncate">{categoryLabel(rule.category)}</p>
                      <p className="text-10 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                        {repeatWords(rule)}
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
                        data-testid={`money-recurrence-stop-${rule.id}`}
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

          <div className="px-4 pt-4 pb-1">
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {periodLabel} · {t("money.entries", { count: String(filtered.length) })}
            </p>
          </div>

          <div className="px-4 pb-8">
            {statement.failed ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                  {t("money.failed")}
                </p>
                <Button variant="outline" onClick={statement.retry} testId="money-statement-retry">
                  {t("common.retry")}
                </Button>
              </div>
            ) : statement.rows === null ? (
              <div className="flex flex-col gap-2">
                <Skeleton w="100%" h="56px" />
                <Skeleton w="100%" h="56px" />
                <Skeleton w="100%" h="56px" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={ArrowDownLeft}
                title={search.trim() || filter !== "all" ? t("money.emptyFiltered") : t("money.empty")}
              />
            ) : (
              <div className="flex flex-col gap-4">
                {groups.map(([date, rows]) => (
                  <div key={date} data-testid={`money-day-${date}`}>
                    <p className="text-10 font-semibold uppercase tracking-wide pb-1" style={{ color: "var(--text-tertiary)" }}>
                      {shortDate(date)}
                    </p>
                    <div
                      className="rounded-[var(--radius-card)] px-3"
                      style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
                    >
                      {rows.map((row, index) => {
                        const incoming = row.direction === "in";
                        const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
                        const recorded = row.source.startsWith("finance_");
                        const content = (
                          <>
                            <span
                              className="size-8 rounded-full flex items-center justify-center shrink-0"
                              style={{ background: "var(--tone-sunken)" }}
                            >
                              <Icon size={14} style={{ color: incoming ? "var(--success)" : "var(--error)" }} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-12 font-semibold truncate">{sourceLabel(row.source)}</p>
                              <p className="text-10 truncate" style={{ color: "var(--text-secondary)" }}>
                                {[
                                  row.party,
                                  row.source.startsWith("finance_") ? codeLabel(row.reference, CATEGORY_KEY) : row.reference,
                                  methodLabel(row.method),
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </p>
                              {row.note && (
                                <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>
                                  {row.note}
                                </p>
                              )}
                            </div>
                            <span className="flex items-center gap-1.5 shrink-0">
                              <p
                                className="text-12 font-bold tabular-nums"
                                style={{ color: incoming ? "var(--brand-dark)" : "var(--text-primary)" }}
                              >
                                {signed(row)}
                              </p>
                              {recorded && (
                                <Pencil size={12} style={{ color: "var(--text-tertiary)" }} aria-hidden />
                              )}
                            </span>
                          </>
                        );
                        const shared = {
                          className: "w-full flex items-center gap-3 py-2.5 text-start",
                          style: { borderTop: index === 0 ? "none" : "1px solid var(--divider)" },
                          "data-testid": `money-movement-${row.id}`,
                        } as const;
                        return recorded ? (
                          <button
                            key={row.id}
                            type="button"
                            onClick={() => setOpenEntryId(row.refId)}
                            aria-label={t("finance.detail.edit")}
                            {...shared}
                          >
                            {content}
                          </button>
                        ) : (
                          <div key={row.id} {...shared}>
                            {content}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <BalanceDateSheet
        open={periodOpen}
        onClose={() => setPeriodOpen(false)}
        title={t("period.sheetTitle")}
        value={period}
        from={window.from}
        to={window.to}
        max={day}
        onChange={(key, from, to) => {
          setPeriod(key);
          setCustom({ from, to });
        }}
        testIdPrefix="money-statement-period-sheet"
      />

      <FinanceEntrySheet
        entryId={openEntryId}
        open={Boolean(openEntryId)}
        onClose={() => setOpenEntryId(null)}
        onChanged={() => {
          statement.retry();
          totals.retry();
          recurrences.retry();
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
