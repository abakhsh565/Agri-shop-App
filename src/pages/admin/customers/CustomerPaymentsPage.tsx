import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownLeft, CalendarDays, ChevronRight, ReceiptText } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCustomersStore } from "@/stores/customersStore";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { loadPaymentLedger, type PaymentLedger } from "@/lib/paymentLedger";
import BalanceDateSheet, { type BalancePeriod } from "@/components/ui/BalanceDateSheet";
import { pkToday } from "@/lib/pkDate";
import { summariseCustomerCollection } from "@/lib/customerCredit";

/**
 * Customer payments — the receipt book behind the Customers & Credit hub.
 *
 * WHY IT EXISTS (owner, 2026-10-30). The hub's "Customer payments" row opened the general
 * Payments ledger, which states both directions and carries supplier money besides. A reader who
 * came from the customer book was handed a screen about the whole business, and its Back arrow
 * belonged to the Finance journey. This screen is that row's own page: what came back from
 * customers, what they still owe, and the receipts themselves — nothing else.
 *
 * SHAPE. The same grammar as the ledger it replaces, so the two screens read as one family: two
 * figures stated once, a search, the window chip, then the recorded transactions. No direction
 * chips: every row here is money coming back in.
 *
 * THE TWO FIGURES ARE DIFFERENT KINDS OF FACT and are labelled as such. Received is the sum of
 * the receipts in the chosen window; pending is the branch's outstanding balance today, which no
 * date window can change. Printing them side by side without that distinction would let a reader
 * believe the window applied to both.
 */
export default function CustomerPaymentsPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);
  const loadCustomers = useCustomersStore((s) => s.load);

  const [ledger, setLedger] = useState<PaymentLedger | null>(null);
  const [search, setSearch] = useState("");

  // `all` is the default: this is a book of receipts, and a reader who never opens the calendar
  // sees every payment the branch has taken.
  const [period, setPeriod] = useState<BalancePeriod>("all");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const todayISO = pkToday();
  // Six days back, not seven: "this week" is the seven days that end today — the same window the
  // other books use, so the chip cannot mean two different sets of days in one app.
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

  // What customers still owe, taken from the same summary the hub plate prints — so the two
  // screens can never disagree about the same figure.
  const pending = useMemo(
    () => summariseCustomerCollection(customers, todayISO).due,
    [customers, todayISO],
  );

  const methodLabel = (method: string) =>
    method === "cash"
      ? t("sale.cash")
      : method === "bank_transfer"
        ? t("sale.bankTransfer")
        : method;

  // Receipts from customers only. The ledger also carries supplier money; a row without a
  // customer is not a customer payment and has no place in this book.
  const receipts = useMemo(
    () => (ledger
      ? ledger.entries.filter((entry) => entry.direction === "in" && Boolean(entry.customerId))
      : []),
    [ledger],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return receipts.filter((entry) => {
      if (term) {
        const haystack = `${entry.counterparty} ${entry.note ?? ""} ${entry.method}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      // The clock the row is dated on, not the shop's: a receipt taken at 23:59 belongs to the
      // day it names, whatever timezone the reader's phone is in.
      if (period !== "all") {
        const day = entry.createdAt.slice(0, 10);
        if (day < windowFrom || day > windowTo) return false;
      }
      return true;
    });
  }, [receipts, search, period, windowFrom, windowTo]);

  const received = filtered.reduce((sum, entry) => sum + entry.amount, 0);
  const readCustomers = ledger?.readable.customers ?? false;

  // Two facts, stated plainly: what customers have paid and what they still owe. No caption
  // under either figure — the label and the amount are the whole card.
  const figure = (label: string, value: string, color: string) => (
    <div
      className="min-w-0 rounded-[var(--radius-card)] p-4"
      style={{ background: "var(--surface)" }}
    >
      <p className="text-11" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <p
        className="text-18 font-bold mt-1 tabular-nums break-words"
        style={{ color }}
      >
        {value}
      </p>
    </div>
  );

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="customer-payments-page"
    >
      <StatusBar />
      {/* Back belongs to the customer book, which is the screen that opened it. The journey stack
          still wins when the reader arrived from somewhere else. */}
      <NavHeader title={t("hub.customers.payments")} backTo={`${base}/settings/hub/customers`} historyBack />

      <div className="grid grid-cols-2 gap-2 px-4 pt-3">
        {figure(
          t("payments.moneyReceived"),
          !ledger ? "—" : readCustomers ? formatCurrency(received) : "—",
          readCustomers && received > 0 ? "var(--success)" : "var(--text-secondary)",
        )}
        {figure(
          t("customerPayments.pending"),
          customersReady ? formatCurrency(pending) : "—",
          pending > 0 ? "var(--warning)" : "var(--text-secondary)",
        )}
      </div>

      <div className="px-4 pt-4">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("customerPayments.search")}
        />
      </div>

      {/* One window control, on its own row: with no direction to choose, a chip pinned to the
          far edge would read as an action rather than the filter it is. */}
      <div className="flex items-center gap-2 px-4 pt-3">
        <button
          type="button"
          onClick={() => setPeriodOpen(true)}
          aria-haspopup="dialog"
          aria-label={t("period.sheetTitle")}
          data-testid="customer-payments-period"
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
        testIdPrefix="customer-payments-period"
      />

      <div className="flex items-baseline justify-between gap-3 px-4 pt-5 pb-2">
        <p className="text-15 font-bold">{t("payments.recorded")}</p>
        <p className="text-12 tabular-nums" style={{ color: "var(--text-secondary)" }}>
          {ledger ? filtered.length : "—"}
        </p>
      </div>

      {!ledger ? (
        <SkeletonList rows={4} tile />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 gap-2">
          <ReceiptText size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-14 font-semibold text-center" style={{ color: "var(--text-primary)" }}>
            {search.trim() || period !== "all"
              ? t("payments.noTransactionsInPeriod")
              : t("payments.noTransactions")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pt-1 pb-8">
          {filtered.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                if (entry.customerId) navigate(`${base}/customers/${entry.customerId}`);
              }}
              className="w-full text-start rounded-[var(--radius-card)] p-3.5 active:opacity-80"
              style={{ background: "var(--tone-card)" }}
              data-testid={`customer-payment-row-${entry.id}`}
            >
              <span className="flex items-start gap-3">
                <span
                  className="size-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "var(--tone-sunken)" }}
                >
                  <ArrowDownLeft size={16} style={{ color: "var(--success)" }} />
                </span>
                <span className="min-w-0 flex-1 block">
                  <span className="block text-14 font-bold truncate">
                    {entry.counterparty || "—"}
                  </span>
                  <span
                    className="block text-11 mt-0.5 truncate"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {methodLabel(entry.method)}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <span
                    className="text-13 font-bold tabular-nums"
                    style={{ color: "var(--success)" }}
                  >
                    + {formatCurrency(entry.amount)}
                  </span>
                  <ChevronRight size={14} style={{ color: "var(--text-tertiary)" }} />
                </span>
              </span>

              <span className="block text-10 mt-2 truncate" style={{ color: "var(--text-tertiary)" }}>
                {formatSmartDateTime(entry.createdAt, undefined, t)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
