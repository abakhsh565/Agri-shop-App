import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import CreditListScreen, { type CreditRow } from "@/components/credit/CreditListScreen";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useShopStore } from "@/stores/shopStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { pkDateFromISO, pkToday } from "@/lib/pkDate";

/**
 * Pending and overdue supplier payable — the two screens behind the supplier tiles.
 *
 * The supplier side's date test: a payable past the supplier's due date is OVERDUE, one still to
 * come is PENDING. The second figure on this screen is a COUNT, not an amount, because that is
 * the question an owner asks of suppliers — how many am I still to pay, and how many have gone
 * past their date — while the customer side asks how much is overdue.
 */
function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000);
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "Asia/Karachi",
  });
}

export default function SupplierCreditPage({ mode }: { mode: "pending" | "overdue" }) {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const companies = useCompaniesStore((s) => s.companies);
  const ready = useCompaniesStore((s) => s.ready);
  const load = useCompaniesStore((s) => s.load);
  const branch = useShopStore((s) => s.activeBranchName);

  useEffect(() => { if (!ready) void load(); }, [ready, load]);

  const todayISO = pkToday();
  const overdue = mode === "overdue";

  /** Past the due date with money still owed. A payable with no date is neither pending nor late. */
  const isLate = (company: { outstandingPayable: number; dueDate?: string | null }) =>
    company.outstandingPayable > 0 &&
    company.dueDate != null &&
    daysBetween(pkDateFromISO(company.dueDate), todayISO) > 0;

  const rows: CreditRow[] = useMemo(() => {
    return companies
      // A payable with no date cannot be past one, so it belongs to pending. Leaving it out of
      // both screens would hide money the supplier list counts.
      .filter((c) => c.outstandingPayable > 0 && (overdue ? isLate(c) : !isLate(c)))
      .map((c) => {
        const late = isLate(c);
        const days = c.dueDate
          ? Math.abs(daysBetween(pkDateFromISO(c.dueDate), todayISO))
          : 0;
        const when = c.dueDate == null
          ? t("payable.noDate")
          : late
            ? t("payable.overdueBy", { days })
            : days === 0
              ? t("payable.dueToday")
              : t("payable.dueOn", { date: shortDate(c.dueDate as string) });
        return {
          id: c.id,
          name: c.name,
          meta: branch ? `${branch} · ${when}` : when,
          amount: c.outstandingPayable,
          stateLabel: late ? t("payable.overdue") : t("creditList.notYetDue"),
          stateColor: late ? "var(--error)" : "var(--text-secondary)",
          days,
        };
      })
      .sort((a, b) => (overdue ? b.days - a.days : a.days - b.days) || b.amount - a.amount);
    // `isLate` is derived from the same two values the filter reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, todayISO, overdue, branch, t]);

  const bookTotal = companies.reduce((sum, c) => sum + Math.max(0, c.outstandingPayable), 0);

  return (
    <CreditListScreen
      title={overdue ? t("creditList.overdueSuppliers") : t("creditList.pendingSuppliers")}
      backTo={`${base}/settings/overview/suppliers`}
      scope={t("creditList.scope", { branch: branch ?? t("hub.inventory.selectedBranch") })}
      summaryTitle={t("creditList.outstandingPayable")}
      totalLabel={t("payable.totalOutstanding")}
      totalValue={bookTotal}
      sliceLabel={overdue ? t("creditList.suppliersOwed") : t("creditList.suppliersWaiting")}
      sliceValue={rows.length.toLocaleString("en-PK")}
      allLabel={overdue ? t("creditList.allOverdue") : t("creditList.allPending")}
      views={[
        { label: t("creditList.allSuppliers"), to: `${base}/settings/overview/suppliers`, active: false },
        { label: t("creditList.notYetDue"), to: `${base}/settings/overview/suppliers/pending`, active: !overdue },
        { label: t("payable.overdue"), to: `${base}/settings/overview/suppliers/overdue`, active: overdue },
      ]}
      rows={rows}
      emptyLabel={overdue ? t("creditList.emptyOverdueSuppliers") : t("creditList.emptyPendingSuppliers")}
      viewLabel={t("creditList.viewSupplier")}
      testId={overdue ? "supplier-overdue-page" : "supplier-pending-page"}
      // One supplier, one page: the record lives under Companies, and this list passes itself as
      // the way back so the reader stays in the payable book.
      onView={(id) => navigate(`${base}/companies/${id}`, {
        state: { from: `${base}/settings/overview/suppliers/${overdue ? "overdue" : "pending"}` },
      })}
      onPay={(id) => navigate(`${base}/payments/supplier/${id}`, {
        state: { from: `${base}/settings/overview/suppliers/${overdue ? "overdue" : "pending"}` },
      })}
    />
  );
}
