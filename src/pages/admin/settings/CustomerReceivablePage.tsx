import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Plus, UserRound } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { SkeletonList } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/credit/CreditListScreen";
import { useCustomersStore } from "@/stores/customersStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { hasPermission } from "@/lib/tenantContext";
import { formatCurrency } from "@/lib/formatters";
import { isCreditOverdue } from "@/lib/signalEngine";
import { pkToday } from "@/lib/pkDate";

/**
 * Customer collection — the screen behind the overview's "Customer receivable" card.
 *
 * WHY IT IS ITS OWN SCREEN. The Customers list answers "who buys from me": every account, cash
 * or credit, and the way in to each one's profile. This answers the narrower question the card
 * asks — of the money this branch has billed, how much has come back, and who is still holding
 * what. Opening the ordinary customer list from that card sent the reader to a different screen
 * with a different top figure, so the number they had just tapped was nowhere to be seen.
 *
 * EVERY FIGURE IS THE BRANCH'S OWN. The rows are the customers the store already loaded, and
 * each carries the branch-scoped money the database derives (0242): billed, collected, still
 * owed. The summary is the sum of the very rows below it, so the total can never disagree with
 * the list, and "overdue" is the S1 rule (`isCreditOverdue`) that Reminders and Home use.
 */
/**
 * This screen is the credit book, not the customer list: only accounts that have taken credit
 * appear, so "all customers" is not one of its views (owner's correction, 2026-10-28).
 */
type Filter = "credit" | "pending" | "overdue";

export default function CustomerReceivablePage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const customers = useCustomersStore((s) => s.customers);
  const ready = useCustomersStore((s) => s.ready);
  const load = useCustomersStore((s) => s.load);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("credit");

  useEffect(() => { if (!ready) void load(); }, [ready, load]);

  const todayISO = pkToday();

  const summary = useMemo(() => {
    const billed = customers.reduce((sum, c) => sum + Math.max(0, c.totalPurchases), 0);
    const due = customers.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0);
    const total = Math.max(billed, due);
    // What is left of the bill once the remainder is removed. The payments column is not used
    // for this: a return lowers the bill but not the money once taken, so summing it produced
    // "100,000 collected of 0 billed" after a full refund.
    const collected = Math.max(0, total - due);
    return {
      total,
      collected,
      due,
      pct: total > 0 ? Math.round((collected / total) * 100) : 0,
      // The tiles count the credit book, not the address book: only customers who have actually
      // taken credit appear here, and "pending" is the part of that book not yet past its date.
      accounts: customers.filter((c) => c.outstandingBalance > 0).length,
      pending: customers.filter((c) => c.outstandingBalance > 0 && !isCreditOverdue(c, todayISO)).length,
      overdue: customers.filter((c) => isCreditOverdue(c, todayISO)).length,
    };
  }, [customers, todayISO]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers
      .filter((c) => {
        // Only money still owed. A cash customer, or one who has paid off their credit, is not
        // part of a receivable — listing them here made the screen a second customer list with
        // no balance to collect.
        if (c.outstandingBalance <= 0) return false;
        if (filter === "overdue") return isCreditOverdue(c, todayISO);
        if (filter === "pending") return !isCreditOverdue(c, todayISO);
        if (term && !c.name.toLowerCase().includes(term) && !c.phone.includes(term)) return false;
        return true;
      })
      // Worst first: the person already past their date, then whoever holds the most.
      .sort((a, b) => {
        const aOver = isCreditOverdue(a, todayISO) ? 1 : 0;
        const bOver = isCreditOverdue(b, todayISO) ? 1 : 0;
        if (aOver !== bOver) return bOver - aOver;
        return b.outstandingBalance - a.outstandingBalance;
      });
  }, [customers, search, filter, todayISO]);

  const filters: { key: Filter; label: string }[] = [
    { key: "credit", label: t("receivable.onCredit") },
    { key: "pending", label: t("receivable.pending") },
    { key: "overdue", label: t("receivable.overdue") },
  ];


  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="customer-receivable-page"
    >
      <StatusBar />
      <NavHeader title={t("receivable.title")} backTo={`${base}/settings/overview`} />

      <div className="px-4 pt-2">
        <h1 className="text-22 font-bold">{t("receivable.subtitle")}</h1>
        <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>{t("overall.oweYou")}</p>
      </div>

      {/* The one summary the screen exists for: what is still out, how much of it has come back,
          and how many accounts each state holds. */}
      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="receivable-summary"
        >
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("receivable.totalOutstanding")}</p>
          <p className="text-22 font-bold mt-1 tabular-nums break-words" data-testid="receivable-due">
            {ready ? formatCurrency(summary.due) : "—"}
          </p>

          <div className="flex items-baseline justify-between gap-3 mt-4">
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("receivable.progress")}</p>
            <p className="text-12 font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {summary.pct}%
            </p>
          </div>
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--divider)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(0, Math.min(100, summary.pct))}%`, background: "var(--brand)" }}
            />
          </div>
          <div className="flex items-end justify-between gap-3 mt-2">
            <div className="min-w-0">
              <p className="text-10 flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--brand)" }} />
                {t("overall.collected")}
              </p>
              <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{formatCurrency(summary.collected)}</p>
            </div>
            <div className="min-w-0 text-end">
              <p className="text-10 flex items-center gap-1.5 justify-end" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--muted)" }} />
                {t("receivable.totalDue")}
              </p>
              <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{formatCurrency(summary.total)}</p>
            </div>
          </div>

        </div>

        {/* The three counts sit out on the page as figures only: no arrow, no press state and no
            tap handler. The chips under the search are the one control that filters the list, so
            a card that also changed the view would be a second, silent way to do the same job. */}
        <div className="grid grid-cols-3 gap-2 mt-2">
          <StatTile
            testId="receivable-tile-customers"
            label={t("receivable.customers")}
            value={summary.accounts}
            caption={t("receivable.onCredit")}
          />
          <StatTile
            testId="receivable-tile-pending"
            label={t("receivable.pending")}
            value={summary.pending}
            caption={t("receivable.haveBalance")}
          />
          <StatTile
            testId="receivable-tile-overdue"
            label={t("receivable.overdue")}
            value={summary.overdue}
            caption={t("receivable.followUp")}
            color={summary.overdue > 0 ? "var(--error)" : undefined}
          />
        </div>
      </div>

      <div className="px-4 pt-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("customers.search")}
        />
      </div>

      <div className="flex gap-2 px-4 pt-3 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className="h-8 px-3.5 rounded-full text-12 font-semibold transition-colors"
            style={
              filter === f.key
                ? { background: "var(--brand)", color: "#0a0a0a" }
                : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {!ready ? (
        <SkeletonList rows={5} tile />
      ) : rows.length === 0 ? (
        <div className="px-4 pt-10 flex flex-col items-center gap-2">
          <UserRound size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
            {search.trim() || filter !== "credit" ? t("receivable.empty") : t("receivable.none")}
          </p>
        </div>
      ) : (
        <div id="receivable-list" className="flex flex-col gap-2 px-4 pt-3 pb-24" style={{ scrollMarginTop: 8 }}>
          {rows.map((c) => {
            const overdue = isCreditOverdue(c, todayISO);
            const used = c.creditLimit > 0
              ? Math.min(100, Math.round((c.outstandingBalance / c.creditLimit) * 100))
              : 0;
            const stateLabel = overdue
              ? t("receivable.overdue")
              : c.outstandingBalance > 0 ? t("sale.onCredit") : t("credit.cashCustomer");
            const stateColor = overdue
              ? "var(--error)"
              : c.outstandingBalance > 0 ? "var(--text-secondary)" : "var(--text-tertiary)";
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`${base}/customers/${c.id}`)}
                data-testid={`receivable-row-${c.id}`}
                className="rounded-[var(--radius-card)] p-3.5 text-start active:opacity-70"
                style={{ background: "var(--tone-card)" }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="size-10 rounded-full flex items-center justify-center font-bold text-15 shrink-0"
                    style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                  >
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-14 font-bold truncate">{c.name}</p>
                    <p className="text-12 truncate" style={{ color: "var(--text-secondary)" }}>{c.phone}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="text-13 font-bold tabular-nums">
                      {c.outstandingBalance > 0 ? formatCurrency(c.outstandingBalance) : t("customers.noOutstanding")}
                    </p>
                    <ChevronRight size={14} className="ms-auto mt-0.5" style={{ color: "var(--text-secondary)" }} />
                  </div>
                </div>

                {/* How much of this customer's limit is in use, and which state they are in. When
                    no limit is set the bar would measure nothing, so only the state is drawn. */}
                {c.creditLimit > 0 && (
                  <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "var(--divider)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${used}%`,
                        background: overdue ? "var(--error)" : c.outstandingBalance > 0 ? "var(--warning)" : "var(--brand)",
                      }}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 mt-1.5">
                  <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
                    {c.creditLimit > 0 ? `${used}${t("credit.percentUsed")}` : ""}
                  </p>
                  <span
                    className="text-10 font-bold px-2 py-0.5 rounded-full"
                    style={{ color: stateColor, background: "var(--surface-2)" }}
                  >
                    {stateLabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Adding an account is the one write this screen can start, and only for whoever holds the
          grant the create path checks. */}
      {hasPermission("customers.create") && (
        <div
          className="fixed start-0 end-0 max-w-[480px] mx-auto pointer-events-none z-40 px-4 flex justify-end"
          style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
        >
          <button
            type="button"
            onClick={() => navigate(`${base}/customers/new`)}
            className="pointer-events-auto ps-4 pe-5 rounded-full flex items-center gap-2 text-13 font-bold active:scale-95 transition-transform"
            style={{ background: "var(--brand)", color: "#0a0a0a", height: "50px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
          >
            <Plus size={18} strokeWidth={2.5} /> {t("customers.addNew")}
          </button>
        </div>
      )}
    </div>
  );
}
