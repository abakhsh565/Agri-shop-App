import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronDown } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCompaniesStore } from "@/stores/companiesStore";
import { fetchSupplierUnpaidBills, type SupplierUnpaidBill } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";
import { daysUntilDue, isSupplierOverdue } from "@/lib/supplierPayable";
import { hasPermission } from "@/lib/tenantContext";

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
 * THE BILLS ARE ONE TAP AWAY (owner's instruction, 2026-11-06). A supplier row expands on the
 * spot to show the unpaid deliveries behind the balance, and each bill opens its own detail. The
 * payment action sits on the row itself and carries this list as its return target, so recording
 * a payment no longer drops the reader in the general money statement.
 */
export default function PurchasesPayablesPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const canPay = hasPermission("payments.view");

  const companies = useCompaniesStore((s) => s.companies);
  const ready = useCompaniesStore((s) => s.ready);
  const load = useCompaniesStore((s) => s.load);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [billsByCompany, setBillsByCompany] = useState<Record<string, SupplierUnpaidBill[]>>({});
  const [billsLoadingFor, setBillsLoadingFor] = useState<string | null>(null);
  const [billsFailedFor, setBillsFailedFor] = useState<string | null>(null);

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

  async function loadBills(companyId: string) {
    setBillsLoadingFor(companyId);
    setBillsFailedFor(null);
    try {
      const bills = await fetchSupplierUnpaidBills(companyId);
      setBillsByCompany((previous) => ({ ...previous, [companyId]: bills }));
    } catch {
      setBillsFailedFor(companyId);
    } finally {
      setBillsLoadingFor((current) => (current === companyId ? null : current));
    }
  }

  function toggleBills(companyId: string) {
    if (expanded === companyId) {
      setExpanded(null);
      return;
    }
    setExpanded(companyId);
    // One supplier's bills are read the first time that supplier is opened. A failed read is
    // retried on the next expansion instead of being remembered as "no bills".
    if (!billsByCompany[companyId] && billsLoadingFor !== companyId) {
      void loadBills(companyId);
    }
  }

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
            const isOpen = expanded === company.id;
            const bills = billsByCompany[company.id];
            const billsLoading = billsLoadingFor === company.id;
            const billsFailed = billsFailedFor === company.id;

            return (
              <div
                key={company.id}
                data-testid={`payable-supplier-${company.id}`}
                className="rounded-[var(--radius-card)] p-3.5"
                style={{ background: "var(--tone-card)" }}
              >
                <button
                  type="button"
                  onClick={() => toggleBills(company.id)}
                  aria-expanded={isOpen}
                  aria-controls={`payable-bills-${company.id}`}
                  data-testid={`payable-supplier-toggle-${company.id}`}
                  className="w-full text-start active:opacity-70"
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
                    <ChevronDown
                      size={14}
                      className={"shrink-0 mt-1 transition-transform" + (isOpen ? " rotate-180" : "")}
                      style={{ color: "var(--text-tertiary)" }}
                    />
                  </span>
                </button>

                {isOpen && (
                  <div
                    id={`payable-bills-${company.id}`}
                    className="mt-3 pt-3"
                    style={{ borderTop: "1px solid var(--hairline)" }}
                  >
                    <p className="text-10 font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
                      {t("payable.unpaidBills")}
                    </p>
                    {billsLoading ? (
                      <SkeletonList rows={2} tile={false} />
                    ) : billsFailed ? (
                      <div className="flex items-center justify-between gap-3 py-2">
                        <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                          {t("payable.billsLoadFailed")}
                        </p>
                        <button
                          type="button"
                          onClick={() => void loadBills(company.id)}
                          className="h-7 px-3 rounded-full text-10 font-bold shrink-0 active:opacity-60"
                          style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                        >
                          {t("common.retry")}
                        </button>
                      </div>
                    ) : !bills || bills.length === 0 ? (
                      <p className="py-2 text-11" style={{ color: "var(--text-secondary)" }}>
                        {t("payable.noUnpaidBills")}
                      </p>
                    ) : (
                      <>
                        <ListCard variant="plain">
                          {bills.map((bill) => (
                            <ListRow
                              key={bill.id}
                              testId={`payable-bill-${bill.id}`}
                              title={bill.purchaseNumber}
                              meta={formatDate(bill.createdAt)}
                              onClick={() =>
                                navigate(`${base}/purchases/${bill.id}`, {
                                  state: { from: `${base}/purchases/payables` },
                                })
                              }
                              trailing={
                                <div className="text-end shrink-0">
                                  <p className="text-13 font-bold tabular-nums">
                                    {formatCurrency(bill.outstandingPayable)}
                                  </p>
                                  <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                                    {t("supplierDetail.unpaidAtDelivery")}
                                  </p>
                                </div>
                              }
                            />
                          ))}
                        </ListCard>
                        <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
                          {t("supplierDetail.billNote")}
                        </p>
                      </>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`${base}/companies/${company.id}`, {
                        state: { from: `${base}/purchases/payables` },
                      })
                    }
                    className="h-8 px-3 rounded-full text-10 font-bold active:opacity-60"
                    style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                  >
                    {t("payable.viewDetails")}
                  </button>
                  {canPay && (
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`${base}/payments/supplier/${company.id}`, {
                          state: { from: `${base}/purchases/payables` },
                        })
                      }
                      data-testid={`payable-record-payment-${company.id}`}
                      className="h-8 px-3 rounded-full text-10 font-bold active:opacity-60"
                      style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
                    >
                      {t("supplierPayments.record")}
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
