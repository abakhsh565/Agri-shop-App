import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, CalendarDays, Plus, Receipt } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Sheet from "@/components/ui/Sheet";
import ListRow from "@/components/ui/ListRow";
import BalanceDateSheet, { type BalancePeriod } from "@/components/ui/BalanceDateSheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { fetchSupplierPayments, type SupplierPaymentEntry } from "@/lib/db";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";
import { useCurrentTime } from "@/lib/useCurrentTime";

/**
 * Supplier payments, on their own screen.
 *
 * WHY IT IS NOT THE GENERAL PAYMENTS SCREEN (owner's instruction, 2026-10-30). "Supplier payments"
 * in the Purchases hub used to open the payments ledger, which also holds customer receipts and
 * expense entries — a different job with a different answer. This screen is the payable book's
 * cash side: what has actually gone out to suppliers in the chosen window, who received it, and
 * how much is still owed overall. The one write it starts is the one its rows are about, through
 * the same record-payment screen the payments ledger uses.
 */
export default function SupplierPaymentsPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const now = useCurrentTime();
  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const loadCompanies = useCompaniesStore((s) => s.load);

  const [payments, setPayments] = useState<SupplierPaymentEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [period, setPeriod] = useState<BalancePeriod>("all");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [pickOpen, setPickOpen] = useState(false);

  const todayISO = pkToday();

  useEffect(() => { if (!companiesReady) void loadCompanies(); }, [companiesReady, loadCompanies]);

  useEffect(() => {
    let alive = true;
    fetchSupplierPayments()
      .then((rows) => { if (alive) setPayments(rows); })
      .catch(() => { if (alive) setPayments([]); })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

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

  const nameOf = (companyId: string) =>
    companies.find((c) => c.id === companyId)?.name ?? t("moves.unknownItem");

  const shown = useMemo(() => {
    if (period === "all") return payments;
    return payments.filter((p) => {
      const day = p.createdAt.slice(0, 10);
      return day >= windowFrom && day <= windowTo;
    });
  }, [payments, period, windowFrom, windowTo]);

  const paid = shown.reduce((sum, p) => sum + Math.max(0, p.amount), 0);
  const outstanding = companies.reduce((sum, c) => sum + Math.max(0, c.outstandingPayable), 0);
  const payableSuppliers = companies.filter((c) => c.outstandingPayable > 0);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="supplier-payments-page"
    >
      <StatusBar />
      <NavHeader title={t("hub.purchases.payments")} backTo={`${base}/settings/hub/purchases`} />

      <div className="px-4 pt-3">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)" }}
          data-testid="supplier-payments-summary"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("supplierPayments.paidInWindow")}
              </p>
              <p className="text-26 font-bold mt-1 tabular-nums break-words" data-testid="supplier-payments-paid">
                {ready ? formatCurrency(paid) : "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPeriodOpen(true)}
              aria-label={t("period.sheetTitle")}
              aria-haspopup="dialog"
              data-testid="supplier-payments-period"
              className="flex items-center gap-1.5 shrink-0 h-8 px-3 rounded-full text-11 font-semibold active:opacity-60"
              style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
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

          <div className="flex items-end justify-between gap-3 mt-4">
            <div className="min-w-0">
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("supplierPayments.payments")}</p>
              <p className="text-13 font-bold tabular-nums mt-0.5">{ready ? shown.length : "—"}</p>
            </div>
            <div className="min-w-0 text-end">
              <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("payable.totalOutstanding")}</p>
              <p className="text-13 font-bold tabular-nums mt-0.5 break-words">
                {companiesReady ? formatCurrency(outstanding) : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={() => setPickOpen(true)}
          data-testid="supplier-payments-record"
          className="w-full flex items-center gap-3 rounded-[var(--radius-card)] p-3 text-start active:opacity-70"
          // A row in the book's own grey, not a brand-coloured button (owner's correction,
          // 2026-10-31): recording a payment is the usual next step here, not the screen's one
          // call to action, and the bright fill made it shout over the history below it.
          style={{ background: "var(--tone-sunken)" }}
        >
          <span
            className="size-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--surface-2)", color: "var(--brand-dark)" }}
          >
            <Plus size={18} strokeWidth={2.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-14 font-bold" style={{ color: "var(--text-primary)" }}>
              {t("supplierPayments.record")}
            </span>
            <span className="block text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {t("supplierPayments.recordHint")}
            </span>
          </span>
        </button>
      </div>

      <p className="text-13 font-bold px-4 pt-5 pb-2">{t("supplierPayments.history")}</p>

      {!ready ? (
        <SkeletonList rows={5} tile />
      ) : shown.length === 0 ? (
        <div className="px-4 py-10 flex flex-col items-center gap-2">
          <Receipt size={26} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("supplierPayments.empty")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pb-8">
          {shown.map((payment) => (
            <div
              key={payment.id}
              className="rounded-[var(--radius-card)] p-3.5"
              style={{ background: "var(--tone-card)" }}
              data-testid={`supplier-payment-${payment.id}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className="size-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                >
                  <Building2 size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-14 font-bold truncate">{nameOf(payment.companyId)}</p>
                  <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                    {formatSmartDateTime(payment.createdAt, now, t)}
                  </p>
                </div>
                <p className="text-13 font-bold tabular-nums shrink-0" style={{ color: "var(--brand-dark)" }}>
                  {formatCurrency(payment.amount)}
                </p>
              </div>
              {(payment.purchaseId || payment.notes) && (
                <p className="text-10 mt-2 truncate" style={{ color: "var(--text-tertiary)" }}>
                  {/* An advance carries no note, it carries the delivery it paid for. Saying so
                      is what keeps this list from looking like it invented a payment. */}
                  {payment.purchaseId ? t("supplierPayments.advance") : payment.notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

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
        testIdPrefix="supplier-payments-period"
      />

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title={t("supplierPayments.pickSupplier")}>
        {(payableSuppliers.length > 0 ? payableSuppliers : companies).map((company) => (
          <ListRow
            key={company.id}
            testId={`supplier-pick-${company.id}`}
            icon={Building2}
            title={company.name}
            description={formatCurrency(Math.max(0, company.outstandingPayable))}
            onClick={() => {
              setPickOpen(false);
              navigate(`${base}/payments/supplier/${company.id}`);
            }}
          />
        ))}
        {(payableSuppliers.length > 0 ? payableSuppliers : companies).length === 0 && (
          <p className="px-4 py-6 text-13 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("payable.empty")}
          </p>
        )}
      </Sheet>
    </div>
  );
}
