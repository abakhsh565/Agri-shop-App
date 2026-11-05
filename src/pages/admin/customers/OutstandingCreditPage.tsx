import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Wallet } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useCustomersStore } from "@/stores/customersStore";
import { useShopStore } from "@/stores/shopStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { isCreditOverdue } from "@/lib/signalEngine";
import { pkToday } from "@/lib/pkDate";
import { customerCreditState, daysOverdue } from "@/lib/customerCredit";
import { hasPermission } from "@/lib/tenantContext";

type AgeFilter = "all" | "1-7" | "8-30" | "31+";
type StateFilter = "all" | "not_due" | "overdue" | "no_due_date";

/**
 * Outstanding credit: what is still owed to this branch, how late it is, and what to do next.
 *
 * SHAPE (owner's reference, 2026-10-28): the aging tabs, one plate carrying the outstanding and
 * overdue totals, the state filters, then one card per customer with its due date, its amount,
 * and the two actions that resolve it — open the customer, or take the payment.
 *
 * THE AGING TABS MEASURE THE SAME THING THE CHIP SAYS. A row's age is `daysOverdue` — whole days
 * past a due date that exists. A customer with no due date is not "0 days late"; the app cannot
 * call them late without inventing the date, so they appear under "All outstanding" and under
 * their own "No due date" filter, never in an aging bucket.
 *
 * THE TOTALS ARE INDEPENDENT OF THE FILTERS. The plate answers "how much is out, and how much of
 * it is late" for the whole branch; the filters below narrow which rows are listed. A total that
 * shrank with a filter would be a second, unlabelled figure.
 */
export default function OutstandingCreditPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const customers = useCustomersStore((s) => s.customers);
  const ready = useCustomersStore((s) => s.ready);
  const load = useCustomersStore((s) => s.load);
  const branchName = useShopStore((s) => s.activeBranchName);

  const [age, setAge] = useState<AgeFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  const todayISO = pkToday();
  const canRecordPayment = hasPermission("customers.payments");

  const owed = useMemo(
    () => customers.filter((c) => c.outstandingBalance > 0),
    [customers],
  );

  const totals = useMemo(() => {
    const outstanding = owed.reduce((sum, c) => sum + c.outstandingBalance, 0);
    const overdue = owed
      .filter((c) => isCreditOverdue(c, todayISO))
      .reduce((sum, c) => sum + c.outstandingBalance, 0);
    return { outstanding, overdue, accounts: owed.length };
  }, [owed, todayISO]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return owed
      .filter((c) => {
        if (term && !c.name.toLowerCase().includes(term) && !c.phone.includes(term)) return false;

        if (stateFilter !== "all") {
          const state = customerCreditState(c, todayISO);
          if (state !== stateFilter) return false;
        }

        if (age !== "all") {
          const days = daysOverdue(c, todayISO);
          if (days == null) return false;
          if (age === "1-7" && days > 7) return false;
          if (age === "8-30" && (days < 8 || days > 30)) return false;
          if (age === "31+" && days < 31) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aDays = daysOverdue(a, todayISO) ?? -1;
        const bDays = daysOverdue(b, todayISO) ?? -1;
        if (aDays !== bDays) return bDays - aDays;
        return b.outstandingBalance - a.outstandingBalance;
      });
  }, [owed, search, stateFilter, age, todayISO]);

  const ageTabs: { key: AgeFilter; label: string }[] = [
    { key: "all", label: t("outstanding.allAges") },
    { key: "1-7", label: t("outstanding.bucket1") },
    { key: "8-30", label: t("outstanding.bucket2") },
    { key: "31+", label: t("outstanding.bucket3") },
  ];
  const stateChips: { key: StateFilter; label: string }[] = [
    { key: "all", label: t("outstanding.allOutstanding") },
    { key: "not_due", label: t("outstanding.notYetDue") },
    { key: "overdue", label: t("receivable.overdue") },
    { key: "no_due_date", label: t("outstanding.noDueDate") },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="outstanding-credit-page"
    >
      <StatusBar />
      <NavHeader title={t("outstanding.title")} backTo={`${base}/settings/hub/customers`} historyBack />

      {/* Aging, as text tabs rather than pills: these narrow one list by how late it is, and the
          reference sets them apart from the state chips below. */}
      <div className="flex gap-6 px-4 pt-1 overflow-x-auto">
        {ageTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setAge(tab.key)}
            aria-pressed={age === tab.key}
            className="shrink-0 pb-2 text-13"
            style={{
              color: age === tab.key ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: age === tab.key ? "var(--weight-strong)" : "var(--weight-body)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="px-4 pt-3">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)" }}
          data-testid="outstanding-summary"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                {t("receivable.totalOutstanding")}
              </p>
              <p className="text-22 font-bold mt-1 tabular-nums break-words" data-testid="outstanding-total">
                {ready ? formatCurrency(totals.outstanding) : "—"}
              </p>
            </div>
            <div className="min-w-0 text-end">
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                {t("outstanding.overdueAmount")}
              </p>
              <p
                className="text-16 font-bold mt-1 tabular-nums break-words"
                style={{ color: totals.overdue > 0 ? "var(--error)" : "var(--text-primary)" }}
                data-testid="outstanding-overdue"
              >
                {ready ? formatCurrency(totals.overdue) : "—"}
              </p>
            </div>
          </div>
          <p className="text-10 mt-3" style={{ color: "var(--text-tertiary)" }}>
            {ready
              ? t("outstanding.scope", {
                  count: String(totals.accounts),
                  branch: branchName ?? t("hub.inventory.selectedBranch"),
                })
              : t("common.loading")}
          </p>
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

      <div className="flex gap-1.5 px-4 pt-3 pb-3 overflow-x-auto">
        {stateChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setStateFilter(chip.key)}
            aria-pressed={stateFilter === chip.key}
            className="shrink-0 h-9 px-3 rounded-full text-12 font-semibold transition-colors active:opacity-70"
            style={{
              background: stateFilter === chip.key ? "var(--brand)" : "var(--surface-2)",
              color: stateFilter === chip.key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {!ready ? (
        <SkeletonList rows={4} tile />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 gap-2">
          <Wallet size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-14 font-semibold text-center" style={{ color: "var(--text-primary)" }}>
            {owed.length === 0 ? t("outstanding.empty") : t("outstanding.emptyFilter")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pb-8">
          {rows.map((c) => {
            const days = daysOverdue(c, todayISO);
            const status = customerCreditState(c, todayISO);
            return (
              <div
                key={c.id}
                className="rounded-[var(--radius-card)] p-4"
                style={{ background: "var(--surface)" }}
                data-testid={`outstanding-row-${c.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-15 font-semibold truncate">{c.name}</p>
                    <p className="text-12 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {branchName ? `${branchName} · ` : ""}
                      {c.dueDate
                        ? t("outstanding.dueOn", { date: formatDate(c.dueDate) })
                        : t("outstanding.noDueDate")}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="text-14 font-bold tabular-nums">{formatCurrency(c.outstandingBalance)}</p>
                    <span
                      className="inline-block text-10 font-bold px-2 py-0.5 rounded-full mt-1"
                      style={{
                        background: "var(--surface-2)",
                        color:
                          status === "overdue"
                            ? "var(--error)"
                            : status === "no_due_date"
                              ? "var(--text-tertiary)"
                              : "var(--text-secondary)",
                      }}
                    >
                      {status === "overdue" && days != null
                        ? t("outstanding.overdueDays", { days: String(days) })
                        : status === "no_due_date"
                          ? t("outstanding.noDueDate")
                          : t("outstanding.notYetDue")}
                    </span>
                  </div>
                </div>

                {/* The two actions, as text (owner, 2026-10-30): the filled pills turned every
                    row into two competing buttons, and the row's subject is the balance, not
                    the actions. Both stay full-height touch targets; only the paint is gone.
                    The second is drawn only for an account allowed to record a customer
                    payment, so it is never a button that ends in a refusal. */}
                <div className="flex items-center justify-between gap-3 mt-2">
                  <button
                    type="button"
                    onClick={() => navigate(`${base}/customers/${c.id}`)}
                    className="min-h-11 flex items-center gap-1 text-13 font-semibold active:opacity-60"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {t("outstanding.viewDetails")}
                    <ChevronRight size={14} />
                  </button>
                  {canRecordPayment && (
                    <button
                      type="button"
                      onClick={() => navigate(`${base}/customers/${c.id}/record-payment`)}
                      className="min-h-11 flex items-center gap-1 text-13 font-semibold active:opacity-60"
                      style={{ color: "var(--brand-dark)" }}
                    >
                      {t("customers.recordPayment")}
                      <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
