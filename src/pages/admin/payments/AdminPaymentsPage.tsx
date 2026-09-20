import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import EmptyState from "@/components/ui/EmptyState";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { formatCurrency } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { ChevronRight } from "lucide-react";

type Tab = "customers" | "suppliers";

export default function AdminPaymentsPage() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const [tab, setTab] = useState<Tab>("customers");

  const customers = useCustomersStore((s) => s.customers);
  const companies = useCompaniesStore((s) => s.companies);

  const owedByCustomers = customers
    .filter((c) => c.outstandingBalance > 0)
    .sort((a, b) => b.outstandingBalance - a.outstandingBalance);
  const owedToSuppliers = companies
    .filter((c) => c.outstandingPayable > 0)
    .sort((a, b) => b.outstandingPayable - a.outstandingPayable);

  const totalReceivable = owedByCustomers.reduce((s, c) => s + c.outstandingBalance, 0);
  const totalPayable = owedToSuppliers.reduce((s, c) => s + c.outstandingPayable, 0);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("admin.payments")} />

      {/* Balance cards */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-3">
        <button
          onClick={() => setTab("customers")}
          className="rounded-[14px] p-4 text-start"
          style={{ background: "var(--surface-2)", border: `1.5px solid ${tab === "customers" ? "var(--brand)" : "var(--divider)"}` }}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>{t("admin.customersOweUs")}</p>
          <p className="text-lg font-bold mt-1" style={{ color: "var(--brand-dark)" }}>{formatCurrency(totalReceivable)}</p>
        </button>
        <button
          onClick={() => setTab("suppliers")}
          className="rounded-[14px] p-4 text-start"
          style={{ background: "var(--surface-2)", border: `1.5px solid ${tab === "suppliers" ? "var(--brand)" : "var(--divider)"}` }}
        >
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>{t("payments.weOweSuppliers")}</p>
          <p className="text-lg font-bold mt-1" style={{ color: totalPayable > 0 ? "var(--error)" : "var(--brand-dark)" }}>{formatCurrency(totalPayable)}</p>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 px-4 pt-4">
        {([{ key: "customers", label: t("payments.customerCredit") }, { key: "suppliers", label: t("payments.supplierPayables") }] as const).map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className="flex-1 h-9 rounded-full text-xs font-bold transition-colors"
            style={{
              background: tab === tb.key ? "var(--brand)" : "var(--surface-2)",
              color: tab === tb.key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* List */}
      {tab === "customers" ? (
        owedByCustomers.length === 0 ? (
          <EmptyState icon="✅" title={t("payments.noOutstanding")} subtitle={t("payments.allPaidUp")} />
        ) : (
          <div className="flex flex-col px-4 gap-3 pt-4 pb-6">
            {owedByCustomers.map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/admin/customers/${c.id}/record-payment`)}
                className="flex items-center justify-between rounded-[14px] p-4 text-start transition-opacity active:opacity-70"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{c.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{c.phone}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-end">
                    <p className="text-sm font-bold" style={{ color: "var(--error)" }}>{formatCurrency(c.outstandingBalance)}</p>
                    <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{t("admin.recordPayment")}</p>
                  </div>
                  <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} />
                </div>
              </button>
            ))}
          </div>
        )
      ) : owedToSuppliers.length === 0 ? (
        <EmptyState icon="✅" title={t("payments.noSupplierPayables")} subtitle={t("payments.allSuppliersSettled")} />
      ) : (
        <div className="flex flex-col px-4 gap-3 pt-4 pb-6">
          {owedToSuppliers.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(`/admin/payments/supplier/${c.id}`)}
              className="flex items-center justify-between rounded-[14px] p-4 text-start transition-opacity active:opacity-70"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
            >
              <div className="min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{c.name}</p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{c.contactPerson ?? c.phone ?? "Supplier"}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-end">
                  <p className="text-sm font-bold" style={{ color: "var(--error)" }}>{formatCurrency(c.outstandingPayable)}</p>
                  <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{t("admin.recordPayment")}</p>
                </div>
                <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
