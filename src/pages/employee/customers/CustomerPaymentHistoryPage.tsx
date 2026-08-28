import { useEffect, useState } from "react";
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

export default function CustomerPaymentHistoryPage() {
  const { customerId } = useParams();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customerId) return;
    let active = true;
    setLoading(true);
    fetchCustomerPayments(customerId)
      .then((rows) => { if (active) setPayments(rows); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
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
                <div className="text-right">
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
    </div>
  );
}
