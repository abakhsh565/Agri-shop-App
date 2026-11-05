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
import DateField from "@/components/ui/DateField";
import type { CustomerPayment } from "@/types";
import { formatCurrency, calculateCreditHealth, getCreditHealthStatusColor } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { History, Wallet, Bell, Pencil, Trash2, Receipt, Plus, Package, Clock } from "lucide-react";
import { getRecommendationsForCustomer, KNOWN_CROPS, type CustomerCropRecord, type RecommendationReason } from "@/lib/recommendationEngine";
import { loadReminderConfigs, saveReminderConfig as saveReminderConfigToDb, loadCustomerCrops, loadCustomerCropRows, saveCustomerCrops as saveCustomerCropsToDb, loadBusinessSettings, calculatePaymentStatus, getPaymentStatusLabel, getPaymentStatusColor, isDuplicateReminder } from "@/lib/reminderEngine";
import RecommendationReasonLine from "@/components/recommendations/RecommendationReason";
import { useProductsStore } from "@/stores/productsStore";
import { SkeletonList } from "@/components/ui/Skeleton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import CreditLimitSheet from "@/components/customers/CreditLimitSheet";
import { hasPermission } from "@/lib/tenantContext";
import type { LocalCreditRequest } from "@/lib/localGroupRegistry";
import ReminderConfigSheet from "@/components/ui/ReminderConfigSheet";
import { usePaymentReminderBook } from "@/lib/paymentReminders";
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
  // What this person may actually do, read from the grants the owner set — not from which
  // shell they happen to be in. The database enforces the same codes either way.
  const canEditCustomers = hasPermission("customers.edit");
  const canSetCreditLimit = hasPermission("customers.credit_limit");
  const canRecordPayments = hasPermission("customers.payments");
  const canArchiveCustomers = hasPermission("customers.delete");

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [editCrops, setEditCrops] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const sales = useSalesStore((s) => s.sales);
  const customersReady = useCustomersStore((s) => s.ready);
  // The owner's diary holds the reminders written about this customer (0257). The same rows are
  // read on the reminder history screen and in the payment book; this count is the door's badge,
  // not a second list.
  const reminderBook = usePaymentReminderBook();
  const openCustomerReminders = (reminderBook.rows ?? []).filter(
    (r) => r.kind === "customer" && r.customerId === customerId && r.status === "upcoming",
  ).length;
  const [deleting, setDeleting] = useState(false);
  const [showReminderConfig, setShowReminderConfig] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ReminderConfig | null>(null);
  const [reminderConfigs, setReminderConfigs] = useState<ReminderConfig[]>([]);
  const [showEditDueDate, setShowEditDueDate] = useState(false);
  const [editDueDate, setEditDueDate] = useState("");
  const [customerCrops, setCustomerCrops] = useState<string[]>([]);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>({ crops: [] });
  // One sheet, two jobs: `set` writes the limit, `request` asks the owner for one (0251).
  const [limitMode, setLimitMode] = useState<null | "set" | "request">(null);
  const [savingLimit, setSavingLimit] = useState(false);
  const setCreditLimit = useCustomersStore((s) => s.setCreditLimit);
  const requestCreditLimitIncrease = useCustomersStore((s) => s.requestCreditLimitIncrease);
  // A request that is already waiting is a fact this card has to show. Without it the screen
  // looks identical before and after asking — the employee cannot tell whether the request went
  // anywhere, and the owner, opening the same card, cannot see that a decision is waiting on them.
  const [pendingLimitRequest, setPendingLimitRequest] = useState<LocalCreditRequest | null>(null);

  /**
   * Read back whether this customer has a request waiting. The row is the answer, not the local
   * state: a request that was just sent has to appear here in the same breath, or the card keeps
   * offering "Request limit" and the employee files the same request twice.
   */
  const loadPendingLimitRequest = async () => {
    if (!customerId) return;
    try {
      // Imported on demand, the way the store does it: this module is otherwise only needed by
      // the alerts screens, and the customer card should not pull it into every page's chunk.
      const { getCreditRequestsDB } = await import("@/lib/localGroupRegistry");
      const rows = await getCreditRequestsDB();
      setPendingLimitRequest(
        rows.find((r) => r.customerId === customerId && r.status === "pending") ?? null,
      );
    } catch {
      // Unreadable: leave the card as it is rather than claiming the request went nowhere.
    }
  };

  useEffect(() => {
    void loadPendingLimitRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the customer, not the closure
  }, [customerId]);

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

  async function handleSaveCreditLimit(value: number, reason: string) {
    if (!customer || savingLimit) return;
    setSavingLimit(true);
    try {
      if (canSetCreditLimit) {
        // One write path for this column: the permission-checked, audited RPC. The customer
        // edit form used to write it straight to the table, which is how a limit could move
        // with nothing in the audit trail and no cache refresh behind it.
        const applied = await setCreditLimit(customer.id, value);
        addToast(t("sale.creditLimitSet", { amount: formatCurrency(applied) }), "success");
      } else {
        // Without the lending permission the number is a proposal: the owner approves it,
        // and may approve a different amount than the one asked for.
        await requestCreditLimitIncrease({
          customerId: customer.id,
          customerName: customer.name,
          currentLimit: customer.creditLimit,
          requestedLimit: value,
          requestedBy: user?.name || user?.id || "",
          reason,
        });
        addToast(t("creditLimit.requestSent"), "success");
        // The card must now say a decision is waiting, and stop offering to file another.
        await loadPendingLimitRequest();
      }
      setLimitMode(null);
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : canSetCreditLimit ? t("sale.creditLimitFailed") : t("creditLimit.requestFailed"),
        "error",
      );
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
      // Note what this does NOT do: write the credit limit. The column has one owner — the
      // `Set limit` / `Request limit` action on this customer's card, through the audited
      // RPC or the owner-approval request — so a form save can never move it silently.
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
            <p className="ds-stat-label">{t("customerProfile.purchases")}</p>
            <p className="text-15 font-bold mt-1" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(customer.totalPurchases || customerSales.reduce((a, s) => a + s.totalAmount, 0))}
            </p>
          </div>
          <div className="flex-1 text-center py-3.5" style={{ borderRight: "1px solid var(--divider)" }}>
            <p className="ds-stat-label">{t("customerProfile.paid")}</p>              <p className="text-15 font-bold mt-1" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(customer.totalPaid || 0)}
            </p>
          </div>
          <div className="flex-1 text-center py-3.5">
            <p className="ds-stat-label">{t("customerProfile.outstanding")}</p>
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
            <span className="ds-section-label">{t("customerProfile.creditLimit")}</span>
            <div className="flex items-center gap-2">
              <span className="text-15 font-bold" style={{ color: "var(--text-primary)" }}>
                {customer.creditLimit > 0 ? formatCurrency(customer.creditLimit) : "\u2014"}
              </span>
              {canSetCreditLimit ? (
                <button
                  onClick={() => setLimitMode("set")}
                  className="text-12 font-semibold px-3 py-1.5 rounded-full"
                  style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
                  data-testid="credit-limit-action"
                >
                  {customer.creditLimit > 0 ? t("customers.changeLimit") : t("customers.setLimit")}
                </button>
              ) : (
                // An employee without the lending permission is not left with a button that
                // can only fail: the same sheet collects a number and files a request. While one
                // is already waiting, the button would only file a second, so it is the waiting
                // line below that is shown instead — one outstanding request per customer.
                !pendingLimitRequest && (
                  <button
                    onClick={() => setLimitMode("request")}
                    className="text-12 font-semibold px-3 py-1.5 rounded-full"
                    style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
                    data-testid="credit-limit-request-action"
                  >
                    {t("creditLimit.requestShort")}
                  </button>
                )
              )}
            </div>
          </div>

          {/*
            A request that is waiting for an answer. Both people who look at this card need it:
            the employee who asked (was it sent?) and the owner who has to decide. In the owner's
            shell the line opens the request itself, where the amount can be changed before it is
            approved (0251) — the customer card alone cannot answer it.
          */}
          {pendingLimitRequest && (() => {
            const line = (
              <>
                <Clock size={14} className="shrink-0 mt-0.5" style={{ color: "var(--text-secondary)" }} />
                <span className="text-11" style={{ color: "var(--text-secondary)" }}>
                  {t("creditLimit.requestPending")}{" "}
                  {t("creditRequest.requestedAmount")}: {formatCurrency(pendingLimitRequest.requestedLimit)}
                </span>
              </>
            );
            const lineClass = "w-full flex items-start gap-2 mt-3 rounded-[var(--radius-tile)] p-2.5 text-start";
            const lineStyle = { background: "var(--surface-2)" };
            // Only the owner's shell has the request screen to open. For anyone else this is a
            // statement, not a control — a disabled button would announce one that does nothing.
            return base === "/admin" ? (
              <button
                type="button"
                onClick={() => navigate(`/admin/alerts/credit-requests/${pendingLimitRequest.id}`)}
                className={lineClass}
                style={lineStyle}
                data-testid="credit-limit-pending"
              >
                {line}
              </button>
            ) : (
              <div className={lineClass} style={lineStyle} data-testid="credit-limit-pending">
                {line}
              </div>
            );
          })()}

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
                <p className="ds-section-label">{t("customerProfile.dueDate")}</p>
                <p className="text-14 font-bold mt-0.5" style={{ color: customer.dueDate ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {customer.dueDate ? new Date(customer.dueDate).toLocaleDateString(isUrdu ? "ur-PK" : "en-PK", { day: "numeric", month: "short", year: "numeric" }) : t("common.notSet")}
                </p>
              </div>
              {/* The due date is written through `update_customer_due_date`, which requires
                  `customers.edit` — so the control follows the same grant instead of being
                  offered to someone the database will refuse. */}
              {canEditCustomers && (
                <button onClick={() => { setEditDueDate(customer.dueDate || ""); setShowEditDueDate(true); }} className="text-12 font-semibold px-3 py-1.5 rounded-full" style={{ background: "var(--surface-2)", color: "#5A5A55" }}>
                  {customer.dueDate ? t("customerProfile.edit") : t("common.save")}
                </button>
              )}
            </div>
          </div>
          {/* Reminder schedules */}
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--hairline)" }}>
            <div className="flex justify-between items-center mb-2">
              <p className="ds-section-label">{t("customerProfile.reminders")}</p>
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
            // The count sits where the app puts every right-hand secondary value. A bell in a
            // pill beside it said "alert" for something that is only a number of notes.
            value={openCustomerReminders > 0 ? String(openCustomerReminders) : undefined}
          />
          {/* Same row as its neighbours: it was the only one carrying a tinted background and a
              hardcoded dark green label, which read as a different kind of control and was
              invisible once the page is dark. */}
          {/* Each row follows the grant its action needs: recording a payment is
              `customers.payments`, editing is `customers.edit`, archiving is
              `customers.delete`. A row that is only refused by the database is clutter. */}
          {canRecordPayments && (
            <ListRow
              onClick={() => navigate(base + "/customers/" + customerId + "/record-payment")}
              icon={Receipt}
              title={t("customerProfile.recordPayment")}
            />
          )}
          {canEditCustomers && (
            <ListRow
              onClick={startEdit}
              icon={Pencil}
              title={t("customerProfile.editCustomer")}
            />
          )}
          {canArchiveCustomers && (
            <ListRow
              onClick={() => setShowDelete(true)}
              icon={Trash2}
            >
              <span className="text-sm" style={{ color: "var(--error)" }}>{t("customerProfile.deleteCustomer")}</span>
            </ListRow>
          )}
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
                  style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="ds-section-label block mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("addCustomer.phone")}</label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                  style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="ds-section-label block mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("addCustomer.address")}</label>
                <input
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                  style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
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
              <DateField
                value={editDueDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={setEditDueDate}
                testId="customer-due-date"
              />
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
        open={limitMode !== null}
        currentLimit={customer.creditLimit}
        outstanding={customer.outstandingBalance}
        saving={savingLimit}
        mode={limitMode ?? "set"}
        onClose={() => setLimitMode(null)}
        onSave={handleSaveCreditLimit}
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
    <ListCard section={t("products.recommendedFor", { name: customer.name.split(" ")[0] })}>
        {recs.map((rec) => (
          <ListRow
            key={rec.subject.id}
            /* The same picture the product carries on its own page and in the product list — the
               uploaded photo when there is one, and the plain tile only when there is not. */
            tile={rec.subject.imageUrl ? (
              <img
                src={rec.subject.imageUrl}
                alt={rec.subject.name}
                className="size-10 rounded-[var(--radius-tile)] object-cover shrink-0"
                style={{ background: "var(--surface-2)" }}
              />
            ) : (
              <div
                className="size-10 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
                style={{ background: "var(--brand-light)" }}
              >
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
              <RecommendationReasonLine reason={rec.reasons[0]} />
            </div>
          </ListRow>
        ))}
    </ListCard>
  );
}
