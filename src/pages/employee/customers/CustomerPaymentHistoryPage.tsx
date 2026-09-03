import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { CreditHealthBadge } from "@/components/ui/Badge";
import { useCustomersStore } from "@/stores/customersStore";
import { fetchCustomerPayments } from "@/lib/db";
import type { CustomerPayment } from "@/types";
import { formatCurrency, formatDate, getCreditHealth } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { getCreditRequests, type LocalCreditRequest } from "@/lib/localGroupRegistry";
import { CheckCircle2, XCircle, ArrowUpRight } from "lucide-react";

export default function CustomerPaymentHistoryPage() {
  const { customerId } = useParams();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creditRequests, setCreditRequests] = useState<LocalCreditRequest[]>([]);

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
    setCreditRequests(getCreditRequests().filter(r => r.customerId === customerId));
  }, [customerId]);

  if (!customer) return null;

  const health = getCreditHealth(customer.outstandingBalance, customer.creditLimit);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title={t("customerProfile.paymentHistory")}
        
      />

      {/* Customer strip */}
      <div className="mx-4 mt-3 rounded-[14px] p-4" style={{ background: "var(--surface-2)" }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{customer.name}</p>
          <CreditHealthBadge health={health} />
        </div>
        <div className="flex gap-8">
          <div>
            <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>
              {t("customers.outstanding")}
            </p>
            <p
              className="text-sm font-bold"
              style={{ color: customer.outstandingBalance > 0 ? "#d97706" : "var(--brand-dark)" }}
            >
              {formatCurrency(customer.outstandingBalance)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>
              {t("customers.creditLimit")}
            </p>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(customer.creditLimit)}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-12 gap-2">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {t("common.loading")}
          </p>
        </div>
      ) : payments.length === 0 ? (
        <div className="flex flex-col items-center py-12 gap-2">
          <p className="text-3xl">💳</p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {isUrdu ? "کوئی ادائیگی درج نہیں" : "No payments recorded yet"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col mx-4 mt-3">
          {payments.map((p, i) => (
            <div
              key={p.id}
              className="py-4"
              style={{ borderBottom: i < payments.length - 1 ? "1px solid var(--divider)" : "none" }}
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatDate(p.createdAt)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {t("sale.paymentMethod")}: {p.method === "cash" ? t("sale.cash") : t("sale.bankTransfer")}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {isUrdu ? "درج کیا:" : "Rec:"} {p.recordedByName}
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-sm font-bold" style={{ color: "var(--brand-dark)" }}>
                    -{formatCurrency(p.amount)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {isUrdu ? "بقایا:" : "Bal:"} {formatCurrency(p.balanceAfter)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Credit Approval History */}
      {creditRequests.length > 0 && (
        <div className="mx-4 mt-6">
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpRight size={16} style={{ color: "var(--text-secondary)" }} />
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)", direction: isUrdu ? "rtl" : "ltr" }}>
              {isUrdu ? "کریڈٹ منظوری کی تاریخ" : "Credit Approval History"}
            </p>
          </div>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
            {creditRequests.map((req, i) => (
              <div
                key={req.id}
                className="px-4 py-3.5"
                style={{ borderBottom: i < creditRequests.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  {req.status === "approved" ? (
                    <CheckCircle2 size={14} style={{ color: "#16a34a" }} />
                  ) : req.status === "rejected" ? (
                    <XCircle size={14} style={{ color: "#dc2626" }} />
                  ) : (
                    <ArrowUpRight size={14} style={{ color: "#7c3aed" }} />
                  )}
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: req.status === "approved" ? "#d9f99d" : req.status === "rejected" ? "#fee2e2" : "#ede9fe",
                      color: req.status === "approved" ? "#166534" : req.status === "rejected" ? "#991b1b" : "#6d28d9",
                    }}
                  >
                    {req.status === "approved" ? (isUrdu ? "منظور شدہ" : "Approved") : req.status === "rejected" ? (isUrdu ? "مسترد" : "Rejected") : (isUrdu ? "زیر جائزہ" : "Pending")}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    {new Date(req.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}>
                      {formatCurrency(req.currentLimit)} → {formatCurrency(req.requestedLimit)}
                    </p>
                    <p className="text-[11px]" style={{ color: "var(--text-secondary)", direction: isUrdu ? "rtl" : "ltr" }}>
                      {isUrdu ? "درخواست" : "By"} {req.requestedBy}
                    </p>
                  </div>
                  {req.reviewedBy && (
                    <p className="text-[10px]" style={{ color: "var(--text-secondary)", direction: isUrdu ? "rtl" : "ltr" }}>
                      {isUrdu ? "جائزہ" : "By"} {req.reviewedBy}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
