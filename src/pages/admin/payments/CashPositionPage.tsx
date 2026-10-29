import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, ReceiptText, Wallet } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/credit/CreditListScreen";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useSalesStore } from "@/stores/salesStore";
import { useShopStore } from "@/stores/shopStore";
import { loadPaymentLedger, type LedgerPayment } from "@/lib/paymentLedger";
import { useBranchCash } from "@/lib/branchReports";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { pkDateFromISO, pkToday } from "@/lib/pkDate";
import { cashTakenInMonth, movementsInMonth } from "@/lib/financeSummary";

/**
 * The cash screen behind the Finance hub's "Cash position" row.
 *
 * SHAPE (owner's reference, 2026-10-29): the same grammar as the supplier payable screen — the
 * screen's own name and one line of purpose, a summary card holding the figure with the two
 * directions under it, three counts, a search and the direction chips, then the movements as
 * cards. The two screens sit side by side in the same section, so they are read the same way.
 *
 * EVERY FIGURE HAS ONE DEFINITION, SHARED WITH THE HUB:
 *   - Recorded cash is `cashTakenInMonth` (money taken on this month's sales), the same function
 *     the hub prints, so the two screens cannot disagree about the same words.
 *   - Money received and money paid are the two sides of the payments ledger
 *     (`movementsInMonth`) — never netted, because they are two different flows.
 *   - The three counts count the rows below them, so a tile cannot promise more than the list
 *     holds.
 *
 * WHY THE SUMMARY MOVEMENTS ARE ONE BRANCH, AND THE SPLIT IS NOT. The payments ledger below is
 * read one branch at a time: the database scopes those rows to the branch the session is working
 * in. So the received/paid figures under the total describe this branch and say so in the
 * subtitle. The per-branch split is therefore read from the database (`get_branch_cash`), not
 * derived from the rows on this screen — a client-side grouping of one branch's rows would draw
 * one branch and call it the business. A figure that could not be read is "—", never zero.
 */
type Direction = "all" | "in" | "out";

export default function CashPositionPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const sales = useSalesStore((s) => s.sales);
  const salesReady = useSalesStore((s) => s.ready);
  const loadSales = useSalesStore((s) => s.load);
  const branch = useShopStore((s) => s.activeBranchName);

  const [entries, setEntries] = useState<LedgerPayment[] | null>(null);
  const [ledgerFailed, setLedgerFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<Direction>("all");

  useEffect(() => {
    if (!salesReady) void loadSales();
  }, [salesReady, loadSales]);

  useEffect(() => {
    let live = true;
    loadPaymentLedger()
      .then((ledger) => {
        if (live) setEntries(ledger.entries);
      })
      .catch(() => {
        if (live) setLedgerFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const month = pkToday().substring(0, 7);
  const cash = useMemo(() => cashTakenInMonth(sales, month), [sales, month]);
  const monthEntries = useMemo(
    () => (entries ?? []).filter((entry) => pkDateFromISO(entry.createdAt).startsWith(month)),
    [entries, month],
  );
  const flows = useMemo(() => movementsInMonth(entries ?? [], month), [entries, month]);

  const counts = useMemo(
    () => ({
      all: monthEntries.length,
      in: monthEntries.filter((e) => e.direction === "in").length,
      out: monthEntries.filter((e) => e.direction === "out").length,
    }),
    [monthEntries],
  );

  // The same window, read per branch at the database. `last` is the month's last day, computed
  // from the month rather than "today", so the split does not shrink as the month runs on.
  const [year, monthNumber] = month.split("-").map(Number);
  const monthFrom = `${month}-01`;
  const monthTo = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const { rows: branchCash, failed: branchCashFailed } = useBranchCash(monthFrom, monthTo);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return monthEntries.filter((entry) => {
      if (direction === "in" && entry.direction !== "in") return false;
      if (direction === "out" && entry.direction !== "out") return false;
      if (term && !entry.counterparty.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [monthEntries, direction, search]);

  const filters: { key: Direction; label: string }[] = [
    { key: "all", label: t("cashPosition.filterAll") },
    { key: "in", label: t("cashPosition.received") },
    { key: "out", label: t("cashPosition.paid") },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="cash-position-page"
    >
      <StatusBar />
      <NavHeader title={t("cashPosition.title")} backTo={`${base}/settings/hub/finance`} />

      <div className="px-4 pt-2">
        <h1 className="text-22 font-bold">{t("financeHub.cashRecorded")}</h1>
        <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
          {t("cashPosition.subtitle")}
        </p>
        {/* Which branch this is, stated rather than drawn as a filter: the rows behind these
            figures are already read for this branch, so a chip offering "all branches" would be
            a control that cannot do what it says. */}
        <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>
          {t("creditList.scope", { branch: branch ?? t("hub.inventory.selectedBranch") })}
        </p>
      </div>

      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="cash-position-summary"
        >
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {t("cashPosition.thisMonth")}
          </p>
          {salesReady ? (
            <p
              className="text-22 font-bold mt-1 tabular-nums break-words"
              style={{ color: "var(--brand-dark)" }}
              data-testid="cash-position-total"
            >
              {formatCurrency(cash)}
            </p>
          ) : (
            <Skeleton w="140px" h="26px" className="mt-1" />
          )}
          <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>
            {t("financeHub.cashHint")}
          </p>

          {/* The two directions sit under the figure the way Paid and Total payable sit under the
              supplier screen's — same card, same pair, no bar: cash has no percentage of itself
              to draw, and a bar over two unrelated flows would measure nothing. */}
          <div className="flex items-end justify-between gap-3 mt-4">
            <div className="min-w-0">
              <p className="text-10 flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--success)" }} />
                {t("payments.moneyReceived")}
              </p>
              <p
                className="text-13 font-bold tabular-nums mt-0.5 break-words"
                style={{ color: flows.received > 0 ? "var(--success)" : "var(--text-primary)" }}
                data-testid="cash-position-received"
              >
                {entries ? formatCurrency(flows.received) : "—"}
              </p>
            </div>
            <div className="min-w-0 text-end">
              <p className="text-10 flex items-center gap-1.5 justify-end" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--error)" }} />
                {t("payments.moneyPaid")}
              </p>
              <p
                className="text-13 font-bold tabular-nums mt-0.5 break-words"
                style={{ color: flows.paid > 0 ? "var(--error)" : "var(--text-primary)" }}
                data-testid="cash-position-paid"
              >
                {entries ? formatCurrency(flows.paid) : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* The three counts behind the list below. Figures only — the chips under the search are
            the one control that changes the view. */}
        <div className="grid grid-cols-3 gap-2 mt-2">
          {entries ? (
            <>
              <StatTile
                testId="cash-position-tile-movements"
                label={t("cashPosition.movements")}
                value={counts.all}
                caption={t("cashPosition.thisMonth")}
              />
              <StatTile
                testId="cash-position-tile-received"
                label={t("cashPosition.received")}
                value={counts.in}
                caption={t("payments.moneyReceivedHint")}
                color={counts.in > 0 ? "var(--success)" : undefined}
              />
              <StatTile
                testId="cash-position-tile-paid"
                label={t("cashPosition.paid")}
                value={counts.out}
                caption={t("payments.moneyPaidHint")}
                color={counts.out > 0 ? "var(--error)" : undefined}
              />
            </>
          ) : (
            // Counts are not drawn until the rows they count are readable: three zeros would
            // claim a quiet month rather than an unanswered question.
            <>
              <Skeleton w="100%" h="72px" />
              <Skeleton w="100%" h="72px" />
              <Skeleton w="100%" h="72px" />
            </>
          )}
        </div>
      </div>

      {/* The per-branch split, read from the database for the same month. Its own section, not a
          chip on the list below: the list is this branch's movements, while this answers "where is
          the money" across every branch the account may read. */}
      <div className="px-4 pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-15 font-bold">{t("cashPosition.byBranch")}</p>
          <p className="text-11" style={{ color: "var(--text-tertiary)" }}>
            {t("cashPosition.thisMonth")}
          </p>
        </div>
        <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
          {t("cashPosition.byBranchHint")}
        </p>

        {branchCashFailed ? (
          <p className="text-11 pt-2" style={{ color: "var(--text-tertiary)" }}>
            {t("cashPosition.branchCashFailed")}
          </p>
        ) : branchCash === null ? (
          <div className="mt-2">
            <SkeletonList rows={2} tile />
          </div>
        ) : (
          <div className="flex flex-col gap-2 mt-2">
            {branchCash.map((row) => (
              <div
                key={row.branchId}
                className="rounded-[var(--radius-card)] p-3.5"
                style={{ background: "var(--tone-card)" }}
                data-testid={`cash-position-branch-${row.branchId}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-14 font-bold truncate">{row.branchName}</p>
                    {row.isCurrent && (
                      <span
                        className="inline-block text-10 font-bold px-2 py-0.5 rounded-full mt-1"
                        style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                      >
                        {t("reports.thisBranch")}
                      </span>
                    )}
                  </div>
                  <div className="text-end shrink-0">
                    <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                      {t("cashPosition.taken")}
                    </p>
                    <p
                      className="text-14 font-bold tabular-nums mt-0.5"
                      style={{ color: row.cashTaken ? "var(--brand-dark)" : "var(--text-secondary)" }}
                    >
                      {row.cashTaken == null ? t("cashPosition.branchCashUnknown") : formatCurrency(row.cashTaken)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 mt-2">
                  <p className="text-11 truncate" style={{ color: "var(--text-secondary)" }}>
                    <span className="inline-block size-1.5 rounded-full me-1.5 align-middle" style={{ background: "var(--success)" }} />
                    {t("payments.moneyReceived")}{" "}
                    <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {row.received == null ? t("cashPosition.branchCashUnknown") : formatCurrency(row.received)}
                    </span>
                  </p>
                  <p className="text-11 truncate text-end" style={{ color: "var(--text-secondary)" }}>
                    <span className="inline-block size-1.5 rounded-full me-1.5 align-middle" style={{ background: "var(--error)" }} />
                    {t("payments.moneyPaid")}{" "}
                    <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {row.paid == null ? t("cashPosition.branchCashUnknown") : formatCurrency(row.paid)}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pt-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("cashPosition.search")}
        />
      </div>

      <div className="flex gap-2 px-4 pt-3 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setDirection(f.key)}
            aria-pressed={direction === f.key}
            data-testid={`cash-position-filter-${f.key}`}
            className="h-8 px-3.5 rounded-full text-12 font-semibold transition-colors"
            style={
              direction === f.key
                ? { background: "var(--brand)", color: "#0a0a0a" }
                : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {!entries ? (
        ledgerFailed ? (
          <p className="px-4 pt-6 text-12" style={{ color: "var(--text-secondary)" }}>
            {t("cashPosition.loadFailed")}
          </p>
        ) : (
          <SkeletonList rows={4} tile />
        )
      ) : rows.length === 0 ? (
        <div className="px-4 pt-10 flex flex-col items-center gap-2">
          <ReceiptText size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
            {search.trim() || direction !== "all"
              ? t("cashPosition.empty")
              : t("cashPosition.noRecent")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pt-3 pb-8">
          {rows.map((entry) => {
            const incoming = entry.direction === "in";
            return (
              <div
                key={entry.id}
                className="rounded-[var(--radius-card)] p-3.5"
                style={{ background: "var(--tone-card)" }}
                data-testid={`cash-position-row-${entry.id}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="size-10 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                  >
                    {incoming
                      ? <ArrowDownLeft size={16} style={{ color: "var(--success)" }} />
                      : <ArrowUpRight size={16} style={{ color: "var(--error)" }} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-14 font-bold truncate">{entry.counterparty || "—"}</p>
                    <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {incoming ? t("payments.customerPayment") : t("payments.supplierPayment")}
                    </p>
                  </div>
                  <p
                    className="text-13 font-bold tabular-nums shrink-0"
                    style={{ color: incoming ? "var(--success)" : "var(--error)" }}
                  >
                    {incoming ? "+" : "−"} {formatCurrency(entry.amount)}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 mt-2">
                  <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>
                    {formatSmartDateTime(entry.createdAt, undefined, t)}
                  </p>
                  <span
                    className="text-10 font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      color: incoming ? "var(--success)" : "var(--error)",
                      background: "var(--surface-2)",
                    }}
                  >
                    {incoming ? t("cashPosition.received") : t("cashPosition.paid")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Counting the till is a different job from reading this screen, so it keeps its own
          screen and is reached from here rather than replacing this figure with a form. */}
      <div className="px-4 mt-1 pb-8">
        <button
          type="button"
          onClick={() => navigate(`${base}/payments/daily-cash`)}
          className="flex items-center gap-2 text-12 font-semibold active:opacity-70"
          style={{ color: "var(--brand-dark)" }}
          data-testid="cash-position-daily-check"
        >
          <Wallet size={14} />
          {t("cashPosition.dailyCheck")}
        </button>
      </div>
    </div>
  );
}
