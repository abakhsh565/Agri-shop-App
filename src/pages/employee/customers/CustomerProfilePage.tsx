import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { useCustomersStore } from "@/stores/customersStore";
import { useUIStore } from "@/stores/uiStore";
import { useSalesStore } from "@/stores/salesStore";
import { fetchCustomerPayments } from "@/lib/db";
import type { CustomerPayment } from "@/types";
import { formatCurrency, calculateCreditHealth, getCreditHealthStatusColor } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { History, Wallet, Bell, Pencil, Trash2, Receipt, Plus } from "lucide-react";
import { getRecommendationsForCustomer, KNOWN_CROPS } from "@/lib/recommendationEngine";
import { loadReminderConfigs, saveReminderConfig as saveReminderConfigToDb, loadCustomerCrops, saveCustomerCrops as saveCustomerCropsToDb, loadBusinessSettings, calculatePaymentStatus, getPaymentStatusLabel, getPaymentStatusColor } from "@/lib/reminderEngine";
import { useProductsStore } from "@/stores/productsStore";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ReminderConfigSheet from "@/components/ui/ReminderConfigSheet";
import type { ReminderConfig, BusinessSettings, CropConfig } from "@/types";

function initBgColor(name: string) {
  const colors = ["#ec1e79","#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function CustomerProfilePage() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));
  const allCustomers = useCustomersStore((s) => s.customers);
  const updateCustomerImage = useCustomersStore((s) => s.updateCustomerImage);

  useEffect(() => {
    async function loadBiz() {
      try {
        const s = await loadBusinessSettings();
        setBusinessSettings(s);
      } catch {}
    }
    loadBiz();
  }, []);
  const { addToast } = useUIStore();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCreditLimit, setEditCreditLimit] = useState("");
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [editCrops, setEditCrops] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const sales = useSalesStore((s) => s.sales);
  const [deleting, setDeleting] = useState(false);
  const [showReminderConfig, setShowReminderConfig] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ReminderConfig | null>(null);
  const [reminderConfigs, setReminderConfigs] = useState<ReminderConfig[]>([]);
  const [showEditDueDate, setShowEditDueDate] = useState(false);
  const [editDueDate, setEditDueDate] = useState("");
  const [customerCrops, setCustomerCrops] = useState<string[]>([]);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>({ crops: [] });

  useEffect(() => {
    if (!customerId) return;
    async function loadData() {
      try {
        const crops = await loadCustomerCrops(customerId!);
        setCustomerCrops(crops);
        const configs = await loadReminderConfigs(customerId!);
        setReminderConfigs(configs);
      } catch {}
    }
    loadData();
  }, [customerId]);

  async function saveReminderConfig(cfg: ReminderConfig) {
    try {
      await saveReminderConfigToDb(customerId!, cfg);
      const configs = await loadReminderConfigs(customerId!);
      setReminderConfigs(configs);
      setShowReminderConfig(false);
      addToast("Reminder saved", "success");
    } catch { addToast("Failed to save reminder", "error"); }
  }

  async function handleDeleteReminder(configId: string) {
    try {
      const { deleteReminderConfig } = await import("@/lib/reminderEngine");
      await deleteReminderConfig(configId);
      const configs = await loadReminderConfigs(customerId!);
      setReminderConfigs(configs);
      addToast("Reminder deleted", "success");
    } catch { addToast("Failed to delete reminder", "error"); }
  }

  async function handleSaveDueDate() {
    try {
      const { updateDueDate } = useCustomersStore.getState();
      await updateDueDate(customerId!, editDueDate || null);
      setShowEditDueDate(false);
      addToast(editDueDate ? "Due date updated" : "Due date removed", "success");
    } catch { addToast("Failed to update due date", "error"); }
  }

  function startEdit() {
    if (!customer) return;
    setEditName(customer.name);
    setEditPhone(customer.phone);
    setEditAddress(customer.address ?? "");
    setEditCreditLimit(customer.creditLimit > 0 ? String(customer.creditLimit) : "");
    setEditImageUrl(customer.imageUrl ?? null);
    setEditCrops([...customerCrops]);
    setEditing(true);
  }

  async function saveEdit() {
    if (!customerId || !customer) return;
    if (!editName.trim()) { addToast("Name is required", "error"); return; }
    if (!editPhone.trim()) { addToast("Phone is required", "error"); return; }
    const allCustomers = useCustomersStore.getState().customers;
    const duplicate = allCustomers.find((c) => c.phone === editPhone.trim() && c.id !== customerId && !c.isArchived);
    if (duplicate) {
      addToast("Phone number already registered with \"" + duplicate.name + "\"", "error");
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
      await saveCustomerCropsToDb(customerId, editCrops);
      setCustomerCrops([...editCrops]);
      await useCustomersStore.getState().load();
      setEditing(false);
      addToast("Customer updated", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Could not update", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!customerId) return;
    setDeleting(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { error } = await supabase.from("customers").delete().eq("id", customerId);
      if (error) throw new Error(error.message);
      await useCustomersStore.getState().load();
      addToast("Customer deleted", "success");
      navigate(base + "/customers", { replace: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Could not delete", "error");
    } finally {
      setDeleting(false);
      setShowDelete(false);
    }
  }

  useEffect(() => {
    if (!customerId) return;
    let active = true;
    fetchCustomerPayments(customerId).then((rows) => { if (active) setPayments(rows); }).catch(() => {});
    return () => { active = false; };
  }, [customerId]);

  if (!customer) return null;

  const initBg = initBgColor(customer.name);
  const usagePct = customer.creditLimit > 0
    ? Math.min(100, Math.round((customer.outstandingBalance / customer.creditLimit) * 100))
    : 0;

  const lastPaymentAt = payments.length > 0 ? payments[0].createdAt : null;
  const customerSales = sales.filter((s) => s.customerId === customerId);
  const salesCount = customerSales.length;
  const fullPaymentSalesTotal = customerSales.filter((s) => s.paymentType === "full").reduce((a, s) => a + s.totalAmount, 0);
  const effectivePaid = customer.totalPaid + fullPaymentSalesTotal;
  const hasCreditActivity = customerSales.some((s) => s.paymentType !== "full");
  const creditHealth = calculateCreditHealth(customer, salesCount, lastPaymentAt, effectivePaid, hasCreditActivity);

  // Risk pill
  const paymentStatus = calculatePaymentStatus(customer, new Date());
  const riskDot = getPaymentStatusColor(paymentStatus).color;
  const riskBg = getPaymentStatusColor(paymentStatus).bg;
  const riskTextColor = getPaymentStatusColor(paymentStatus).color;
  const riskLabel = getPaymentStatusLabel(paymentStatus);

  // Credit bar color
  const utilColor = usagePct >= 80 ? "#ef4444" : usagePct >= 50 ? "#f59e0b" : "#639922";



  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title="Customer details" />

      <div className="flex flex-col gap-3.5 px-4 pt-3 pb-8">

        {/* ═══════════════════════════════════════════
            1. HERO CARD — Avatar, Name, Phone, Risk pill
           ═══════════════════════════════════════════ */}
        <div
          className="rounded-[16px] p-4 flex gap-3 items-start"
          style={{ background: "#F6F5F1" }}
        >
          <div className="shrink-0">
            {customer.imageUrl ? (
              <img src={customer.imageUrl} alt={customer.name} className="size-[52px] rounded-full object-cover" />
            ) : (
              <div
                className="size-[52px] rounded-full flex items-center justify-center text-[20px] font-medium"
                style={{ background: initBg, color: "#fff" }}
              >
                {customer.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-medium truncate" style={{ color: "#1A1A1A" }}>{customer.name}</p>
            <p className="text-[13px] mt-0.5" style={{ color: "#8A8A85" }}>
              {customer.phone}{customer.address ? " \u00a0\u00b7\u00a0 " + customer.address : ""}
            </p>
            <div
              className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full"
              style={{ background: riskBg }}
            >
              <div className="size-1.5 rounded-full" style={{ background: riskDot }} />
              <span className="text-[12px] font-medium" style={{ color: riskTextColor }}>
                {riskLabel}
              </span>
            </div>

            {customerCrops.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {customerCrops.map((crop: string) => (
                  <span key={crop} className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(99,153,34,0.12)", color: "#3B6D11" }}>{crop}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            2. QUICK STATS — Purchases | Paid | Outstanding
           ═══════════════════════════════════════════ */}
        <div
          className="flex rounded-[16px] overflow-hidden"
          style={{ border: "0.5px solid #E5E4DE", background: "#fff" }}
        >
          <div className="flex-1 text-center py-3.5" style={{ borderRight: "0.5px solid #E5E4DE" }}>
            <p className="text-[10px] tracking-[0.5px] font-medium" style={{ color: "#8A8A85" }}>PURCHASES</p>
            <p className="text-[15px] font-bold mt-1" style={{ color: "#1A1A1A" }}>
              {formatCurrency(customer.totalPurchases || customerSales.reduce((a, s) => a + s.totalAmount, 0))}
            </p>
          </div>
          <div className="flex-1 text-center py-3.5" style={{ borderRight: "0.5px solid #E5E4DE" }}>
            <p className="text-[10px] tracking-[0.5px] font-medium" style={{ color: "#8A8A85" }}>PAID</p>
            <p className="text-[15px] font-bold mt-1" style={{ color: "#1A1A1A" }}>
              {formatCurrency(effectivePaid)}
            </p>
          </div>
          <div className="flex-1 text-center py-3.5">
            <p className="text-[10px] tracking-[0.5px] font-medium" style={{ color: "#8A8A85" }}>OUTSTANDING</p>
            <p className="text-[15px] font-bold mt-1" style={{ color: "#D97706" }}>
              {formatCurrency(customer.outstandingBalance)}
            </p>
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            3. CREDIT CARD — Limit, bar, utilization
           ═══════════════════════════════════════════ */}
        <div
          className="rounded-[16px] p-4"
          style={{ background: "#F6F5F1" }}
        >
          {/* Credit Limit — horizontal alignment */}
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium tracking-[0.5px]" style={{ color: "#5A5A55" }}>CREDIT LIMIT</span>
            <span className="text-[15px] font-bold" style={{ color: "#1A1A1A" }}>
              {customer.creditLimit > 0 ? formatCurrency(customer.creditLimit) : "\u2014"}
            </span>
          </div>

          {/* Progress bar */}
          {customer.creditLimit > 0 && (
            <>
              <div className="h-[6px] rounded-full mt-3 overflow-hidden" style={{ background: "#E5E4DE" }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: usagePct + "%", background: utilColor }}
                />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-[11px]" style={{ color: "#8A8A85" }}>
                  {formatCurrency(customer.outstandingBalance)} of {formatCurrency(customer.creditLimit)} used
                </span>
                <span className="text-[11px] font-bold" style={{ color: "#3B6D11" }}>{usagePct}%</span>
              </div>
            </>
          )}

          {/* Due Date */}
          <div className="mt-3 pt-3" style={{ borderTop: "0.5px solid #E5E4DE" }}>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-[11px] font-medium tracking-wider" style={{ color: "#8A8A85" }}>DUE DATE</p>
                <p className="text-[14px] font-bold mt-0.5" style={{ color: customer.dueDate ? "#1A1A1A" : "#8A8A85" }}>
                  {customer.dueDate ? new Date(customer.dueDate).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "Not set"}
                </p>
              </div>
              <button onClick={() => { setEditDueDate(customer.dueDate || ""); setShowEditDueDate(true); }} className="text-[12px] font-semibold px-3 py-1.5 rounded-full" style={{ background: "#F1EFE8", color: "#5A5A55" }}>
                {customer.dueDate ? "Edit" : "Set"}
              </button>
            </div>
          </div>
          {/* Reminder schedules */}
          <div className="mt-3 pt-3" style={{ borderTop: "0.5px solid #E5E4DE" }}>
            <div className="flex justify-between items-center mb-2">
              <p className="text-[11px] font-medium tracking-wider" style={{ color: "#8A8A85" }}>REMINDERS</p>
              <button onClick={() => { setEditingConfig(null); setShowReminderConfig(true); }} className="text-[12px] font-semibold px-3 py-1.5 rounded-full" style={{ background: "#F1EFE8", color: "#5A5A55" }}>+ Add</button>
            </div>
            {reminderConfigs.length === 0 ? (
              <p className="text-[12px] py-1" style={{ color: "#8A8A85" }}>No reminders configured</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {reminderConfigs.map((cfg: ReminderConfig) => (
                  <div key={cfg.id} className="flex items-center justify-between py-2 px-2 rounded-lg" style={{ background: "rgba(99,153,34,0.05)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium" style={{ color: "#1A1A1A" }}>
                        {cfg.startDays}d {cfg.anchor === "after_credit" ? "after credit" : cfg.anchor === "after_due" ? "after due date" : cfg.anchor === "before_due" ? "before due date" : "before harvest"}
                      </p>
                      <p className="text-[11px]" style={{ color: "#8A8A85" }}>
                        {cfg.repeat === "once" ? "One-time" : cfg.repeat === "interval" ? "Every " + cfg.intervalN + " " + cfg.intervalUnit : "Escalating"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditingConfig(cfg); setShowReminderConfig(true); }} className="p-1"><Pencil size={14} color="#8A8A85" /></button>
                      <button onClick={() => handleDeleteReminder(cfg.id)} className="p-1"><Trash2 size={14} color="#D64545" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            4. RECOMMENDED PRODUCTS
           ═══════════════════════════════════════════ */}
        <RecommendedSection customerId={customerId} />
        <div
          className="rounded-[16px] overflow-hidden"
          style={{ border: "0.5px solid #E5E4DE", background: "#fff" }}
        >
          {/* Purchase History */}
          <button
            onClick={() => navigate(base + "/customers/" + customerId + "/purchases")}
            className="w-full flex items-center gap-3 px-4 py-3.5"
            style={{ borderBottom: "0.5px solid #E5E4DE" }}
          >
            <History size={18} color="#639922" />
            <span className="flex-1 text-left text-[14px]" style={{ color: "#1A1A1A" }}>Purchase History</span>
          </button>

          {/* Payment History */}
          <button
            onClick={() => navigate(base + "/customers/" + customerId + "/payments")}
            className="w-full flex items-center gap-3 px-4 py-3.5"
            style={{ borderBottom: "0.5px solid #E5E4DE" }}
          >
            <Wallet size={18} color="#639922" />
            <span className="flex-1 text-left text-[14px]" style={{ color: "#1A1A1A" }}>Payment History</span>
          </button>

          {/* Reminder History */}
          <button
            onClick={() => navigate(base + "/customers/" + customerId + "/reminders")}
            className="w-full flex items-center gap-3 px-4 py-3.5"
            style={{ borderBottom: "0.5px solid #E5E4DE" }}
          >
            <Bell size={18} color="#639922" />
            <span className="flex-1 text-left text-[14px]" style={{ color: "#1A1A1A" }}>Reminder History</span>
          </button>

          {/* Record Payment — green highlight */}
          <button
            onClick={() => navigate(base + "/customers/" + customerId + "/record-payment")}
            className="w-full flex items-center gap-3 px-4 py-3.5"
            style={{ borderBottom: "0.5px solid #E5E4DE", background: "#F2F8EC" }}
          >
            <Receipt size={18} color="#3B6D11" />
            <span className="flex-1 text-left text-[14px] font-medium" style={{ color: "#3B6D11" }}>Record Payment</span>
          </button>

          {/* Edit Customer */}
          <button
            onClick={startEdit}
            className="w-full flex items-center gap-3 px-4 py-3.5"
            style={{ borderBottom: "0.5px solid #E5E4DE" }}
          >
            <Pencil size={18} color="#639922" />
            <span className="flex-1 text-left text-[14px]" style={{ color: "#1A1A1A" }}>Edit Customer</span>
          </button>

          {/* Delete Customer */}
          <button
            onClick={() => setShowDelete(true)}
            className="w-full flex items-center gap-3 px-4 py-3.5"
          >
            <Trash2 size={18} color="#D64545" />
            <span className="flex-1 text-left text-[14px]" style={{ color: "#D64545" }}>Delete Customer</span>
          </button>
        </div>

      </div>

      {/* ═══════════════════════════════════════════
          MODALS / SHEETS
         ═══════════════════════════════════════════ */}

      {/* Reminder Config Sheet */}
      {showReminderConfig && (
        <ReminderConfigSheet
          config={editingConfig}
          onSave={saveReminderConfig}
          onClose={() => setShowReminderConfig(false)}
        />
      )}

      {/* Edit Customer Modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setEditing(false)}
        >
          <div
            className="w-full max-w-[400px] rounded-t-2xl sm:rounded-2xl p-5 flex flex-col gap-4"
            style={{ background: "var(--surface)", maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Edit Customer</p>

            {/* Image on top */}
            <div className="flex justify-center">
              <ImageUpload bucket="customer-images" value={editImageUrl} onChange={setEditImageUrl} shape="circle" label="Profile Photo" />
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: "var(--text-secondary)" }}>Name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)", borderRadius: "24px" }}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: "var(--text-secondary)" }}>Phone</label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)", borderRadius: "24px" }}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: "var(--text-secondary)" }}>Address</label>
                <input
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)", borderRadius: "24px" }}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: "var(--text-secondary)" }}>Crops</label>
                <div className="flex flex-wrap gap-2">
                  {(businessSettings.crops.length > 0 ? businessSettings.crops.map(c => c.name) : KNOWN_CROPS).map(cropName => (
                    <button key={cropName} type="button" onClick={() => setEditCrops(prev => prev.includes(cropName) ? prev.filter(c => c !== cropName) : [...prev, cropName])} className="h-9 px-4 rounded-full text-[12px] font-medium transition-colors" style={{ background: editCrops.includes(cropName) ? "var(--brand)" : "var(--surface-2)", color: editCrops.includes(cropName) ? "#0a0a0a" : "var(--text-secondary)", border: editCrops.includes(cropName) ? "none" : "1px solid var(--divider)" }}>{cropName}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: "var(--text-secondary)" }}>Credit Limit (Rs.)</label>
                <input
                  type="number"
                  value={editCreditLimit}
                  onChange={(e) => setEditCreditLimit(e.target.value)}
                  className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)", borderRadius: "24px" }}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-1">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 h-11 rounded-full text-sm font-medium"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex-1 h-11 rounded-full text-sm font-bold"
                style={{ background: "var(--brand)", color: "#0a0a0a", opacity: saving ? 0.6 : 1 }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Due Date Edit Bottom Sheet */}
      {showEditDueDate && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowEditDueDate(false)}>
          <div className="w-full max-w-[400px] mx-auto rounded-t-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-1 pb-0"><div className="w-10 h-1 rounded-full" style={{ background: 'var(--divider)' }} /></div>
            <p className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>Payment Due Date</p>
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Set the date by which the customer should pay their outstanding balance.</p>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Due Date</label>
              <input type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} className="w-full h-12 rounded-[24px] px-4 text-sm outline-none" style={{ background: 'var(--surface-2)', border: '1px solid var(--divider)', color: 'var(--text-primary)', borderRadius: '24px' }} />
            </div>
            <div className="flex gap-3 mt-1">
              <button onClick={() => setShowEditDueDate(false)} className="flex-1 h-11 rounded-full text-sm font-medium" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>Cancel</button>
              <button onClick={handleSaveDueDate} className="flex-1 h-11 rounded-full text-sm font-bold" style={{ background: 'var(--brand)', color: '#0a0a0a' }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={showDelete}
        title="Delete Customer"
        message={"Are you sure you want to delete \"" + customer.name + "\"? This cannot be undone."}
        confirmLabel={deleting ? "Deleting..." : "Delete"}
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
        destructive
        loading={deleting}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   RecommendedSection — suggests products for this customer
   based on crop + basket gaps + season timing
   ═══════════════════════════════════════════════════════ */
function RecommendedSection({ customerId }: { customerId: string | undefined }) {
  if (!customerId) return null;
  const customers = useCustomersStore((s) => s.customers);
  const products = useProductsStore((s) => s.products);
  const productsReady = useProductsStore((s) => s.ready);
  const sales = useSalesStore((s) => s.sales);
  const [cropsMap, setCropsMap] = useState<Record<string, string[]>>({});

  // Load crops from Supabase for all customers
  useEffect(() => {
    if (!productsReady) useProductsStore.getState().load();
    loadCustomerCrops(customerId).then(crops => {
      setCropsMap(prev => ({ ...prev, [customerId]: crops }));
    });
  }, [productsReady, customerId]);

  const customer = customers.find((c) => c.id === customerId);
  if (!customer || !productsReady || products.length === 0) return null;

  const recs = getRecommendationsForCustomer(customer, { customers, sales, products, customerCropsMap: cropsMap });
  if (recs.length === 0) return null;

  const PRODUCT_ICONS: Record<string, string> = {
    spray: "\uD83D\uDD2C",
    seed: "\uD83C\uDF31",
    fertilizer: "\uD83C\uDF3F",
    other: "\uD83D\uDCE6",
  };

  return (
    <div className="rounded-[16px] p-4" style={{ background: "#F6F5F1" }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "#5A5A55" }}>
        RECOMMENDED FOR {customer.name.split(" ")[0].toUpperCase()}
      </p>
      <div className="flex flex-col">
        {recs.map((rec, i) => (
          <div
            key={rec.product.id}
            className="flex items-center gap-3 py-3"
            style={{ borderBottom: i < recs.length - 1 ? "0.5px solid #E5E4DE" : "none" }}
          >
            <div
              className="size-10 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "#E8F5E0" }}
            >
              <span className="text-[16px]">{PRODUCT_ICONS[rec.product.category] || "\uD83D\uDCE6"}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium" style={{ color: "#1A1A1A" }}>
                {rec.product.name}
              </p>
              <p className="text-[12px] mt-0.5" style={{ color: "#8A8A85" }}>
                {rec.reason}
              </p>
            </div>
            <button
              className="size-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "#E8F5E0" }}
              onClick={() => {
                const phone = (customer.phone || '').replace(/[^0-9+]/g, '');
                const waPhone = phone.startsWith('+') ? phone.slice(1) : phone.startsWith('0') ? '92' + phone.slice(1) : phone;
                const firstName = customer.name.split(' ')[0];
                let msg = '';
                if (rec.reasonTag === 'missing_from_basket') {
                  msg = `Hi ${firstName}, the ${rec.product.name} is needed for your ${rec.cropName} season but we haven't seen an order yet. Would you like me to set one aside for you?`;
                } else if (rec.reasonTag === 'due_again') {
                  msg = `Hi ${firstName}, it's been a while since your last ${rec.product.name} order for ${rec.cropName}. Time to restock?`;
                } else {
                  msg = `Hi ${firstName}, ${rec.product.name} is in season for your ${rec.cropName} — thought you might need it.`;
                }
                window.open('https://wa.me/' + waPhone + '?text=' + encodeURIComponent(msg), '_blank');
              }}
            >
              <Plus size={16} color="#3B6D11" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
