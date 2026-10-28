import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Plus, Search } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { fetchPurchases, fetchSupplierPayments, type SupplierPaymentEntry } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/formatters";
import type { Purchase } from "@/types";

/**
 * One supplier's money, as the payable side reads it.
 *
 * WHY IT IS ITS OWN SCREEN. The supplier page reached from Purchases answers "who is this, what do
 * they sell me, and how do I edit them". This one answers the three questions the payable flow
 * asks: what have I been billed, what have I actually paid, and which bills are still open — then
 * puts the one action that changes the answer (record a payment) at the top of it.
 *
 * THE FIGURES COME FROM THE BRANCH'S OWN LEDGER. Billed and payable are the branch-scoped sums the
 * payable list uses (0242), so this page and the card that opened it cannot disagree. The bill list
 * is the purchases recorded against this supplier, each with its own paid amount and balance, and
 * the payment tab reads the payment records themselves — never a running total inferred twice.
 */
type Tab = "bills" | "payments";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "Asia/Karachi",
  });
}

export default function SupplierDetailsPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { companyId } = useParams<{ companyId: string }>();

  const companies = useCompaniesStore((s) => s.companies);
  const ready = useCompaniesStore((s) => s.ready);
  const load = useCompaniesStore((s) => s.load);

  const company = companies.find((c) => c.id === companyId) ?? null;

  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [payments, setPayments] = useState<SupplierPaymentEntry[] | null>(null);
  const [tab, setTab] = useState<Tab>("bills");

  useEffect(() => { if (!ready) void load(); }, [ready, load]);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    void fetchPurchases()
      .then((all) => {
        if (!alive) return;
        setPurchases(
          all
            .filter((p) => p.companyId === companyId)
            .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
        );
      })
      .catch(() => { if (alive) setPurchases([]); });
    void fetchSupplierPayments(companyId)
      .then((rows) => { if (alive) setPayments(rows); })
      .catch(() => { if (alive) setPayments([]); });
    return () => { alive = false; };
  }, [companyId]);

  /** The open bills: what is still owed, which is what "Pay this bill" is for. */
  const bills = useMemo(() => purchases ?? [], [purchases]);
  const openBills = bills.filter((b) => b.outstandingPayable > 0);

  if (!company) {
    return (
      <div
        className="flex flex-col w-full min-h-full"
        style={{ background: "var(--background)", color: "var(--text-primary)" }}
      >
        <StatusBar />
        <NavHeader title={t("supplierDetail.title")} backTo={`${base}/settings/overview/suppliers`} />
        {ready ? (
          <div className="flex flex-col items-center py-20 gap-2">
            <Search size={28} style={{ color: "var(--text-tertiary)" }} />
            <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("supplierDetail.notFound")}</p>
          </div>
        ) : (
          <SkeletonList rows={4} />
        )}
      </div>
    );
  }

  const billed = Math.max(0, company.totalPurchases);
  const due = Math.max(0, company.outstandingPayable);
  const paid = Math.max(0, billed - due);
  const settledPct = billed > 0 ? Math.round((paid / billed) * 100) : 0;
  const settledBills = bills.filter((b) => b.outstandingPayable <= 0).length;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="supplier-details-page"
    >
      <StatusBar />
      <NavHeader title={t("supplierDetail.title")} backTo={`${base}/settings/overview/suppliers`} />

      {/* Who this is: the logo they gave, their name, and the one contact detail on record. */}
      <div className="flex items-center gap-3 px-4 pt-2 pb-1">
        {company.logoUrl ? (
          <img
            src={company.logoUrl}
            alt={company.name}
            className="size-14 rounded-[var(--radius-card)] object-cover shrink-0"
          />
        ) : (
          <span
            className="size-14 rounded-[var(--radius-card)] flex items-center justify-center text-20 font-bold shrink-0"
            style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
          >
            {company.name.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-20 font-bold truncate">{company.name}</h1>
          <p className="text-12 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
            {company.phone ?? t("supplierDetail.supplier")}
          </p>
        </div>
      </div>

      {/* What has been billed and what has come back. */}
      <div className="flex gap-6 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("supplierDetail.totalBilled")}</p>
          <p className="text-18 font-bold mt-0.5 tabular-nums break-words">{formatCurrency(billed)}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("supplierDetail.paymentsMade")}</p>
          <p className="text-18 font-bold mt-0.5 tabular-nums break-words" style={{ color: "var(--brand-dark)" }}>
            {formatCurrency(paid)}
          </p>
        </div>
      </div>

      {/* The payable itself, with how much of the bill book is settled. */}
      <div className="px-4 pt-4">
        <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--tone-card)" }}>
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("creditList.outstandingPayable")}</p>
          <p className="text-22 font-bold mt-1 tabular-nums break-words">{formatCurrency(due)}</p>

          <div className="flex items-baseline justify-between gap-3 mt-4">
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("supplierDetail.billsSettled")}</p>
            <p className="text-12 font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>{settledPct}%</p>
          </div>
          {/* The track is a hairline token, not the sunken tone: at 0% the bar has no fill, and
              the tone was too close to the card to see that anything was there. */}
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--divider)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(0, Math.min(100, settledPct))}%`, background: "var(--brand)" }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 mt-2">
            <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
              {t("supplierDetail.billsSettledCount", { count: settledBills })}
            </p>
            <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
              {t("supplierDetail.billsOutstandingCount", { count: openBills.length })}
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate(`${base}/payments/supplier/${company.id}`)}
            data-testid="supplier-detail-pay"
            className="mt-4 w-full h-11 rounded-[var(--radius-card)] flex items-center justify-center gap-2 text-13 font-bold active:opacity-80"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            <Plus size={16} /> {t("supplierDetail.recordPayment")}
          </button>
        </div>
      </div>

      {/* Bills, then the payments already made. */}
      <div className="px-4 pt-4">
        <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: "var(--tone-sunken)" }}>
          {([
            { key: "bills" as Tab, label: t("supplierDetail.tabBills") },
            { key: "payments" as Tab, label: t("supplierDetail.tabPayments") },
          ]).map((option) => {
            const selected = tab === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setTab(option.key)}
                aria-pressed={selected}
                className="flex-1 h-9 rounded-full text-13 font-semibold"
                style={selected
                  ? { background: "var(--tone-card)", color: "var(--text-primary)" }
                  : { background: "transparent", color: "var(--text-secondary)" }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {!ready || purchases === null || payments === null ? (
        <SkeletonList rows={3} />
      ) : tab === "bills" ? (
        bills.length === 0 ? (
          <p className="px-4 pt-8 text-13 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("supplierDetail.noBills")}
          </p>
        ) : (
          <div className="px-4 pt-4 pb-8">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="text-13 font-bold">{t("supplierDetail.purchaseBills")}</p>
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("supplierDetail.billCount", { count: bills.length })}
              </p>
            </div>
            {/* A payment is recorded against the supplier, not against one delivery (there is no
                per-bill allocation), so the note says which figure the bill's remainder is. */}
            <p className="text-10 mb-2.5" style={{ color: "var(--text-tertiary)" }}>
              {t("supplierDetail.billNote")}
            </p>
            <div className="flex flex-col gap-2.5">
              {bills.map((bill) => {
                const billPaid = Math.max(0, bill.totalAmount - bill.outstandingPayable);
                const pct = bill.totalAmount > 0 ? Math.round((billPaid / bill.totalAmount) * 100) : 0;
                const open = bill.outstandingPayable > 0;
                return (
                  <div
                    key={bill.id}
                    className="rounded-[var(--radius-card)] p-3.5"
                    style={{ background: "var(--tone-card)" }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-13 font-bold truncate">{bill.purchaseNumber}</p>
                        <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          {t("supplierDetail.billDate", { date: formatDate(bill.createdAt) })}
                        </p>
                      </div>
                      <span
                        className="text-10 font-bold px-2 py-0.5 rounded-full shrink-0"
                        style={{
                          color: open ? "var(--warning)" : "var(--text-secondary)",
                          background: "var(--surface-2)",
                        }}
                      >
                        {open ? t("payable.outstanding") : t("payable.paid")}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-3 mt-3">
                      <div className="min-w-0">
                        <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("supplierDetail.billAmount")}</p>
                        <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{formatCurrency(bill.totalAmount)}</p>
                      </div>
                      <div className="min-w-0 text-end">
                        <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("supplierDetail.unpaidAtDelivery")}</p>
                        <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{formatCurrency(bill.outstandingPayable)}</p>
                      </div>
                    </div>

                    <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "var(--divider)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--brand)" }} />
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-1.5">
                      <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
                        {t("supplierDetail.paidAtDelivery", { pct })}
                      </p>
                      {open && (
                        <button
                          type="button"
                          onClick={() => navigate(`${base}/payments/supplier/${company.id}`)}
                          className="flex items-center gap-1 text-11 font-semibold"
                          style={{ color: "var(--brand-dark)" }}
                        >
                          {t("supplierDetail.payThisBill")}
                          <ChevronRight size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : payments.length === 0 ? (
        <p className="px-4 pt-8 text-13 text-center" style={{ color: "var(--text-secondary)" }}>
          {t("supplierDetail.noPayments")}
        </p>
      ) : (
        <div className="px-4 pt-4 pb-8 flex flex-col gap-2.5">
          {payments.map((payment) => (
            <div
              key={payment.id}
              className="rounded-[var(--radius-card)] p-3.5 flex items-center gap-3"
              style={{ background: "var(--tone-card)" }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-13 font-bold tabular-nums">{formatCurrency(payment.amount)}</p>
                <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                  {shortDate(payment.createdAt)}
                  {payment.recordedByName ? ` · ${payment.recordedByName}` : ""}
                </p>
              </div>
              {payment.notes && (
                <p className="text-10 max-w-[45%] truncate" style={{ color: "var(--text-tertiary)" }}>{payment.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
