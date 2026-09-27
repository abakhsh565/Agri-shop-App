import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { useCustomersStore } from "@/stores/customersStore";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useSalesStore } from "@/stores/salesStore";
import { fetchCustomerPayments, rpcArchiveCustomer } from "@/lib/db";
import type { CustomerPayment } from "@/types";
import { formatCurrency, calculateCreditHealth, getCreditHealthStatusColor } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { History, Wallet, Bell, Pencil, Trash2, Receipt, Plus, Package } from "lucide-react";
import { getRecommendationsForCustomer, KNOWN_CROPS, type CustomerCropRecord, type RecommendationReason } from "@/lib/recommendationEngine";
import { loadReminderConfigs, saveReminderConfig as saveReminderConfigToDb, loadCustomerCrops, loadCustomerCropRows, saveCustomerCrops as saveCustomerCropsToDb, loadBusinessSettings, calculatePaymentStatus, getPaymentStatusLabel, getPaymentStatusColor, isDuplicateReminder } from "@/lib/reminderEngine";
import WhyRecommended from "@/components/recommendations/WhyRecommended";
import { useProductsStore } from "@/stores/productsStore";
import { SkeletonList } from "@/components/ui/Skeleton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import CreditLimitSheet from "@/components/customers/CreditLimitSheet";
import ReminderConfigSheet from "@/components/ui/ReminderConfigSheet";
import type { ReminderConfig, BusinessSettings, CropConfig } from "@/types";

function initBgColor(name: string | null | undefined) {
  const colors = ["#ec1e79","#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4"];
  let hash = 0;
  if (!name) return colors[0];
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
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin" || user?.role === "co_admin";

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
  const customersReady = useCustomersStore((s) => s.ready);
  const [deleting, setDeleting] = useState(false);
  const [showReminderConfig, setShowReminderConfig] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ReminderConfig | null>(null);
  const [reminderConfigs, setReminderConfigs] = useState<ReminderConfig[]>([]);
  const [showEditDueDate, setShowEditDueDate] = useState(false);
  const [editDueDate, setEditDueDate] = useState("");
  const [customerCrops, setCustomerCrops] = useState<string[]>([]);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>({ crops: [] });
  const [showLimitSheet, setShowLimitSheet] = useState(false);
  const [savingLimit, setSavingLimit] = useState(false);
  const setCreditLimit = useCustomersStore((s) => s.setCreditLimit);

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
      // Duplicate check
      if (isDuplicateReminder(cfg, reminderConfigs)) {
        addToast(t("reminder.duplicateExists"), "error");
        return;
      }
      await saveReminderConfigToDb(customerId!, cfg);
      const configs = await loadReminderConfigs(customerId!);
      setReminderConfigs(configs);
      setShowReminderConfig(false);
      addToast(t("customerProfile.reminderSaved"), "success");
    } catch { addToast(t("customerProfile.reminderSaveFailed"), "error"); }
  }

  async function handleDeleteReminder(configId: string) {
    try {
      const { deleteReminderConfig } = await import("@/lib/reminderEngine");
      await deleteReminderConfig(configId);
      const configs = await loadReminderConfigs(customerId!);
      setReminderConfigs(configs);
      addToast(t("customerProfile.reminderDeleted"), "success");
    } catch { addToast(t("customerProfile.reminderDeleteFailed"), "error"); }
  }

  async function handleSetCreditLimit(value: number) {
    if (!customer || savingLimit) return;
    setSavingLimit(true);
    try {
      // One write path for this column: the permission-checked, audited RPC. The customer
      // edit form used to write it straight to the table, which is how a limit could move
      // with nothing in the audit trail and no cache refresh behind it.
      const applied = await setCreditLimit(customer.id, value);
      setShowLimitSheet(false);
      addToast(t("sale.creditLimitSet", { amount: formatCurrency(applied) }), "success");
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("sale.creditLimitFailed"), "error");
    } finally {
      setSavingLimit(false);
    }
  }

  async function handleSaveDueDate() {
    // Reject past dates on frontend
    if (editDueDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (new Date(editDueDate) < today) {
        addToast(t("customerProfile.dueDatePastError"), "error");
        return;
      }
    }
    try {
      const { updateDueDate } = useCustomersStore.getState();
      await updateDueDate(customerId!, editDueDate || null);
      setShowEditDueDate(false);
      addToast(editDueDate ? t("customerProfile.dueDateUpdated") : t("customerProfile.dueDateRemoved"), "success");
    } catch { addToast(t("customerProfile.dueDateUpdateFailed"), "error"); }
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
    if (!editName.trim()) { addToast(t("customerProfile.nameRequired"), "error"); return; }
    if (!editPhone.trim()) { addToast(t("customerProfile.phoneRequired"), "error"); return; }
    const allCustomers = useCustomersStore.getState().customers;
    const duplicate = allCustomers.find((c) => c.phone === editPhone.trim() && c.id !== customerId && !c.isArchived);
    if (duplicate) {
      addToast(t("customerProfile.phoneAlreadyRegistered") + "\"" + duplicate.name + "\"", "error");
      return;
    }
    setSaving(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const creditLim = editCreditLimit.trim() ? parseFloat(editCreditLimit.trim()) : 0;
      // Note what this does NOT do: write the limit. The column has one owner — the
      // `Set limit` / `Change limit` action on the customer card, through the audited RPC.
      const creditLimitChanged = !isNaN(creditLim) && creditLim !== customer.creditLimit;
      
      // Employee: submit credit limit request instead of direct edit
      if (creditLimitChanged && !isAdmin) {
        const { requestCreditLimitIncrease } = useCustomersStore.getState();
        await requestCreditLimitIncrease({
          customerId: customerId!,
          customerName: customer.name,
          currentLimit: customer.creditLimit,
          requestedLimit: creditLim,
          requestedBy: user?.name || user?.id || "Unknown",
        });
        addToast("Credit limit request submitted for approval", "success");
      }
      
      const { error } = await supabase
        .from("customers")
        .update({
          name: editName.trim(),
          phone: editPhone.trim(),
          address: editAddress.trim() || null,
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
      addToast(t("customerProfile.customerUpdated"), "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : t("customerProfile.couldNotUpdate"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!customerId) return;
    setDeleting(true);
    try {
      await rpcArchiveCustomer(customerId);
      // Remove from local store + invalidate cache immediately
      // (load() may fail with 401 if session expired, but archive succeeded)
      const store = useCustomersStore.getState();
      const remaining = store.customers.filter((c) => c.id !== customerId);
      useCustomersStore.setState({ customers: remaining });
      // Also update cache to prevent stale data from reappearing on navigation
      try {
        const { setCachedData } = await import("@/lib/localCache");
        setCachedData("customers", remaining);
      } catch { /* cache update non-critical */ }
      addToast(t("customerProfile.customerDeleted"), "success");
      navigate(base + "/customers", { replace: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : t("customerProfile.couldNotDelete"), "error");
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

  if (!customer) return customersReady ? null : <SkeletonList rows={4} />;

  const initBg = initBgColor(customer.name);
  const usagePct = customer.creditLimit > 0
    ? Math.min(100, Math.round((customer.outstandingBalance / customer.creditLimit) * 100))
    : 0;

  const lastPaymentAt = payments.length > 0 ? payments[0].createdAt : null;
  const customerSales = sales.filter((s) => s.customerId === customerId);
  const salesCount = customerSales.length;
  // `customer.totalPaid` is the whole of what this person has paid: money taken at the
  // counter on a sale is part of it since migration 0155, so adding the value of every
  // "full" sale on top of it — which this did to compensate for the column being short —
  // would count those sales twice.
  const hasCreditActivity = customerSales.some((s) => s.paymentType !== "full");
  const creditHealth = calculateCreditHealth(customer, salesCount, lastPaymentAt, customer.totalPaid, hasCreditActivity);
  // How far past their limit this customer sits right now, if at all.
  const overLimitBy = customer.creditLimit > 0 ? Math.max(0, customer.outstandingBalance - customer.creditLimit) : 0;

  // Risk pill
  const paymentStatus = calculatePaymentStatus(customer, new Date());
  const riskDot = getPaymentStatusColor(paymentStatus).color;
  const riskBg = getPaymentStatusColor(paymentStatus).bg;
  const riskTextColor = getPaymentStatusColor(paymentStatus).color;
  const riskLabel = getPaymentStatusLabel(paymentStatus, t);

  // Credit bar color
  const utilColor = usagePct >= 80 ? "#ef4444" : usagePct >= 50 ? "#f59e0b" : "#639922";



  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("customerProfile.title")} />

      <div className="flex flex-col gap-3.5 px-4 pt-3 pb-8">

        {/* ═══════════════════════════════════════════
            1. HERO CARD — Avatar, Name, Phone · Town · Crop, Status pill

            Four facts, in the order they are read out loud: who this is, how to reach
            them, where they farm and what they grow, then how they are paying. The name
            leads and is the only bold thing here, so the card answers "whose page am I on"
            before anything else. The crops used to sit under the phone as a row of chips of
            their own, which made three lines of what is one sentence — a phone, a place and
            a crop are the same kind of fact about the same person, so they share a line and
            are separated by the same dot.
           ═══════════════════════════════════════════ */}
        <div className="ds-card flex items-center gap-3.5">
          <div className="shrink-0">
            {customer.imageUrl ? (
              <img src={customer.imageUrl} alt={customer.name} className="size-[60px] rounded-full object-cover" />
            ) : (
              <div
                className="size-[60px] rounded-full flex items-center justify-center text-22 font-bold"
                style={{ background: initBg, color: "#fff" }}
              >
                {customer.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-20 font-bold truncate" style={{ color: "var(--text-primary)" }}>{customer.name}</p>
            {/* `filter(Boolean)` and then `join` — so a customer with no address yet reads
                "0300… · Cotton" rather than "0300… ·  · Cotton" with a gap where the missing
                fact would have been. */}
            <p className="text-13 mt-1 truncate" style={{ color: "var(--text-secondary)" }}>
              {[customer.phone, customer.address, customerCrops.join(", ")].filter(Boolean).join(" \u00b7 ")}
            </p>
            <div
              className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1 rounded-full"
              style={{ background: riskBg }}
            >
              <div className="size-1.5 rounded-full" style={{ background: riskDot }} />
              <span className="text-13 font-medium" style={{ color: riskTextColor }}>
                {riskLabel}
              </span>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            2. QUICK STATS — Purchases | Paid | Outstanding
           ═══════════════════════════════════════════ */}          <div
          className="flex overflow-hidden rounded-[var(--radius-card)]"
          style={{ background: "var(--tone-card)" }}
        >
          <div className="flex-1 text-center py-3.5" style={{ borderRight: "1px solid var(--divider)" }}>
            <p className="text-10 tracking-[0.5px] font-medium" style={{ color: "var(--text-secondary)" }}>{t("customerProfile.purchases")}</p>
            <p className="text-15 font-bold mt-1" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(customer.totalPurchases || customerSales.reduce((a, s) => a + s.totalAmount, 0))}
            </p>
          </div>
          <div className="flex-1 text-center py-3.5" style={{ borderRight: "1px solid var(--divider)" }}>
            <p className="text-10 tracking-[0.5px] font-medium" style={{ color: "var(--text-secondary)" }}>{t("customerProfile.paid")}</p>              <p className="text-15 font-bold mt-1" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(customer.totalPaid || 0)}
            </p>
          </div>
          <div className="flex-1 text-center py-3.5">
            <p className="text-10 tracking-[0.5px] font-medium" style={{ color: "var(--text-secondary)" }}>{t("customerProfile.outstanding")}</p>
            <p className="text-15 font-bold mt-1" style={{ color: "#D97706" }}>
              {formatCurrency(customer.outstandingBalance)}
            </p>
          </div>
        </div>

        {/* ═══════════════════════════════════════════
            3. CREDIT CARD — Limit, bar, utilization
           ═══════════════════════════════════════════ */}
        <div className="ds-card">
          {/* Credit Limit — horizontal alignment */}
          {/* The limit and the way to change it sit together, because they are one thought:
              the number is on the right, and the action names what it will do to *this*
              customer — "Set limit" when there is none, "Change limit" when there is. */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-12 font-medium tracking-[0.5px]" style={{ color: "var(--text-secondary)" }}>{t("customerProfile.creditLimit")}</span>
            <div className="flex items-center gap-2">
              <span className="text-15 font-bold" style={{ color: "var(--text-primary)" }}>
                {customer.creditLimit > 0 ? formatCurrency(customer.creditLimit) : "\u2014"}
              </span>
              {isAdmin && (
                <button
                  onClick={() => setShowLimitSheet(true)}
                  className="text-12 font-semibold px-3 py-1.5 rounded-full"
                  style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
                  data-testid="credit-limit-action"
                >
                  {customer.creditLimit > 0 ? t("customers.changeLimit") : t("customers.setLimit")}
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {customer.creditLimit > 0 && (
            <>
              <div className="h-[6px] rounded-full mt-3 overflow-hidden" style={{ background: "var(--divider)" }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: usagePct + "%", background: utilColor }}
                />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-11" style={{ color: "var(--text-secondary)" }}>
                  {formatCurrency(customer.outstandingBalance)} {t("customerProfile.of")} {formatCurrency(customer.creditLimit)} {t("customerProfile.used")}
                </span>
                <span className="text-11 font-bold" style={{ color: "var(--brand-dark)" }}>{usagePct}%</span>
              </div>
              {/* A customer can sit past their limit: a limit lowered under an existing debt
                  is allowed (0154), and that is a state the shop has to be able to see. */}
              {overLimitBy > 0 && (
                <p className="text-11 font-semibold mt-1" style={{ color: "var(--error)" }} data-testid="over-limit-line">
                  {t("sale.overLimitBy", { amount: formatCurrency(overLimitBy) })}
                </p>
              )}
            </>
          )}

          {/* Due Date */}
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--hairline)" }}>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-11 font-medium tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("customerProfile.dueDate")}</p>
                <p className="text-14 font-bold mt-0.5" style={{ color: customer.dueDate ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {customer.dueDate ? new Date(customer.dueDate).toLocaleDateString(isUrdu ? "ur-PK" : "en-PK", { day: "numeric", month: "short", year: "numeric" }) : t("common.notSet")}
                </p>
              </div>
              <button onClick={() => { setEditDueDate(customer.dueDate || ""); setShowEditDueDate(true); }} className="text-12 font-semibold px-3 py-1.5 rounded-full" style={{ background: "var(--surface-2)", color: "#5A5A55" }}>
                {customer.dueDate ? t("customerProfile.edit") : t("common.save")}
              </button>
            </div>
          </div>
          {/* Reminder schedules */}
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--hairline)" }}>
            <div className="flex justify-between items-center mb-2">
              <p className="text-11 font-medium tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("customerProfile.reminders")}</p>
              <button onClick={() => { setEditingConfig(null); setShowReminderConfig(true); }} className="text-12 font-semibold px-3 py-1.5 rounded-full" style={{ background: "var(--surface-2)", color: "#5A5A55" }}>{t("customerProfile.add")}</button>
            </div>
            {reminderConfigs.length === 0 ? (
              <p className="text-12 py-1" style={{ color: "var(--text-secondary)" }}>{t("common.noRemindersConfigured")}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {reminderConfigs.map((cfg: ReminderConfig) => (
                  <div key={cfg.id} className="flex items-center justify-between py-2 px-2 rounded-[var(--radius-tile)]" style={{ background: "rgba(99,153,34,0.05)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-12 font-medium" style={{ color: "var(--text-primary)" }}>
                        {cfg.startDays}d {cfg.anchor === "after_credit" ? t("reminder.afterCredit") : cfg.anchor === "after_due" ? t("reminder.afterDueDate") : cfg.anchor === "before_due" ? t("reminder.beforeDueDate") : t("reminder.beforeHarvest")}
                      </p>
                      <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                        {cfg.repeat === "once" ? t("reminder.oneTime") : cfg.repeat === "interval" ? t("reminder.every") + " " + cfg.intervalN + " " + t("reminder.days") : t("reminder.escalating")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditingConfig(cfg); setShowReminderConfig(true); }} className="p-1"><Pencil size={14} color="var(--text-secondary)" /></button>
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
        <ListCard>
          <ListRow
            onClick={() => navigate(base + "/customers/" + customerId + "/purchases")}
            icon={History}
            title={t("customerProfile.purchaseHistory")}
          />
          <ListRow
            onClick={() => navigate(base + "/customers/" + customerId + "/payments")}
            icon={Wallet}
            title={t("customerProfile.paymentHistory")}
          />
          <ListRow
            onClick={() => navigate(base + "/customers/" + customerId + "/reminders")}
            icon={Bell}
            title={t("customerProfile.reminderHistory")}
          />
          {/* Same row as its neighbours: it was the only one carrying a tinted background and a
              hardcoded dark green label, which read as a different kind of control and was
              invisible once the page is dark. */}
          <ListRow
            onClick={() => navigate(base + "/customers/" + customerId + "/record-payment")}
            icon={Receipt}
            title={t("customerProfile.recordPayment")}
          />
          <ListRow
            onClick={startEdit}
            icon={Pencil}
            title={t("customerProfile.editCustomer")}
          />
          <ListRow
            onClick={() => setShowDelete(true)}
            icon={Trash2}
          >
            <span className="text-sm" style={{ color: "var(--error)" }}>{t("customerProfile.deleteCustomer")}</span>
          </ListRow>
        </ListCard>

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
          style={{ background: "var(--scrim)" }}
          onClick={() => setEditing(false)}
        >
          <div
            className="w-full max-w-[400px] rounded-t-2xl sm:rounded-[var(--radius-card)] p-5 flex flex-col gap-4"
            style={{ background: "var(--tone-sheet)", maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{t("common.editCustomer")}</p>

            {/* Image on top */}
            <div className="flex justify-center">
              <ImageUpload bucket="customer-images" value={editImageUrl} onChange={setEditImageUrl} shape="circle" label={t("common.profilePhoto")} />
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="ds-section-label block mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("addCustomer.name")}</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border-control)", color: "var(--text-primary)", borderRadius: "24px" }}
                />
              </div>
              <div>
                <label className="ds-section-label block mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("addCustomer.phone")}</label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border-control)", color: "var(--text-primary)", borderRadius: "24px" }}
                />
              </div>
              <div>
                <label className="ds-section-label block mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("addCustomer.address")}</label>
                <input
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border-control)", color: "var(--text-primary)", borderRadius: "24px" }}
                />
              </div>
              <div>
                <label className="ds-section-label block mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("common.crops")}</label>
                <div className="flex flex-wrap gap-2">
                  {(businessSettings.crops.length > 0 ? businessSettings.crops.map(c => c.name) : KNOWN_CROPS).map(cropName => (
                    <button key={cropName} type="button" onClick={() => setEditCrops(prev => prev.includes(cropName) ? prev.filter(c => c !== cropName) : [...prev, cropName])} className="h-9 px-4 rounded-full text-12 font-medium transition-colors" style={{ background: editCrops.includes(cropName) ? "var(--brand)" : "var(--surface-2)", color: editCrops.includes(cropName) ? "#0a0a0a" : "var(--text-secondary)", border: editCrops.includes(cropName) ? "none" : "1px solid var(--divider)" }}>{cropName}</button>
                  ))}
                </div>
              </div>
              {/* The limit is no longer a field in this form. It has one home — the
                  "Set limit" / "Change limit" action beside the amount on this customer's
                  card — so there is one place to look for it and one audited way to change
                  it. Employees keep the read-only line that tells them who to ask. */}
              {!isAdmin && (
                <div>
                  <label className="ds-section-label block mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("common.creditLimitOptional")}</label>
                  <div className="rounded-[var(--radius-card)] p-3" style={{ background: "var(--tone-card)" }}>
                    <p className="text-12" style={{ color: "var(--text-secondary)" }}>{formatCurrency(customer.creditLimit)}</p>
                    <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{t("customer.actionCenterHint")}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-1">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 h-11 rounded-full text-sm font-medium"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex-1 h-11 rounded-full text-sm font-bold"
                style={{ background: "var(--brand)", color: "#0a0a0a", opacity: saving ? 0.6 : 1 }}
              >                  {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Due Date Edit Bottom Sheet */}
      {showEditDueDate && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "var(--scrim)" }} onClick={() => setShowEditDueDate(false)}>
          <div className="w-full max-w-[400px] mx-auto rounded-t-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-center pt-1 pb-0"><div className="w-10 h-1 rounded-full" style={{ background: 'var(--divider)' }} /></div>
            <p className="text-16 font-semibold" style={{ color: 'var(--text-primary)' }}>{t('common.paymentDueDate')}</p>
            <p className="text-13" style={{ color: 'var(--text-secondary)' }}>{t('common.dueDateDescription')}</p>
            <div>
              <label className="ds-section-label block mb-1.5" style={{ color: 'var(--text-secondary)' }}>{t('common.dueDate')}</label>
              <input type="date" value={editDueDate} min={new Date().toISOString().split('T')[0]} onChange={e => setEditDueDate(e.target.value)} className="w-full outline-none" />
            </div>
            <div className="flex gap-3 mt-1">
              <button onClick={() => setShowEditDueDate(false)} className="flex-1 h-11 rounded-full text-sm font-medium" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{t('common.cancel')}</button>
              <button onClick={handleSaveDueDate} className="flex-1 h-11 rounded-full text-sm font-bold" style={{ background: 'var(--brand)', color: '#0a0a0a' }}>{t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* The credit limit: one field, one save, and a plain statement when the new limit
          leaves the customer over it. */}
      <CreditLimitSheet
        open={showLimitSheet}
        currentLimit={customer.creditLimit}
        outstanding={customer.outstandingBalance}
        saving={savingLimit}
        onClose={() => setShowLimitSheet(false)}
        onSave={handleSetCreditLimit}
      />

      {/* Archive Confirmation */}
      <ConfirmDialog
        open={showDelete}
        title={t("customerProfile.deleteCustomer")}
        message={t("common.archiveCustomerConfirm", { name: customer.name })}
        confirmLabel={deleting ? t("common.saving") : t("customerProfile.deleteCustomer")}
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
        destructive
        loading={deleting}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   RecommendedSection — products this customer's crop needs now,
   ranked by how they actually buy
   ═══════════════════════════════════════════════════════ */
function RecommendedSection({ customerId }: { customerId: string | undefined }) {
  if (!customerId) return null;
  const t = useT();
  const customers = useCustomersStore((s) => s.customers);
  const products = useProductsStore((s) => s.products);
  const productsReady = useProductsStore((s) => s.ready);
  const sales = useSalesStore((s) => s.sales);
  // The whole crop row, not just its name: acreage and the planting date are what tell the
  // engine how big the farm is and what stage the crop is at. They are usually absent — the
  // crop form only asks for the name — and absent never becomes a guess.
  const [crops, setCrops] = useState<CustomerCropRecord[]>([]);

  useEffect(() => {
    if (!productsReady) useProductsStore.getState().load();
    loadCustomerCropRows(customerId).then(setCrops);
  }, [productsReady, customerId]);

  const customer = customers.find((c) => c.id === customerId);
  if (!customer || !productsReady || products.length === 0) return null;

  const recs = getRecommendationsForCustomer(customer, {
    customers,
    sales,
    products,
    customerCrops: { [customerId]: crops },
  });
  if (recs.length === 0) return null;

  return (
    <ListCard section={t("products.recommendedFor", { name: customer.name.split(" ")[0].toUpperCase() })}>
        {recs.map((rec) => (
          <ListRow
            key={rec.subject.id}
            tile={rec.subject.imageUrl ? (
              <img src={rec.subject.imageUrl} alt={rec.subject.name} className="size-10 rounded-full object-cover shrink-0" style={{ background: "#E8F5E0" }} />
            ) : (
              <div className="size-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "#E8F5E0" }}>
                <Package size={16} style={{ color: "var(--brand-dark)" }} />
              </div>
            )}
            trailing={
            <button
              className="size-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "#E8F5E0" }}
              onClick={() => {
                const phone = (customer.phone || '').replace(/[^0-9+]/g, '');
                const waPhone = phone.startsWith('+') ? phone.slice(1) : phone.startsWith('0') ? '92' + phone.slice(1) : phone;
                const firstName = customer.name.split(' ')[0];
                let msg = '';
                if (rec.tag === 'missing_from_basket') {
                  msg = t('whatsapp.orderReminder', { name: firstName, product: rec.subject.name, crop: rec.crop });
                } else if (rec.tag === 'due_again') {
                  msg = t('whatsapp.restockReminder', { name: firstName, product: rec.subject.name, crop: rec.crop });
                } else {
                  msg = t('whatsapp.inSeasonReminder', { name: firstName, product: rec.subject.name, crop: rec.crop });
                }
                window.open('https://wa.me/' + waPhone + '?text=' + encodeURIComponent(msg), '_blank');
              }}
            >
              <Bell size={16} color="#3B6D11" />
            </button>
            }
          >
            <div className="min-w-0">
              <p className="text-14 font-medium" style={{ color: "var(--text-primary)" }}>
                {rec.subject.name}
              </p>
              <WhyRecommended reasons={rec.reasons} />
            </div>
          </ListRow>
        ))}
    </ListCard>
  );
}
