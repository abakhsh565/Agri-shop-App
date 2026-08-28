import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { useCustomersStore } from "@/stores/customersStore";
import { useUIStore } from "@/stores/uiStore";
import { formatCurrency, getCreditHealth } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { MapPin, CreditCard, Pencil, Trash2, History, Wallet, Receipt } from "lucide-react";

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
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));
  const updateCustomerImage = useCustomersStore((s) => s.updateCustomerImage);
  const { addToast } = useUIStore();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCreditLimit, setEditCreditLimit] = useState("");
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  function startEdit() {
    if (!customer) return;
    setEditName(customer.name);
    setEditPhone(customer.phone);
    setEditAddress(customer.address ?? "");
    setEditCreditLimit(customer.creditLimit > 0 ? String(customer.creditLimit) : "");
    setEditImageUrl(customer.imageUrl ?? null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!customerId || !customer) return;
    if (!editName.trim()) { addToast("Name is required", "error"); return; }
    if (!editPhone.trim()) { addToast("Phone is required", "error"); return; }
    const allCustomers = useCustomersStore.getState().customers;
    const duplicate = allCustomers.find((c) => c.phone === editPhone.trim() && c.id !== customerId && !c.isArchived);
    if (duplicate) {
      addToast(`Phone number already registered with "${duplicate.name}"`, "error");
      return;
    }
    setSaving(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const creditLim = editCreditLimit.trim() ? parseFloat(editCreditLimit.trim()) : 0;
      const { error } = await supabase
        .from("customers")
        .update({
          name: editName.trim(),
          phone: editPhone.trim(),
          address: editAddress.trim() || null,
          credit_limit: isNaN(creditLim) ? 0 : creditLim,
        })
        .eq("id", customerId);
      if (error) throw new Error(error.message);
      if (editImageUrl !== (customer.imageUrl ?? null)) {
        await updateCustomerImage(customerId, editImageUrl);
      }
      await useCustomersStore.getState().load();
      setEditing(false);
      addToast("Customer updated", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Could not update", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!customer) return null;

  const health = getCreditHealth(customer.outstandingBalance, customer.creditLimit);
  const initBg = initBgColor(customer.name);
  const usagePct = customer.creditLimit > 0
    ? Math.min(100, Math.round((customer.outstandingBalance / customer.creditLimit) * 100))
    : 0;

  const healthColor = health === "over_limit" ? "#ef4444" : health === "warning" ? "#f59e0b" : "#22c55e";
  const healthLabel = health === "over_limit" ? "Over Limit" : health === "warning" ? "Warning" : "Good";

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title="Customer Details" backTo={`${base}/customers`} />

      <div className="flex flex-col gap-4 px-4 pt-4 pb-8">
        {/* ── HERO CARD: Image + Name + Phone + Address + Health Badge ── */}
        <div
          className="rounded-[16px] p-4 flex gap-3 items-center"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <div className="shrink-0">
            {customer.imageUrl ? (
              <img src={customer.imageUrl} alt={customer.name} className="size-14 rounded-full object-cover" />
            ) : (
              <div
                className="size-14 rounded-full flex items-center justify-center text-xl font-bold"
                style={{ background: initBg, color: "#fff" }}
              >
                {customer.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold truncate" style={{ color: "var(--text-primary)" }}>{customer.name}</p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{customer.phone}</p>
            {customer.address && (
              <p className="flex items-center gap-1 text-[11px] truncate mt-0.5" style={{ color: "var(--text-secondary)" }}>
                <MapPin size={11} className="shrink-0" /> {customer.address}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ color: healthColor, background: healthColor + "22" }}
              >
                {healthLabel}
              </span>
            </div>
          </div>
        </div>

        {/* ── QUICK INFO: Total Purchases | Total Paid | Outstanding ── */}
        <div
          className="rounded-[14px] p-4 grid grid-cols-3 gap-3"
          style={{ border: "1px solid var(--divider)" }}
        >
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Purchases</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(customer.totalPurchases)}
            </p>
          </div>
          <div className="text-center" style={{ borderLeft: "1px solid var(--divider)", borderRight: "1px solid var(--divider)" }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Paid</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(customer.totalPaid)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Outstanding</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: customer.outstandingBalance > 0 ? "#d97706" : "var(--text-primary)" }}>
              {formatCurrency(customer.outstandingBalance)}
            </p>
          </div>
        </div>

        {/* ── CREDIT CARD: Limit + Progress Bar + Status ── */}
        {customer.creditLimit > 0 && (
          <div
            className="rounded-[14px] overflow-hidden"
            style={{ border: "1px solid var(--divider)" }}
          >
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--surface-2)" }}>
              <div className="flex items-center gap-2">
                <CreditCard size={14} style={{ color: "var(--brand)" }} />
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  Credit
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>Limit</p>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(customer.creditLimit)}</p>
                </div>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ color: healthColor, background: healthColor + "22" }}
                >
                  {healthLabel}
                </span>
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="h-2 rounded-full w-full" style={{ background: "var(--divider)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${usagePct}%`, background: healthColor }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {formatCurrency(customer.outstandingBalance)} of {formatCurrency(customer.creditLimit)} used
                </p>
                <p className="text-[11px] font-bold" style={{ color: healthColor }}>
                  {usagePct}%
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── ALL ACTIONS: Purchase History + Payment History + Record Payment + Edit + Delete ── */}
        <div
          className="rounded-[14px] overflow-hidden"
          style={{ border: "1px solid var(--divider)" }}
        >
          <button
            onClick={() => navigate(`${base}/customers/${customerId}/purchases`)}
            className="flex items-center gap-3 w-full px-4 py-3.5 text-left text-[13px] font-medium active:opacity-70"
            style={{ color: "var(--text-primary)" }}
          >
            <History size={16} style={{ color: "var(--brand)" }} />
            Purchase History
          </button>
          <button
            onClick={() => navigate(`${base}/customers/${customerId}/payments`)}
            className="flex items-center gap-3 w-full px-4 py-3.5 text-left text-[13px] font-medium active:opacity-70"
            style={{ color: "var(--text-primary)", borderTop: "1px solid var(--divider)" }}
          >
            <Wallet size={16} style={{ color: "var(--brand)" }} />
            Payment History
          </button>
          <button
            onClick={() => navigate(`${base}/customers/${customerId}/record-payment`)}
            className="flex items-center gap-3 w-full px-4 py-3.5 text-left text-[13px] font-medium active:opacity-70"
            style={{ color: "var(--brand-dark)", borderTop: "1px solid var(--divider)", background: "rgba(132,204,22,0.06)" }}
          >
            <Receipt size={16} style={{ color: "var(--brand-dark)" }} />
            Record Payment
          </button>
          <button
            onClick={startEdit}
            className="flex items-center gap-3 w-full px-4 py-3.5 text-left text-[13px] font-medium active:opacity-70"
            style={{ color: "var(--text-primary)", borderTop: "1px solid var(--divider)" }}
          >
            <Pencil size={16} style={{ color: "var(--brand)" }} />
            Edit Customer
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="flex items-center gap-3 w-full px-4 py-3.5 text-left text-[13px] font-medium active:opacity-70"
            style={{ color: "var(--error)", borderTop: "1px solid var(--divider)" }}
          >
            <Trash2 size={16} />
            Delete Customer
          </button>
        </div>
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
            <div className="flex justify-center">
              <ImageUpload
                bucket="customer-images"
                shape="circle"
                value={editImageUrl}
                onChange={setEditImageUrl}
                label="Photo"
              />
            </div>
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
            <div>
              <p className="text-[11px] font-bold uppercase mb-1.5 tracking-wider" style={{ color: "var(--text-secondary)" }}>Credit Limit (Rs.)</p>
              <input
                value={editCreditLimit}
                onChange={(e) => setEditCreditLimit(e.target.value)}
                type="number"
                inputMode="decimal"
                placeholder="0 for no limit"
                className="w-full h-11 rounded-full px-4 text-sm outline-none"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
              />
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

      {/* Delete confirmation modal */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setShowDelete(false)}>
          <div className="w-full max-w-[390px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4"
            style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-bold text-center" style={{ color: "var(--text-primary)" }}>Delete Customer</p>
            <p className="text-sm text-center" style={{ color: "var(--text-secondary)" }}>
              This will archive "{customer?.name}". Their transaction history will be preserved.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowDelete(false)} className="flex-1 h-12 rounded-full text-sm font-bold"
                style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}>Cancel</button>
              <button onClick={async () => {
                const { archiveCustomer } = useCustomersStore.getState();
                await archiveCustomer(customerId!);
                addToast("Customer deleted", "success");
                setShowDelete(false);
                navigate(`${base}/customers`);
              }} className="flex-1 h-12 rounded-full text-sm font-bold"
                style={{ background: "#ef4444", color: "#fff" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
