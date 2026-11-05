import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronRight } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCompaniesStore } from "@/stores/companiesStore";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";
import { daysUntilDue, isSupplierOverdue } from "@/lib/supplierPayable";

/**
 * Outstanding payables — only the suppliers this branch still owes.
 *
 * WHY IT IS ITS OWN SCREEN (owner's instruction, 2026-11-05). The Purchases hub's payable row
 * used to open the full supplier book: a progress card, a reminder control, filters, search and
 * export. The owner asked to see the payable itself and nothing else, so this is a plain list of
 * the suppliers behind the figure on the hub. There is no second summary to disagree with it and
 * no filter to hide a balance.
 *
 * THE FIGURE IS THE SUPPLIER'S BALANCE, not the sum of each delivery's unpaid remainder. A later
 * payment settles the supplier, not one bill, so a bill-level sum reports money already paid;
 * `companies.outstandingPayable` is the balance the payment RPC actually reduces.
 *
 * A row opens the supplier, where the bills and the payment history live. The overdue tag is the
 * same test the payable report and the signal engine use.
 */
export default function PurchasesPayablesPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const companies = useCompaniesStore((s) => s.companies);
  const ready = useCompaniesStore((s) => s.ready);
  const load = useCompaniesStore((s) => s.load);

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  const todayISO = pkToday();

  const rows = useMemo(
    () =>
      companies
        .filter((c) => c.outstandingPayable > 0)
        .sort((a, b) => {
          // Past-due first, then the largest balance: the order a counter works in.
          const aOver = isSupplierOverdue(a, todayISO) ? 1 : 0;
          const bOver = isSupplierOverdue(b, todayISO) ? 1 : 0;
          if (aOver !== bOver) return bOver - aOver;
          return b.outstandingPayable - a.outstandingPayable;
        }),
    [companies, todayISO],
  );

  /** When this balance answers to, in the same words the payable report uses. */
  const dueText = (company: (typeof companies)[number]) => {
    if (!company.dueDate) return t("payable.noDate");
    const days = daysUntilDue(company.dueDate, todayISO);
    if (isSupplierOverdue(company, todayISO) && days !== null) {
      return t("payable.overdueBy", { days: Math.abs(days) });
    }
    if (days === 0) return t("payable.dueToday");
    if (days !== null && days > 0) {
      return t("payable.dueOn", {
        date: new Date(company.dueDate).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          timeZone: "Asia/Karachi",
        }),
      });
    }
    return t("payable.noDate");
  };

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="purchases-payables-page"
    >
      <StatusBar />
      <NavHeader
        title={t("hub.purchases.payables")}
        backTo={`${base}/settings/hub/purchases`}
        historyBack
      />

      {!ready ? (
        <SkeletonList rows={5} tile />
      ) : rows.length === 0 ? (
        <div className="px-4 pt-10 flex flex-col items-center gap-2">
          <Building2 size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("payable.empty")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pt-4 pb-8">
          {rows.map((company) => {
            const overdue = isSupplierOverdue(company, todayISO);
            return (
              <button
                key={company.id}
                type="button"
                onClick={() =>
                  navigate(`${base}/companies/${company.id}`, {
                    state: { from: `${base}/purchases/payables` },
                  })
                }
                data-testid={`payable-supplier-${company.id}`}
                className="w-full rounded-[var(--radius-card)] p-3.5 text-start active:opacity-70"
                style={{ background: "var(--tone-card)" }}
              >
                <span className="flex items-start gap-3">
                  <span
                    className="size-10 rounded-full flex items-center justify-center font-bold text-14 shrink-0"
                    style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                  >
                    {company.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 block">
                    <span className="block text-14 font-bold truncate">{company.name}</span>
                    <span
                      className="block text-11 mt-0.5 truncate"
                      style={{ color: overdue ? "var(--error)" : "var(--text-secondary)" }}
                    >
                      {dueText(company)}
                    </span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block text-14 font-bold tabular-nums">
                      {formatCurrency(company.outstandingPayable)}
                    </span>
                    {overdue && (
                      <span
                        className="inline-block mt-1 text-10 font-bold px-2 py-0.5 rounded-full"
                        style={{ color: "var(--error)", background: "var(--surface-2)" }}
                      >
                        {t("payable.overdue")}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    size={14}
                    className="shrink-0 mt-1"
                    style={{ color: "var(--text-tertiary)" }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
