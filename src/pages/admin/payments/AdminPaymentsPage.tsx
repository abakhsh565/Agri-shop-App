import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import EmptyState from "@/components/ui/EmptyState";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { formatCurrency } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { ChevronRight, CheckCircle2 } from "lucide-react";

type Tab = "customers" | "suppliers";

export default function AdminPaymentsPage() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const [tab, setTab] = useState<Tab>("customers");

  const customers = useCustomersStore((s) => s.customers);
  const companies = useCompaniesStore((s) => s.companies);
  // Read both stores unconditionally: short-circuiting a hook call is what
  // crashed this screen, since React must see the same hooks every render.
  const customersReady = useCustomersStore((s) => s.ready);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const ready = customersReady && companiesReady;

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
          className="ds-card p-4 text-start"
          style={{ background: "var(--surface-2)", border: `1.5px solid ${tab === "customers" ? "var(--brand)" : "var(--divider)"}` }}
        >
          <p className="text-10 font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>{t("admin.customersOweUs")}</p>
          <p className="text-lg font-bold mt-1" style={{ color: "var(--brand-dark)" }}>{formatCurrency(totalReceivable)}</p>
        </button>
        <button
          onClick={() => setTab("suppliers")}
          className="ds-card p-4 text-start"
          style={{ background: "var(--surface-2)", border: `1.5px solid ${tab === "suppliers" ? "var(--brand)" : "var(--divider)"}` }}
        >
          <p className="text-10 font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>{t("payments.weOweSuppliers")}</p>
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
      {!ready ? (
        <SkeletonList rows={4} tile />
      ) : tab === "customers" ? (
        owedByCustomers.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={t("payments.noOutstanding")} subtitle={t("payments.allPaidUp")} />
        ) : (
          <div className="px-4 pt-4 pb-6">
            <ListCard>
              {owedByCustomers.map((c) => (
                <ListRow
                  key={c.id}
                  title={c.name}
                  meta={c.phone}
                  onClick={() => navigate(`/admin/customers/${c.id}/record-payment`)}
                  trailing={
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-end">
                        <p className="ds-row-strong" style={{ color: "var(--error)" }}>{formatCurrency(c.outstandingBalance)}</p>
                        <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("admin.recordPayment")}</p>
                      </div>
                      <ChevronRight size={18} style={{ color: "var(--text-secondary)" }} />
                    </div>
                  }
                />
              ))}
            </ListCard>
          </div>
        )
      ) : owedToSuppliers.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t("payments.noSupplierPayables")} subtitle={t("payments.allSuppliersSettled")} />
      ) : (
        <div className="px-4 pt-4 pb-6">
          <ListCard>
            {owedToSuppliers.map((c) => (
              <ListRow
                key={c.id}
                title={c.name}
                meta={c.contactPerson ?? c.phone ?? t("common.supplier")}
                onClick={() => navigate(`/admin/payments/supplier/${c.id}`)}
                trailing={
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-end">
                      <p className="ds-row-strong" style={{ color: "var(--error)" }}>{formatCurrency(c.outstandingPayable)}</p>
                      <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("admin.recordPayment")}</p>
                    </div>
                    <ChevronRight size={18} style={{ color: "var(--text-secondary)" }} />
                  </div>
                }
              />
            ))}
          </ListCard>
        </div>
      )}
    </div>
  );
}
