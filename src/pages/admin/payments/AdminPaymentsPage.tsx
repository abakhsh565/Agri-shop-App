import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronRight, Plus, ReceiptText } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import Sheet from "@/components/ui/Sheet";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCustomersStore } from "@/stores/customersStore";
import { hasPermission } from "@/lib/tenantContext";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { loadPaymentLedger, type PaymentLedger } from "@/lib/paymentLedger";
import BalanceDateSheet, { type BalancePeriod } from "@/components/ui/BalanceDateSheet";
import { pkToday } from "@/lib/pkDate";

type Direction = "all" | "in" | "out";

/**
 * Financial transactions: what came in, what went out, and every recorded movement between them.
 *
 * SHAPE (owner's reference, 2026-10-29): the same grammar as Cash position, because both screens
 * sit in the Finance section and are read as one family — the screen's own name and one line of
 * purpose, the two directions stated once, a search and the direction chips, then the movements
 * as cards. The chips and the search narrow the list; they are not another way of stating the
 * balances.
 *
 * WHAT THIS SCREEN IS NOT. It used to list the customers who still owed and the suppliers still
 * to be paid, which is a list of BALANCES, not of payments: the screen named "Payments" opened
 * with no payment on it. Those balances keep their own screens (Outstanding Credit, the supplier
 * ledger); this one answers "what money moved, and when".
 *
 * A direction that could not be read prints "—", never 0: supplier payments sit behind a
 * narrower policy than customer payments, so "no row" and "not allowed to look" must not read
 * the same. `lib/paymentLedger` returns both the rows and what was readable.
 *
 * The rows are the ledger's own scope, which is the branch the session is working in.
 *
 * RECORDING A PAYMENT STARTS HERE (owner, 2026-10-30). Money coming back is the reason an owner
 * opens this screen, and it used to be reachable only from a customer's row on another screen.
 * The action opens a customer picker; choosing one lands on that customer's payment form, so the
 * reader never has to know the route. The in-page heading, subtitle and branch line are gone:
 * the app bar already says "Financial transactions", and the screen was repeating itself.
 */
export default function AdminPaymentsPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);
  const loadCustomers = useCustomersStore((s) => s.load);
  const canRecordPayment = hasPermission("customers.payments");
  const [ledger, setLedger] = useState<PaymentLedger | null>(null);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<Direction>("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");

  // The window the ledger is read over. `all` is the default: the screen is a timeline, and a
  // reader who never opens the calendar sees every movement the branch has.
  const [period, setPeriod] = useState<BalancePeriod>("all");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const todayISO = pkToday();
  // Six days back, not seven: "this week" is the seven days that end today — the same window the
  // other books use, so "This week" cannot mean two different sets of days in one app.
  const weekStart = useMemo(() => {
    const d = new Date(`${todayISO}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  }, [todayISO]);
  const windowFrom =
    period === "custom" ? customFrom || todayISO
    : period === "today" ? todayISO
    : period === "week" ? weekStart
    : period === "month" ? `${todayISO.slice(0, 7)}-01`
    : `${todayISO.slice(0, 4)}-01-01`;
  const windowTo = period === "custom" ? customTo || todayISO : todayISO;

  useEffect(() => {
    let live = true;
    loadPaymentLedger().then((next) => {
      if (live) setLedger(next);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!customersReady) void loadCustomers();
  }, [customersReady, loadCustomers]);

  /** Whoever owes first: that is the payment a counter is most likely taking. */
  const pickableCustomers = useMemo(() => {
    const term = customerQuery.trim().toLowerCase();
    return customers
      .filter((c) => !term || c.name.toLowerCase().includes(term) || c.phone.includes(term))
      .sort((a, b) => b.outstandingBalance - a.outstandingBalance);
  }, [customers, customerQuery]);

  const filtered = useMemo(() => {
    if (!ledger) return [];
    const term = search.trim().toLowerCase();
    return ledger.entries.filter((entry) => {
      if (direction === "in" && entry.direction !== "in") return false;
      if (direction === "out" && entry.direction !== "out") return false;
      if (term && !entry.counterparty.toLowerCase().includes(term)) return false;
      // The clock the row is dated on, not the shop's: a payment recorded at 23:59 belongs to the
      // day it names, whatever timezone the reader's phone is in.
      if (period !== "all") {
        const day = entry.createdAt.slice(0, 10);
        if (day < windowFrom || day > windowTo) return false;
      }
      return true;
    });
  }, [ledger, direction, search, period, windowFrom, windowTo]);

  const received = filtered
    .filter((e) => e.direction === "in")
    .reduce((sum, e) => sum + e.amount, 0);
  const paid = filtered
    .filter((e) => e.direction === "out")
    .reduce((sum, e) => sum + e.amount, 0);

  const methodLabel = (method: string) =>
    method === "cash"
      ? t("sale.cash")
      : method === "bank_transfer"
        ? t("sale.bankTransfer")
        : method;

  const filters: { key: Direction; label: string }[] = [
    { key: "all", label: t("cashPosition.filterAll") },
    { key: "in", label: t("cashPosition.received") },
    { key: "out", label: t("cashPosition.paid") },
  ];

  const figure = (
    label: string,
    hint: string,
    amount: number,
    read: boolean,
    color: string,
  ) => (
    <div
      className="min-w-0 rounded-[var(--radius-card)] p-4"
      style={{ background: "var(--surface)" }}
    >
      <p className="text-10" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <p
        className="text-16 font-bold mt-1 tabular-nums break-words"
        style={{ color: read && amount > 0 ? color : "var(--text-secondary)" }}
      >
        {/* A zero is neither received nor paid — it is the absence of a direction, so it takes
            the neutral colour instead of claiming a green gain or a red loss. */}
        {!ledger ? "—" : read ? formatCurrency(amount) : "—"}
      </p>
      <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>{hint}</p>
    </div>
  );

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="payments-ledger-page"
    >
      <StatusBar />
      <NavHeader title={t("hub.finance.transactions")} backTo={`${base}/settings/hub/finance`} />

      <div className="grid grid-cols-2 gap-2 px-4 pt-3">
        {figure(
          t("payments.moneyReceived"),
          t("payments.moneyReceivedHint"),
          received,
          ledger?.readable.customers ?? false,
          "var(--success)",
        )}
        {figure(
          t("payments.moneyPaid"),
          t("payments.moneyPaidHint"),
          paid,
          ledger?.readable.suppliers ?? false,
          "var(--error)",
        )}
      </div>

      {ledger && (!ledger.readable.customers || !ledger.readable.suppliers) && (
        <p className="px-4 pt-2 text-10" style={{ color: "var(--text-tertiary)" }}>
          {t("payments.partialRead")}
        </p>
      )}

      <div className="px-4 pt-4">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("payments.search")}
        />
      </div>

      {/* The direction and the window are the same kind of control — a choice that narrows the
          list — so they share one row, and the calendar sits at its end where the eye looks for
          "what am I looking at". The month strip that used to sit here is gone: one window, named
          on the chip, instead of twelve tabs and the window repeated above them. */}
      <div className="flex items-center gap-2 px-4 pt-3">
        <div className="flex gap-2 flex-1 min-w-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setDirection(f.key)}
              aria-pressed={direction === f.key}
              data-testid={`payments-filter-${f.key}`}
              className="shrink-0 h-8 px-3.5 rounded-full text-12 font-semibold transition-colors"
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
        <button
          type="button"
          onClick={() => setPeriodOpen(true)}
          aria-haspopup="dialog"
          aria-label={t("period.sheetTitle")}
          data-testid="payments-period"
          className="flex items-center gap-1.5 shrink-0 h-8 px-3 rounded-full text-11 font-semibold active:opacity-60"
          style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
        >
          <CalendarDays size={13} />
          {period === "all" ? t("period.allDates")
            : period === "today" ? t("period.today")
            : period === "week" ? t("period.week")
            : period === "month" ? t("period.month")
            : period === "year" ? t("period.year")
            : `${customFrom.slice(5)} – ${customTo.slice(5)}`}
        </button>
      </div>

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
        testIdPrefix="payments-period"
      />

      {/* The screen's one action, as text: taking a payment is a job this ledger can start,
          not the reason it exists. */}
      {canRecordPayment && (
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            data-testid="payments-record"
            className="min-h-11 flex items-center gap-1.5 text-13 font-semibold active:opacity-60"
            style={{ color: "var(--brand-dark)" }}
          >
            <Plus size={15} />
            {t("customers.recordPayment")}
          </button>
        </div>
      )}

      <div className="flex items-baseline justify-between gap-3 px-4 pt-5 pb-2">
        <p className="text-15 font-bold">{t("payments.recorded")}</p>
        <p className="text-12 tabular-nums" style={{ color: "var(--text-secondary)" }}>
          {ledger ? filtered.length : "—"}
        </p>
      </div>

      <Sheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t("customers.recordPayment")}
        closeButton
      >
        <div className="px-4 pb-2">
          <SearchBar
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            onClear={() => setCustomerQuery("")}
            placeholder={t("customers.search")}
          />
        </div>
        {pickableCustomers.length === 0 ? (
          <p className="px-4 pt-4 text-12" style={{ color: "var(--text-secondary)" }}>
            {t("outstanding.emptyFilter")}
          </p>
        ) : (
          <div className="pb-4">
            {pickableCustomers.map((c) => (
              <ListRow
                key={c.id}
                testId={`payment-customer-${c.id}`}
                title={c.name}
                description={c.phone}
                trailing={
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="text-13 font-bold tabular-nums">
                      {formatCurrency(c.outstandingBalance)}
                    </span>
                    <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                  </span>
                }
                onClick={() => {
                  setPickerOpen(false);
                  setCustomerQuery("");
                  navigate(`${base}/customers/${c.id}/record-payment`);
                }}
              />
            ))}
          </div>
        )}
      </Sheet>

      {!ledger ? (
        <SkeletonList rows={4} tile />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 gap-2">
          <ReceiptText size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-14 font-semibold text-center" style={{ color: "var(--text-primary)" }}>
            {search.trim() || direction !== "all"
              ? t("payments.noTransactionsInPeriod")
              : t("payments.noTransactions")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pt-1 pb-8">
          {filtered.map((entry) => {
            const incoming = entry.direction === "in";
            return (
              <div
                key={entry.id}
                className="rounded-[var(--radius-card)] p-3.5"
                style={{ background: "var(--tone-card)" }}
                data-testid={`payment-row-${entry.id}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="size-10 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--tone-sunken)" }}
                  >
                    {incoming
                      ? <ArrowDownLeft size={16} style={{ color: "var(--success)" }} />
                      : <ArrowUpRight size={16} style={{ color: "var(--error)" }} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-14 font-bold truncate">{entry.counterparty || "—"}</p>
                    <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {incoming ? t("payments.customerPayment") : t("payments.supplierPayment")}
                      {" · "}
                      {methodLabel(entry.method)}
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
    </div>
  );
}
