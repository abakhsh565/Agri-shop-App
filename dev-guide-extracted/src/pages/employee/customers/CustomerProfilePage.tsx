import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { CreditHealthBadge } from "@/components/ui/Badge";
import { useCustomersStore } from "@/stores/customersStore";
import { useUIStore } from "@/stores/uiStore";
import { formatCurrency, getCreditHealth } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { MapPin, ChevronRight, CreditCard } from "lucide-react";

function initBgColor(name: string) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function CustomerProfilePage() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const isAdmin = base === "/admin";
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));
  const updateCustomerImage = useCustomersStore((s) => s.updateCustomerImage);
  const { addToast } = useUIStore();

  async function handleImageChange(url: string | null) {
    if (!customerId) return;
    try {
      await updateCustomerImage(customerId, url);
      addToast(url ? "Photo updated" : "Photo removed", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Could not save photo.", "error");
    }
  }

  if (!customer) return null;

  const health   = getCreditHealth(customer.outstandingBalance, customer.creditLimit);
  const initBg   = initBgColor(customer.name);
  const usagePct = customer.creditLimit > 0
    ? Math.min(100, Math.round((customer.outstandingBalance / customer.creditLimit) * 100))
    : 0;

  const METRICS = [
    { key: t("customers.totalPurchases"), value: formatCurrency(customer.totalPurchases), highlight: false },
    { key: t("customers.totalPaid"),      value: formatCurrency(customer.totalPaid),      highlight: false },
    { key: t("customers.outstanding"),    value: formatCurrency(customer.outstandingBalance), highlight: customer.outstandingBalance > 0 },
    { key: t("customers.creditLimit"),    value: formatCurrency(customer.creditLimit),    highlight: false },
  ];

  const ACTIONS = [
    {
      label: t("customerProfile.purchaseHistory"),
      sub:   t("customerProfile.purchaseSub"),
      path:  `${base}/customers/${customerId}/purchases`,
    },
    {
      label: t("customerProfile.paymentHistory"),
      sub:   t("customerProfile.paymentSub"),
      path:  `${base}/customers/${customerId}/payments`,
    },
    {
      label: t("customerProfile.recordPayment"),
      sub:   t("customerProfile.recordSub"),
      path:  `${base}/customers/${customerId}/record-payment`,
      brand: true,
    },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={customer.name} backTo={`${base}/customers`} />

      {/* Profile hero — clean vertical layout */}
      <div className="flex flex-col items-center pt-4 pb-5 gap-2 animate-fade-in-up">
        {isAdmin ? (
          <ImageUpload
            bucket="employee-photos"
            shape="circle"
            value={customer.imageUrl ?? null}
            onChange={handleImageChange}
            label="Add photo"
          />
        ) : customer.imageUrl ? (
          <img src={customer.imageUrl} alt={customer.name} className="size-16 rounded-full object-cover" />
        ) : (
          <div
            className="size-16 rounded-full flex items-center justify-center text-xl font-bold"
            style={{ background: initBg, color: "#fff" }}
          >
            {customer.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="text-center flex flex-col items-center gap-0.5">
          <p className="text-[17px] font-bold" style={{ color: "var(--text-primary)" }}>{customer.name}</p>
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{customer.phone}</p>
          {customer.address && (
            <p className="flex items-center gap-1 text-[12px]" style={{ color: "var(--text-secondary)" }}>
              <MapPin size={12} /> {customer.address}
            </p>
          )}
        </div>
        <CreditHealthBadge health={health} />

        {/* Credit usage bar */}
        {customer.creditLimit > 0 && (
          <div className="w-40 mt-1">
            <div className="h-1.5 rounded-full w-full" style={{ background: "var(--divider)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${usagePct}%`,
                  background: health === "over_limit" ? "#ef4444" : health === "warning" ? "#f59e0b" : "#84cc16",
                }}
              />
            </div>
            <p className="text-[10px] text-center mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {usagePct}% {isUrdu ? "ادھار استعمال" : "credit used"}
            </p>
          </div>
        )}
      </div>

      {/* Financial summary */}
      <div className="px-4 pt-4 animate-fade-in-up delay-150">
        <p className="text-[11px] font-bold text-[#888] uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>
          {t("customerProfile.financial")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {METRICS.map((m) => (
            <div
              key={m.key}
              className="rounded-[12px] p-4"
              style={{ border: "1px solid var(--divider)", background: "var(--surface-2)" }}
            >
              <p className="text-[10px] uppercase mb-1 tracking-wider" style={{ color: "var(--text-secondary)" }}>
                {m.key}
              </p>
              <p
                className="text-lg font-bold"
                style={{ color: m.highlight ? "#d97706" : "var(--text-primary)" }}
              >
                {m.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="px-4 pt-4 pb-6 animate-fade-in-up delay-225">
        <p className="text-[11px] font-bold uppercase mb-3 tracking-wider" style={{ color: "var(--text-secondary)" }}>
          {t("customerProfile.quickActions")}
        </p>
        <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
          {ACTIONS.map((a, i) => (
            <button
              key={a.label}
              onClick={() => navigate(a.path)}
              className="flex items-center justify-between px-4 py-4 text-left w-full transition-opacity active:opacity-70"
              style={{
                borderBottom: i < ACTIONS.length - 1 ? "1px solid var(--divider)" : "none",
                background: a.brand ? "rgba(132,204,22,0.06)" : "transparent",
              }}
            >
              <div className="flex items-center gap-3">
                {a.brand && <CreditCard size={16} style={{ color: "var(--brand-dark)" }} />}
                <div>
                  <p
                    className="text-sm font-bold"
                    style={{ color: a.brand ? "var(--brand-dark)" : "var(--text-primary)" }}
                  >
                    {a.label}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{a.sub}</p>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
