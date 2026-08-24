import { useState } from "react";
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
import { MapPin, ChevronRight, CreditCard, Pencil } from "lucide-react";

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

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    if (!customer) return;
    setEditName(customer.name);
    setEditPhone(customer.phone);
    setEditAddress(customer.address ?? "");
    setEditing(true);
  }

  async function saveEdit() {
    if (!customerId || !customer) return;
    if (!editName.trim()) { addToast("Name is required", "error"); return; }
    if (!editPhone.trim()) { addToast("Phone is required", "error"); return; }
    // Check for duplicate phone number (excluding current customer)
    const allCustomers = useCustomersStore.getState().customers;
    const duplicate = allCustomers.find((c) => c.phone === editPhone.trim() && c.id !== customerId && !c.isArchived);
    if (duplicate) {
      addToast(`Phone number already registered with "${duplicate.name}"`, "error");
      return;
    }
    setSaving(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { error } = await supabase
        .from("customers")
        .update({ name: editName.trim(), phone: editPhone.trim(), address: editAddress.trim() || null })
        .eq("id", customerId);
      if (error) throw new Error(error.message);
      await useCustomersStore.getState().load();
      setEditing(false);
      addToast("Customer updated", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Could not update", "error");
    } finally {
      setSaving(false);
    }
  }

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
      <NavHeader title={customer.name} />

      {/* Profile hero — image left, data right, compact */}
      <div className="px-4 pt-4 pb-3 animate-fade-in-up">
        <div className="flex items-center gap-4">
          {isAdmin ? (
            <ImageUpload
              bucket="employee-photos"
              shape="circle"
              value={customer.imageUrl ?? null}
              onChange={handleImageChange}
              label="Photo"
            />
          ) : customer.imageUrl ? (
            <img src={customer.imageUrl} alt={customer.name} className="size-14 rounded-full object-cover shrink-0" />
          ) : (
            <div
              className="size-14 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
              style={{ background: initBg, color: "#fff" }}
            >
              {customer.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{customer.name}</p>
            <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{customer.phone}</p>
            {customer.address && (
              <p className="flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                <MapPin size={12} className="shrink-0" /> {customer.address}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <CreditHealthBadge health={health} />
              {isAdmin && (
                <button
                  onClick={startEdit}
                  className="flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-bold"
                  style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--divider)" }}
                >
                  <Pencil size={10} /> Edit
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Credit usage bar */}
        {customer.creditLimit > 0 && (
          <div className="mt-3">
            <div className="h-1.5 rounded-full w-full" style={{ background: "var(--divider)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${usagePct}%`,
                  background: health === "over_limit" ? "#ef4444" : health === "warning" ? "#f59e0b" : "#84cc16",
                }}
              />
            </div>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {usagePct}% {isUrdu ? "ادھار استعمال" : "credit used"}
            </p>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setEditing(false)}
        >
          <div
            className="w-full max-w-[390px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4"
            style={{ background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-bold text-center" style={{ color: "var(--text-primary)" }}>Edit Customer</p>
            <div>
              <p className="text-[11px] font-bold uppercase mb-1.5 tracking-wider" style={{ color: "var(--text-secondary)" }}>Name</p>
              <input value={editName} onChange={(e) => setEditName(e.target.value)}
                className="w-full h-11 rounded-full px-4 text-sm outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase mb-1.5 tracking-wider" style={{ color: "var(--text-secondary)" }}>Phone</p>
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} type="tel" inputMode="tel"
                className="w-full h-11 rounded-full px-4 text-sm outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase mb-1.5 tracking-wider" style={{ color: "var(--text-secondary)" }}>Address</p>
              <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)}
                className="w-full h-11 rounded-full px-4 text-sm outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditing(false)} className="flex-1 h-12 rounded-full text-sm font-bold"
                style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}>Cancel</button>
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 h-12 rounded-full text-sm font-bold disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}>{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}

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
