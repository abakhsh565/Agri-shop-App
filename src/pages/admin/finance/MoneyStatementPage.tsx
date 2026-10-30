import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Download,
  Share2,
  X,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import PeriodTabs from "@/components/ui/PeriodTabs";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import SearchBar from "@/components/ui/SearchBar";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { hasPermission } from "@/lib/tenantContext";
import {
  MONEY_SOURCE_KEY,
  useMoneyStatement,
  useMoneyTotals,
  type MoneyMovement,
} from "@/lib/financeMoney";
import { CATEGORY_KEY, METHOD_KEY, monthWindow } from "@/lib/financeEntries";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";

/**
 * The money statement: every movement of money in this branch, in one read-only list (0262).
 *
 * WHY IT IS SEPARATE FROM THE FINANCE HUB. The hub answers "what did the business earn" — net
 * sales, cost of goods, recorded expenses. This answers "what money actually moved": the paid
 * part of a sale, a customer settling credit, a refund, a supplier payment, rent, a drawing. They
 * are different questions, and printing one under the other's name is how a ledger starts lying.
 * The screen says so under its own figures rather than leaving the reader to assume.
 *
 * WHY IT DOES NOT WRITE. A movement belongs to the ledger that owns it: a sale is corrected on the
 * sale, a supplier payment in the payments book, an expense in the recorded-money form. A second
 * writer here would create two versions of the same fact that could disagree. The screen is a read
 * and says "read-only" in words.
 *
 * EVERY ROW IS A MOVEMENT, NOT A BALANCE. A credit sale's unpaid part appears nowhere here until
 * it is paid, a purchase on credit moves nothing until its advance or payment does, and a voided
 * sale never happened. The SQL decides that once; this file does not re-decide it.
 *
 * THE LIST AND THE FIGURES READ THE SAME WINDOW. The totals come from `get_money_totals`, which
 * aggregates the same statement rows, so the three numbers on top cannot describe a different set
 * of movements from the list under them. The search narrows what the reader sees and what the
 * export contains; it never changes the totals, which describe the period.
 */

export default function MoneyStatementPage() {
  const t = useT();
  const base = useShellBase();
  const language = useThemeStore((s) => s.language);
  const { addToast } = useUIStore();

  const day = pkToday();
  const thisMonth = useMemo(() => monthWindow(day), [day]);
  const [period, setPeriod] = useState<"month" | "previous">("month");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [search, setSearch] = useState("");

  const window = custom ?? (period === "month" ? thisMonth : { from: thisMonth.prevFrom, to: thisMonth.prevTo });

  const statement = useMoneyStatement(window.from, window.to);
  const totals = useMoneyTotals(window.from, window.to);

  const canRead = hasPermission("payments.view");

  const sourceLabel = (source: MoneyMovement["source"]) => t(MONEY_SOURCE_KEY[source]);
  // A movement stores its category and method as codes; the screen prints the words the rest of
  // the app uses for them, so a receipt does not read "other_income · bank" beside a translated
  // source name. Unknown codes pass through rather than disappearing.
  const codeLabel = (value: string | null, map: Readonly<Partial<Record<string, string>>>) => {
    if (!value) return "";
    const key = map[value];
    return key ? t(key as I18nKey) : value;
  };

  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(language === "ur" ? "ur-PK" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  const money = (value: number | null | undefined) =>
    value == null ? "—" : formatCurrency(value);

  /**
   * The list, narrowed by one search box.
   *
   * The haystack is what a row PRINTS plus what it stores: a movement can be found by the
   * customer's name, the sale number, the method, the note, the figure or the day. Searching the
   * translated source name means typing "واپسی" finds a refund in Urdu.
   */
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return statement.rows ?? [];
    return (statement.rows ?? []).filter((row) =>
      [
        sourceLabel(row.source),
        row.source,
        row.party ?? "",
        row.reference ?? "",
        row.note ?? "",
        row.method ?? "",
        codeLabel(row.method, METHOD_KEY),
        codeLabel(row.reference, CATEGORY_KEY),
        row.occurredOn,
        shortDate(row.occurredOn),
        String(row.amount),
        formatCurrency(row.amount),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
    // The label helpers close over `t` and `language`, both of which change the words searched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement.rows, search, language]);

  /** The visible list, grouped by the day the money moved. */
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
        { label: t("money.method"), value: (row: MoneyMovement) => row.method ?? "" },
        { label: t("money.note"), value: (row: MoneyMovement) => row.note ?? "" },
        { label: t("finance.amount"), value: (row: MoneyMovement) => row.direction === "in" ? row.amount : -row.amount },
      ],
      filtered,
    );
    try {
      const outcome = await exportCsv(csvFileName("money-statement"), csv, t("money.title"));
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

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="money-statement-page"
    >
      <StatusBar />
      <NavHeader
        title={t("money.title")}
        backTo={`${base}/settings/hub/finance`}
        right={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRangeOpen(true)}
              aria-label={t("money.choosePeriod")}
              data-testid="money-statement-calendar"
              className="flex items-center justify-center size-11 rounded-full active:opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              <CalendarDays size={18} />
            </button>
            <button
              type="button"
              onClick={share}
              aria-label={t("money.share")}
              data-testid="money-statement-share"
              className="flex items-center justify-center size-11 rounded-full active:opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              <Share2 size={18} />
            </button>
            <button
              type="button"
              onClick={download}
              aria-label={t("money.export")}
              data-testid="money-statement-download"
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
            { key: "month", label: t("money.thisMonth") },
            { key: "previous", label: t("money.lastMonth") },
          ]}
          value={custom ? null : period}
          onChange={(key) => {
            setCustom(null);
            setPeriod(key);
          }}
          label={t("money.period")}
          filterLabel={t("money.period")}
          testIdPrefix="money-statement-period"
        />
      </div>

      {custom && (
        <div className="px-4 pt-2 flex items-center gap-2">
          <span
            className="text-11 px-3 py-1.5 rounded-full min-w-0 truncate"
            style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
            data-testid="money-statement-range"
          >
            {t("money.customRange", { from: shortDate(custom.from), to: shortDate(custom.to) })}
          </span>
          <button
            type="button"
            onClick={() => setCustom(null)}
            aria-label={t("common.clear")}
            data-testid="money-statement-range-clear"
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
          {/* The three figures, then the sentence that keeps them from being read as profit. */}
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
              <p className="text-10 mt-3" style={{ color: "var(--text-tertiary)" }}>
                {t("money.rule")}
              </p>
            </div>
          </div>

          <p className="px-4 pt-3 text-11" style={{ color: "var(--text-secondary)" }}>
            {t("money.readOnly")}
          </p>

          <div className="px-4 pt-3">
            <SearchBar
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch("")}
              placeholder={t("money.search")}
              data-testid="money-statement-search"
            />
          </div>

          <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1">
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {t("money.entries", { count: String(filtered.length) })}
            </p>
            <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
              {t("money.subtitle")}
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
                title={search.trim() ? t("money.emptyFiltered") : t("money.empty")}
                subtitle={t("money.emptyHint")}
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
                        return (
                          <div
                            key={row.id}
                            className="flex items-center gap-3 py-2.5"
                            style={{ borderTop: index === 0 ? "none" : "1px solid var(--divider)" }}
                            data-testid={`money-movement-${row.id}`}
                          >
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
                                  codeLabel(row.reference, CATEGORY_KEY),
                                  codeLabel(row.method, METHOD_KEY),
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
                            <p
                              className="text-12 font-bold tabular-nums shrink-0"
                              style={{ color: incoming ? "var(--brand-dark)" : "var(--text-primary)" }}
                            >
                              {signed(row)}
                            </p>
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
    </div>
  );
}
