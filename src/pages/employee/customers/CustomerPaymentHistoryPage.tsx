import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { CreditHealthBadge } from "@/components/ui/Badge";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useCustomersStore } from "@/stores/customersStore";
import { fetchCustomerPayments } from "@/lib/db";
import type { CustomerPayment } from "@/types";
import { formatCurrency, formatDate, getCreditHealth } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import SegmentedTabs from "@/components/ui/SegmentedTabs";
import { useThemeStore } from "@/stores/themeStore";
import { getCreditRequestsDB, type LocalCreditRequest } from "@/lib/localGroupRegistry";
import { CheckCircle2, XCircle, ArrowUpRight, CreditCard } from "lucide-react";
import { SkeletonList } from "@/components/ui/Skeleton";

export default function CustomerPaymentHistoryPage() {
  const { customerId } = useParams();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));
  const customersReady = useCustomersStore((s) => s.ready);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creditRequests, setCreditRequests] = useState<LocalCreditRequest[]>([]);
  const [activeTab, setActiveTab] = useState<"payments" | "credit">("payments");

  useEffect(() => {
    if (!customerId) return;
    let active = true;
    setLoading(true);
    fetchCustomerPayments(customerId)
      .then((rows) => { if (active) setPayments(rows); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [customerId]);

  useEffect(() => {
    getCreditRequestsDB().then(reqs => setCreditRequests(reqs.filter(r => r.customerId === customerId)));
  }, [customerId]);

  if (!customer) return customersReady ? null : <SkeletonList rows={4} />;

  const health = getCreditHealth(customer.outstandingBalance, customer.creditLimit);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("customerProfile.paymentHistory")} historyBack />

      {/* Customer strip */}
      <div className="mx-4 mt-3 rounded-[var(--radius-card)] p-4" style={{ background: "var(--tone-card)" }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{customer.name}</p>
          <CreditHealthBadge health={health} />
        </div>
        <div className="flex gap-8">
          <div>
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("customers.outstanding")}
            </p>
            <p className="text-sm font-bold" style={{ color: customer.outstandingBalance > 0 ? "#d97706" : "var(--brand-dark)" }}>
              {formatCurrency(customer.outstandingBalance)}
            </p>
          </div>
          <div>
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("customers.creditLimit")}
            </p>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(customer.creditLimit)}
            </p>
          </div>
        </div>
      </div>

      {/* Tab bar — the app's segmented control, the same track and pill as Sales. */}
      <div className="mx-4 mt-3">
        <SegmentedTabs
          value={activeTab}
          onChange={setActiveTab}
          items={[
            { key: "payments" as const, label: t("inline.payment_records") },
            { key: "credit" as const, label: t("inline.credit_approval"), count: creditRequests.length },
          ]}
        />
      </div>

      {/* Tab content */}
      {activeTab === "payments" ? (
        loading ? (
          <SkeletonList rows={4} tile />
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-2">
            <CreditCard size={28} className="mx-auto block" style={{ color: "var(--text-tertiary)" }} />
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {t("inline.no_payments_recorded_yet")}
            </p>
          </div>
        ) : (
          <ListCard className="mx-4 mt-3">
            {payments.map((p) => (
              <ListRow key={p.id}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                      {formatDate(p.createdAt)}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {t("sale.paymentMethod")}: {String(p.method) === "split" ? (t("recordPayment.splitPayment")) : p.method === "cash" ? t("sale.cash") : t("sale.bankTransfer")}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {t("inline.rec")} {p.recordedByName}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="text-sm font-bold" style={{ color: "var(--brand-dark)" }}>
                      -{formatCurrency(p.amount)}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {t("inline.bal")} {formatCurrency(p.balanceAfter)}
                    </p>
                  </div>
                </div>
              </ListRow>
            ))}
          </ListCard>
        )
      ) : (
        /* Credit Approval Tab */
        creditRequests.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-2">
            <ArrowUpRight size={32} style={{ color: "var(--text-secondary)", opacity: 0.4 }} />
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {t("inline.no_credit_requests_yet")}
            </p>
          </div>
        ) : (
          <ListCard className="mx-4 mt-3">
            {creditRequests.map((req) => (
              <ListRow key={req.id}>
                <div className="flex items-center gap-2 mb-1.5">
                  {req.status === "approved" ? (
                    <CheckCircle2 size={14} style={{ color: "#16a34a" }} />
                  ) : req.status === "rejected" ? (
                    <XCircle size={14} style={{ color: "#dc2626" }} />
                  ) : (
                    <ArrowUpRight size={14} style={{ color: "#7c3aed" }} />
                  )}
                  <span
                    className="text-10 font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: req.status === "approved" ? "#d9f99d" : req.status === "rejected" ? "#fee2e2" : "#ede9fe",
                      color: req.status === "approved" ? "#166534" : req.status === "rejected" ? "#991b1b" : "#6d28d9",
                    }}
                  >
                    {req.status === "approved" ? (t("superAdmin.status.approved")) : req.status === "rejected" ? (t("superAdmin.status.rejected")) : (t("superAdmin.status.pending"))}
                  </span>
                  <span className="text-10" style={{ color: "var(--text-secondary)" }}>
                    {new Date(req.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-13 font-medium" style={{ color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}>
                      {formatCurrency(req.currentLimit)} → {formatCurrency(req.requestedLimit)}
                    </p>
                    <p className="text-11" style={{ color: "var(--text-secondary)", direction: isUrdu ? "rtl" : "ltr" }}>
                      {t("inline.by_x")} {req.requestedBy}
                    </p>
                  </div>
                  {req.reviewedBy && (
                    <p className="text-10" style={{ color: "var(--text-secondary)", direction: isUrdu ? "rtl" : "ltr" }}>
                      {t("inline.by_x_x")} {req.reviewedBy}
                    </p>
                  )}
                </div>
              </ListRow>
            ))}
          </ListCard>
        )
      )}
    </div>
  );
}
