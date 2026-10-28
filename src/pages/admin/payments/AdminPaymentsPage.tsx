import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ReceiptText } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useShopStore } from "@/stores/shopStore";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { loadPaymentLedger, type PaymentLedger } from "@/lib/paymentLedger";

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
 * The rows are the ledger's own scope, which is the branch the session is working in; the
 * subtitle names that branch rather than offering a branch control that cannot widen the read.
 */
export default function AdminPaymentsPage() {
  const t = useT();
  const base = useShellBase();
  const branch = useShopStore((s) => s.activeBranchName);
  const [ledger, setLedger] = useState<PaymentLedger | null>(null);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<Direction>("all");

  useEffect(() => {
    let live = true;
    loadPaymentLedger().then((next) => {
      if (live) setLedger(next);
    });
    return () => { live = false; };
  }, []);

  const filtered = useMemo(() => {
    if (!ledger) return [];
    const term = search.trim().toLowerCase();
    return ledger.entries.filter((entry) => {
      if (direction === "in" && entry.direction !== "in") return false;
      if (direction === "out" && entry.direction !== "out") return false;
      if (term && !entry.counterparty.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [ledger, direction, search]);

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

      <div className="px-4 pt-2">
        <h1 className="text-22 font-bold">{t("hub.finance.transactions")}</h1>
        <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
          {t("payments.subtitle")}
        </p>
        <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>
          {t("creditList.scope", { branch: branch ?? t("hub.inventory.selectedBranch") })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 pt-4">
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

      <div className="flex gap-2 px-4 pt-3 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setDirection(f.key)}
            aria-pressed={direction === f.key}
            data-testid={`payments-filter-${f.key}`}
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
