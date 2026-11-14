import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import CreditListScreen, { type CreditRow } from "@/components/credit/CreditListScreen";
import { useCustomersStore } from "@/stores/customersStore";
import { useShopStore } from "@/stores/shopStore";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { isCreditOverdue } from "@/lib/signalEngine";
import { pkDateFromISO, pkToday } from "@/lib/pkDate";

/**
 * Pending and overdue customer credit — the two screens behind the collection tiles.
 *
 * Same rows the collection screen lists, narrowed by the date test that names the screen: a
 * balance not yet due is PENDING, a balance past its due date is OVERDUE. The rule is
 * `isCreditOverdue`, the S1 predicate Reminders and Home use, so a customer cannot be overdue on
 * one screen and pending on another.
 *
 * The ageing tabs are computed from the row's own due date — days late on the overdue screen,
 * days remaining on the pending one — and never from when the balance was created.
 */
function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000);
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "Asia/Karachi",
  });
}

export default function CustomerCreditPage({ mode }: { mode: "pending" | "overdue" }) {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const customers = useCustomersStore((s) => s.customers);
  const ready = useCustomersStore((s) => s.ready);
  const load = useCustomersStore((s) => s.load);
  const branch = useShopStore((s) => s.activeBranchName);

  useEffect(() => { if (!ready) void load(); }, [ready, load]);

  const todayISO = pkToday();
  const overdue = mode === "overdue";

  const rows: CreditRow[] = useMemo(() => {
    return customers
      .filter((c) => c.outstandingBalance > 0 && isCreditOverdue(c, todayISO) === overdue)
      .map((c) => {
        const isLate = isCreditOverdue(c, todayISO);
        // A credit balance with no date is neither pending nor overdue; the credit screens list
        // only what the date test placed here, so such a row stays on the collection list.
        const days = c.dueDate
          ? Math.abs(daysBetween(pkDateFromISO(c.dueDate), todayISO))
          : 0;
        const when = !c.dueDate
          ? t("payable.noDate")
          : isLate
            ? t("payable.overdueBy", { days })
            : days === 0
              ? t("payable.dueToday")
              : t("payable.dueOn", { date: shortDate(c.dueDate as string) });
        return {
          id: c.id,
          name: c.name,
          meta: branch ? `${branch} · ${when}` : when,
          amount: c.outstandingBalance,
          stateLabel: isLate ? t("receivable.overdue") : t("creditList.notYetDue"),
          stateColor: isLate ? "var(--error)" : "var(--text-secondary)",
          days,
        };
      })
      .sort((a, b) => (overdue ? b.days - a.days : a.days - b.days) || b.amount - a.amount);
  }, [customers, todayISO, overdue, branch, t]);

  const bookTotal = customers.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0);
  const sliceTotal = rows.reduce((sum, row) => sum + row.amount, 0);

  return (
    <CreditListScreen
      title={overdue ? t("creditList.overdueCustomers") : t("creditList.pendingCustomers")}
      backTo={`${base}/settings/overview/customers`}
      scope={t("creditList.scope", { branch: branch ?? t("hub.inventory.selectedBranch") })}
      summaryTitle={t("creditList.outstandingCredit")}
      totalLabel={t("receivable.totalOutstanding")}
      totalValue={bookTotal}
      sliceLabel={overdue ? t("creditList.overdueAmount") : t("creditList.notYetDue")}
      sliceValue={formatCurrency(sliceTotal)}
      allLabel={overdue ? t("creditList.allOverdue") : t("creditList.allPending")}
      views={[
        { label: t("creditList.allOutstanding"), to: `${base}/settings/overview/customers`, active: false },
        { label: t("creditList.notYetDue"), to: `${base}/settings/overview/customers/pending`, active: !overdue },
        { label: t("receivable.overdue"), to: `${base}/settings/overview/customers/overdue`, active: overdue },
      ]}
      rows={rows}
      emptyLabel={overdue ? t("creditList.emptyOverdueCustomers") : t("creditList.emptyPendingCustomers")}
      viewLabel={t("creditList.viewDetails")}
      testId={overdue ? "customer-overdue-page" : "customer-pending-page"}
      onView={(id) => navigate(`${base}/customers/${id}`)}
      onPay={(id) => navigate(`${base}/customers/${id}/record-payment`)}
    />
  );
}
