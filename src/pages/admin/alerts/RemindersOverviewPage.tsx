import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useCustomersStore, type CreditLimitRequest } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { generateReminders, generateReminderMessage, calculatePaymentStatus } from "@/lib/reminderEngine";
import type { GeneratedReminder } from "@/types";
import { MessageCircle, Smartphone, X, ChevronDown, ChevronUp, Bell, CheckCircle2, Clock, AlertTriangle, AlertOctagon, Info, Plus, Users, Trash2, Eye, Send, XCircle } from "lucide-react";
import GroupReminderSheet from "@/components/ui/GroupReminderSheet";
import {
  saveLocalGroup,
  loadLocalGroups,
  deleteLocalGroup,
  type LocalGroupEntry,
} from "@/lib/localGroupRegistry";
import {
  getCreditRequests,
  approveCreditRequest,
  rejectCreditRequest,
  type LocalCreditRequest,
} from "@/lib/localGroupRegistry";

/* ── Types ── */
interface ReminderLogEntry {
  id: string;
  customerId: string;
  customerName?: string;
  configId?: string;
  type: "gentle" | "firmer" | "final";
  message: string;
  channel: string;
  sentAt: string;
}

async function loadAllReminderLogs(): Promise<ReminderLogEntry[]> {
  try {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.from("reminder_logs").select("*").order("sent_at", { ascending: false }).limit(50);
    if (!data) return [];
    return data.map((r: any) => ({
      id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      configId: r.config_id,
      type: r.tone,
      message: r.message,
      channel: r.channel,
      sentAt: r.sent_at,
    }));
  } catch { return []; }
}

async function logReminderToDb(customerId: string, customerName: string, entry: ReminderLogEntry) {
  try {
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("reminder_logs").insert({
      customer_id: customerId,
      customer_name: customerName,
      config_id: entry.configId || null,
      tone: entry.type,
      message: entry.message,
      channel: entry.channel,
      sent_at: entry.sentAt,
    });
  } catch {}
}

/* ── Tone config ── */
const TONE_CONFIG: Record<string, { color: string; bg: string; labelKey: string }> = {
  gentle: { color: "var(--brand-dark, #65a30d)", bg: "var(--brand-light, #d9f99d)", labelKey: "reminders.gentle" },
  firmer: { color: "#b45309", bg: "#fef3c7", labelKey: "reminders.formal" },
  final:  { color: "#dc2626", bg: "#fee2e2", labelKey: "reminders.final" },
};

/* ── Helpers ── */
function getInitials(name: string | undefined): string {
  const n = name || "U";
  return n.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function getAvatarColor(name: string | undefined): string {
  const colors = ["#3f6212","#2563eb","#7c3aed","#db2777","#ea580c","#0891b2","#4f46e5","#16a34a","#9333ea","#dc2626"];
  const n = name || "U";
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = n.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  return days + "d ago";
}

/* ── Alert card for Action Needed — matches homepage Quick Alerts style ── */
function AlertCard({
  icon,
  title,
  subtitle,
  actionLabel,
  cardBg,
  iconBg,
  iconColor,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  actionLabel: string;
  cardBg: string;
  iconBg: string;
  iconColor: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[14px] p-4 flex items-start gap-3 text-start transition-opacity active:opacity-70"
      style={{ background: cardBg }}
    >
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: iconBg, color: iconColor }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold" style={{ color: "var(--text-primary)" }}>{title}</p>
        <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{subtitle}</p>
      </div>
      <span className="text-[12px] font-bold shrink-0 mt-1" style={{ color: "var(--brand-dark, #65a30d)" }}>
        {actionLabel}
      </span>
    </button>
  );
}

/* ── Reminder card (collapsible) — for Follow-ups ── */
function ReminderCard({
  reminder,
  onSend,
  onNavigate,
  isSent,
  statusKey,
}: {
  reminder: GeneratedReminder;
  onSend: (r: GeneratedReminder) => void;
  onNavigate: (customerId: string) => void;
  isSent: boolean;
  statusKey?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  const tc = TONE_CONFIG[reminder.tone] || TONE_CONFIG.gentle;

  return (
    <div className="overflow-hidden transition-all" style={{ borderBottom: "1px solid var(--divider)" }}>
      <button className="w-full flex items-center gap-3 p-4 text-start" onClick={() => setExpanded(!expanded)}>
        <div className="w-11 h-11 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0" style={{ background: getAvatarColor(reminder.customerName), color: "#fff" }}>
          {getInitials(reminder.customerName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>{reminder.customerName}</p>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {formatCurrency(reminder.outstanding)} {t("reminders.outstanding")}
          </p>
        </div>
        <div className="shrink-0 ms-1">
          {expanded ? <ChevronUp size={18} style={{ color: "var(--text-secondary)" }} /> : <ChevronDown size={18} style={{ color: "var(--text-secondary)" }} />}
        </div>
      </button>

      <div className="px-4 pb-3 pt-0 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: tc.bg, color: tc.color }}>
          {t(tc.labelKey as any)}
        </span>
        {isSent ? (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: "var(--brand-light, #d9f99d)", color: "var(--brand-dark, #65a30d)" }}>
            {t("reminders.sent")}
          </span>
        ) : (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
            {t(statusKey || "reminders.readyToSend")}
          </span>
        )}
        <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{reminder.triggerDetail}</span>
      </div>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3" style={{ borderTop: "1px solid var(--divider)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider pt-3" style={{ color: "var(--text-secondary)" }}>Message</p>
          <div className="rounded-[10px] px-3 py-2.5" style={{ background: "var(--surface-2)" }}>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>{generateReminderMessage(reminder)}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={(e) => { e.stopPropagation(); onSend(reminder); }} className="flex-1 h-12 rounded-full text-[14px] font-bold flex items-center justify-center gap-2" style={{ background: "#25D366", color: "#fff" }}>
              <MessageCircle size={18} /> WhatsApp
            </button>
            <button onClick={(e) => { e.stopPropagation(); onSend(reminder); }} className="flex-1 h-12 rounded-full text-[14px] font-bold flex items-center justify-center gap-2" style={{ background: "var(--text-primary)", color: "var(--background)" }}>
              <Smartphone size={18} /> SMS
            </button>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onNavigate(reminder.customerId); }} className="w-full h-10 rounded-full text-[13px] font-semibold flex items-center justify-center gap-2" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
            {t("reminders.viewCustomer")}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Activity item for Sent ── */
function ActivityItem({ log }: { log: ReminderLogEntry }) {
  const t = useT();
  const tc = TONE_CONFIG[log.type] || TONE_CONFIG.gentle;
  const channel = (log.channel || "sent").toUpperCase();
  const name = log.customerName || "Customer";
  return (
    <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--divider)" }}>
      <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: getAvatarColor(name), color: "#fff" }}>
        {getInitials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>{name}</p>
        <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{t(tc.labelKey as any)} · {channel} · {timeAgo(log.sentAt)}</p>
      </div>
      <span className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0" style={{ background: "var(--brand-light, #d9f99d)", color: "var(--brand-dark, #65a30d)" }}>Sent</span>
    </div>
  );
}

/* ── EmptyState ── */
function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="py-10 flex flex-col items-center gap-2">
      <div className="mb-1" style={{ color: "var(--text-secondary)", opacity: 0.5 }}>{icon}</div>
      <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{title}</p>
      <p className="text-[12px] text-center px-6" style={{ color: "var(--text-secondary)" }}>{subtitle}</p>
    </div>
  );
}

/* ── Main page ── */
export default function RemindersOverviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const navigateToCustomer = (customerId: string) => navigate(`/admin/customers/${customerId}`);
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customers = useCustomersStore((s) => s.customers);
  const sales = useSalesStore((s) => s.sales);
  const products = useProductsStore((s) => s.products);

  /* ── Data ── */
  const [allReminders, setAllReminders] = useState<any[]>([]);
  const [showGroupSheet, setShowGroupSheet] = useState(false);
  const [reminderGroups, setReminderGroups] = useState<any[]>([]);
  const [creditRequests, setCreditRequests] = useState<LocalCreditRequest[]>([]);

  useEffect(() => {
    generateReminders({ customers, sales, t }).then(setAllReminders);
  }, [customers, sales]);
  useEffect(() => {
    loadLocalGroups().then(setReminderGroups);
    setCreditRequests(getCreditRequests());
  }, []);
  // Refresh credit requests on mount and periodically
  useEffect(() => {
    const refresh = () => setCreditRequests(getCreditRequests());
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  /* ── Tab State ── */
  const stateTab = (location.state as any)?.tab as string | undefined;
  const stateSubTab = (location.state as any)?.subTab as string | undefined;
  const [mainTab, setMainTab] = useState<"action" | "followups" | "groups">(
    stateTab === "followups" ? "followups" : stateTab === "groups" ? "groups" : "action"
  );
  const [subTab, setSubTab] = useState<string>(
    stateSubTab || (stateTab === "followups" ? "ready" : stateTab === "groups" ? "" : "urgent")
  );

  useEffect(() => {
    const t = (location.state as any)?.tab as string | undefined;
    const s = (location.state as any)?.subTab as string | undefined;
    if (t === "followups") { setMainTab("followups"); if (s) setSubTab(s); }
    else if (t === "groups") { setMainTab("groups"); setSubTab(""); }
    else if (t === "action") { setMainTab("action"); if (s) setSubTab(s); }
  }, [location.state]);

  const [editingReminder, setEditingReminder] = useState<GeneratedReminder | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [sentKeys, setSentKeys] = useState<Set<string>>(new Set());
  const [allLogs, setAllLogs] = useState<ReminderLogEntry[]>([]);
  const [creditAction, setCreditAction] = useState<{ request: LocalCreditRequest; action: "approve" | "reject" } | null>(null);

  useEffect(() => { loadAllReminderLogs().then(setAllLogs); }, []);
  useEffect(() => {
    const timer = setInterval(() => loadAllReminderLogs().then(setAllLogs), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (editingReminder) { document.body.style.overflow = "hidden"; } else { document.body.style.overflow = ""; }
    return () => { document.body.style.overflow = ""; };
  }, [editingReminder]);

  const now = new Date();

  /* ── Action Needed categories ── */
  const highRiskCustomers = useMemo(() =>
    customers.filter(c => c.outstandingBalance > 0 && calculatePaymentStatus(c, now) === "high_risk"),
  [customers]);

  const delayedCustomers = useMemo(() =>
    customers.filter(c => c.outstandingBalance > 0 && calculatePaymentStatus(c, now) === "delayed"),
  [customers]);

  const creditLimitCustomers = useMemo(() =>
    customers.filter(c => c.outstandingBalance > 0 && c.creditLimit > 0 && c.outstandingBalance >= c.creditLimit),
  [customers]);

  const lowStockProducts = useMemo(() =>
    products.filter(p => p.stockQty <= (p.variants?.[0]?.lowStockThreshold ?? 5)),
  [products]);

  /* ── Follow-ups categories ── */
  const readyReminders = useMemo(() =>
    allReminders.filter(r => !sentKeys.has(r.customerId + "-sent") && new Date(r.triggerDate) <= now),
  [allReminders, sentKeys]);

  const upcomingReminders = useMemo(() =>
    allReminders.filter(r => !sentKeys.has(r.customerId + "-sent") && new Date(r.triggerDate) > now),
  [allReminders, sentKeys]);

  const sentLogs = useMemo(() => allLogs, [allLogs]);

  const mediumCount = useMemo(() => {
    const ids = new Set<string>();
    delayedCustomers.forEach(c => ids.add(c.id));
    creditLimitCustomers.forEach(c => ids.add(c.id));
    return ids.size;
  }, [delayedCustomers, creditLimitCustomers]);

  const pendingCreditRequests = useMemo(() =>
    creditRequests.filter(r => r.status === "pending"),
  [creditRequests]);

  const allCreditRequests = useMemo(() => creditRequests, [creditRequests]);

  /* ── Sub-tabs ── */
  const actionSubTabs = [
    { key: "urgent", label: isUrdu ? "انتہائی فوری" : "Highly Urgent", count: highRiskCustomers.length, color: "#dc2626" },
    { key: "medium", label: isUrdu ? "درمیانہ" : "Medium", count: mediumCount, color: "#d97706" },
    { key: "normal", label: isUrdu ? "نارمل" : "Normal", count: lowStockProducts.length, color: "var(--brand-dark, #65a30d)" },
    { key: "credit_approval", label: isUrdu ? "کریڈٹ" : "Credit", count: pendingCreditRequests.length, color: "#7c3aed" },
  ];

  const followupSubTabs = [
    { key: "ready", label: isUrdu ? "تیار" : "Ready", count: readyReminders.length, color: "var(--brand-dark, #65a30d)" },
    { key: "upcoming", label: isUrdu ? "آنے والے" : "Upcoming", count: upcomingReminders.length, color: "#2563eb" },
    { key: "recently_sent", label: isUrdu ? "حالیہ" : "Recently Sent", count: sentLogs.length, color: "var(--text-secondary)" },
  ];

  const currentSubTabs = mainTab === "action" ? actionSubTabs : mainTab === "followups" ? followupSubTabs : [];

  function openSendSheet(reminder: GeneratedReminder) {
    setEditingReminder(reminder);
    setEditMessage(generateReminderMessage(reminder));
  }

  const handleSend = useCallback((channel: "whatsapp" | "sms") => {
    if (!editingReminder) return;
    const phone = editingReminder.customerPhone.replace(/[^0-9+]/g, "");
    const encodedMsg = encodeURIComponent(editMessage);
    const key = editingReminder.customerId + "-sent";

    if (channel === "whatsapp") {
      const waPhone = phone.startsWith("+") ? phone.slice(1) : phone.startsWith("0") ? "92" + phone.slice(1) : phone;
      window.open("https://wa.me/" + waPhone + "?text=" + encodedMsg, "_blank");
    } else {
      window.open("sms:" + phone + "?body=" + encodedMsg, "_blank");
    }

    logReminderToDb(editingReminder.customerId, editingReminder.customerName, {
      id: "rem-" + Date.now(),
      customerId: editingReminder.customerId,
      customerName: editingReminder.customerName,
      configId: editingReminder.configId,
      type: editingReminder.tone,
      message: editMessage,
      channel,
      sentAt: new Date().toISOString(),
    }).then(() => { setSentKeys(prev => new Set([...prev, key])); loadAllReminderLogs().then(setAllLogs); });
    setEditingReminder(null);
  }, [editingReminder, editMessage]);

  /* ── Credit request actions ── */
  const handleCreditAction = useCallback(async () => {
    if (!creditAction) return;
    try {
      if (creditAction.action === "approve") {
        await approveCreditRequest(creditAction.request.id, "Admin");
      } else {
        await rejectCreditRequest(creditAction.request.id, "Admin");
      }
      setCreditRequests(getCreditRequests());
      setCreditAction(null);
    } catch (err) {
      console.error("Credit action failed:", err);
    }
  }, [creditAction]);

  /* ── Render action needed ── */
  function renderActionContent() {
    switch (subTab) {
      case "urgent":
        return highRiskCustomers.length === 0 ? (
          <EmptyState icon={<AlertOctagon size={24} style={{ color: "var(--text-secondary)" }} />} title={isUrdu ? "کوئی فوری کارروئی نہیں" : "No urgent actions"} subtitle={isUrdu ? "کوئی گاہک 31+ دن سے وقف نہیں۔" : "No customers are 31+ days overdue."} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {highRiskCustomers.map(c => (
              <AlertCard
                key={c.id}
                icon={<AlertOctagon size={16} />}
                title={c.name}
                subtitle={`${formatCurrency(c.outstandingBalance)} ${isUrdu ? "واجب الادا" : "overdue"} · ${isUrdu ? "وقف" : "Due"}: ${c.dueDate ? new Date(c.dueDate).toLocaleDateString() : "—"}`}
                actionLabel={isUrdu ? "جائزہ" : "Review"}
                cardBg="rgba(220, 38, 38, 0.06)"
                iconBg="rgba(220, 38, 38, 0.1)"
                iconColor="#dc2626"
                onClick={() => navigateToCustomer(c.id)}
              />
            ))}
          </div>
        );
      case "medium":
        const mediumMap = new Map<string, { id: string; name: string; balance: number; tag: string; detail: string }>();
        delayedCustomers.forEach(c => mediumMap.set(c.id, { id: c.id, name: c.name, balance: c.outstandingBalance, tag: isUrdu ? "ڈیلےڈ" : "Delayed", detail: `${isUrdu ? "وقف" : "Due"}: ${c.dueDate ? new Date(c.dueDate).toLocaleDateString() : "—"}` }));
        creditLimitCustomers.forEach(c => { if (!mediumMap.has(c.id)) mediumMap.set(c.id, { id: c.id, name: c.name, balance: c.outstandingBalance, tag: isUrdu ? "کریڈٹ حد" : "Credit Limit", detail: `${isUrdu ? "حد" : "Limit"}: ${formatCurrency(c.creditLimit)}` }); });
        const mediumItems = Array.from(mediumMap.values());
        return mediumItems.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={24} style={{ color: "var(--text-secondary)" }} />} title={isUrdu ? "کوئی درمیانہ کارروئی نہیں" : "No medium actions"} subtitle={isUrdu ? "سب کچھ ٹھیک چل رہا ہے۔" : "Everything looks fine."} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {mediumItems.map(item => (
              <AlertCard
                key={item.id}
                icon={<AlertTriangle size={16} />}
                title={item.name}
                subtitle={`${formatCurrency(item.balance)} ${isUrdu ? "واجب الادا" : "outstanding"} · ${item.detail}`}
                actionLabel={isUrdu ? "جائزہ" : "Review"}
                cardBg="rgba(217, 119, 6, 0.06)"
                iconBg="rgba(217, 119, 6, 0.1)"
                iconColor="#d97706"
                onClick={() => navigateToCustomer(item.id)}
              />
            ))}
          </div>
        );
      case "normal":
        return lowStockProducts.length === 0 ? (
          <EmptyState icon={<Info size={24} style={{ color: "var(--text-secondary)" }} />} title={isUrdu ? "کوئی نارمل اعلان نہیں" : "No normal alerts"} subtitle={isUrdu ? "اسٹاک مناسب ہے۔" : "Stock levels are fine."} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {lowStockProducts.map(p => (
              <AlertCard
                key={p.id}
                icon={<Info size={16} />}
                title={p.name}
                subtitle={`${p.stockQty} ${isUrdu ? "باقی" : "remaining"} · ${isUrdu ? "کل" : "Total"}: ${p.stockQty}`}
                actionLabel={isUrdu ? "دیکھیں" : "View"}
                cardBg="var(--surface-2)"
                iconBg="rgba(101, 163, 13, 0.1)"
                iconColor="var(--brand-dark, #65a30d)"
                onClick={() => navigate(`/admin/products/${p.id}`)}
              />
            ))}
          </div>
        );
      case "credit_approval":
        return allCreditRequests.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={24} style={{ color: "var(--text-secondary)" }} />} title={isUrdu ? "کوئی درخواست نہیں" : "No requests yet"} subtitle={isUrdu ? "کریڈٹ حد بڑھانے کی درخواستیں یہاں نظر آئیں گی۔" : "Credit limit increase requests will appear here."} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {allCreditRequests.map(req => (
              <AlertCard
                key={req.id}
                icon={req.status === "approved" ? <CheckCircle2 size={16} /> : req.status === "rejected" ? <XCircle size={16} /> : <AlertTriangle size={16} />}
                title={req.customerName}
                subtitle={`${formatCurrency(req.currentLimit)} → ${formatCurrency(req.requestedLimit)} · ${req.requestedBy}`}
                actionLabel={req.status === "approved" ? (isUrdu ? "منظور شدہ" : "Approved") : req.status === "rejected" ? (isUrdu ? "مسترد" : "Rejected") : (isUrdu ? "جائزہ" : "Review")}
                cardBg={req.status === "approved" ? "rgba(22, 163, 74, 0.06)" : req.status === "rejected" ? "rgba(220, 38, 38, 0.06)" : "rgba(124, 58, 237, 0.06)"}
                iconBg={req.status === "approved" ? "rgba(22, 163, 74, 0.1)" : req.status === "rejected" ? "rgba(220, 38, 38, 0.1)" : "rgba(124, 58, 237, 0.1)"}
                iconColor={req.status === "approved" ? "#16a34a" : req.status === "rejected" ? "#dc2626" : "#7c3aed"}
                onClick={() => navigate(`/admin/alerts/credit-requests/${req.id}`)}
              />
            ))}
          </div>
        );
      default:
        return null;
    }
  }

  /* ── Render follow-ups ── */
  function renderFollowupsContent() {
    switch (subTab) {
      case "ready":
        return readyReminders.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={24} style={{ color: "var(--text-secondary)" }} />} title={isUrdu ? "سب ہو گیا" : "All caught up"} subtitle={isUrdu ? "کوئی یاد دہانی فی الحال ضروری نہیں۔" : "No reminders are due right now."} />
        ) : (
          <div className="flex flex-col">
            {readyReminders.map((r, i) => (
              <ReminderCard key={i} reminder={r} onSend={openSendSheet} onNavigate={navigateToCustomer} isSent={false} statusKey="reminders.readyToSend" />
            ))}
          </div>
        );
      case "upcoming":
        return upcomingReminders.length === 0 ? (
          <EmptyState icon={<Clock size={24} style={{ color: "var(--text-secondary)" }} />} title={isUrdu ? "کوئی آنے والی یاد دہانی نہیں" : "No upcoming reminders"} subtitle={isUrdu ? "گاہک پروفائلز پر یاد دہانی کی ترتیب دیں۔" : "Configure reminder schedules on customer profiles."} />
        ) : (
          <div className="flex flex-col">
            {upcomingReminders.map((r, i) => (
              <ReminderCard key={i} reminder={r} onSend={openSendSheet} onNavigate={navigateToCustomer} isSent={false} statusKey="reminders.futureReady" />
            ))}
          </div>
        );
      case "recently_sent":
        return sentLogs.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={24} style={{ color: "var(--text-secondary)" }} />} title={isUrdu ? "ابھی تک کچھ نہیں بھیجا" : "Nothing sent yet"} subtitle={isUrdu ? "پہلی یاد دہانی بھیجنے کے بعد یہاں نظر آئے گی۔" : "Sent reminders will appear here after you send them."} />
        ) : (
          <div>
            {sentLogs.map((log, i) => (
              <ActivityItem key={log.id || i} log={log} />
            ))}
          </div>
        );
      default:
        return null;
    }
  }

  /* ── Render group reminder tab ── */
  function renderGroupsContent() {
    return (
      <div className="flex flex-col">
        {reminderGroups.length === 0 ? (
          <div className="flex flex-col items-center gap-3">
            <EmptyState
              icon={<Users size={24} style={{ color: "var(--text-secondary)" }} />}
              title={isUrdu ? "کوئی گروپ نہیں" : "No groups yet"}
              subtitle={isUrdu ? "گروپ یاد دہانی بنائیں تاکہ متعدد گاہکوں کو ایک ساتھ شامل کیا جا سکے۔" : "Create a group reminder to manage multiple customers together."}
            />
            <button
              onClick={() => setShowGroupSheet(true)}
              className="flex items-center justify-center gap-2 h-11 rounded-full text-[13px] font-bold transition-transform active:scale-[0.97]"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              <Plus size={15} /> {isUrdu ? "گروپ یاد دہانی بنائیں" : "Create Group Reminder"}
            </button>
          </div>
        ) : (
          <div>
            {reminderGroups.map((group) => (
              <button
                key={group.id}
                onClick={() => navigate(`/admin/alerts/groups/${group.id}`)}
                className="w-full px-4 py-3.5 flex items-center gap-3 text-start transition-opacity active:opacity-70"
                style={{ borderBottom: "1px solid var(--divider)" }}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "#ede9fe", color: "#7c3aed" }}>
                  <Users size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>{group.name}</p>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {group.customerCount} {isUrdu ? "گاہک" : "customers"} · {group.config?.anchor === "before_due" ? `${group.config.startDays}d ${isUrdu ? "قبل از وقف" : "before due"}` : group.config?.anchor === "before_harvest" ? `${group.config.startDays}d ${isUrdu ? "قبل از کٹائی" : "before harvest"}` : "—"}
                  </p>
                </div>
                <ChevronDown size={16} style={{ color: "var(--text-secondary)", transform: "rotate(-90deg)" }} />
              </button>
            ))}
            {/* Create button below groups list */}
            <div className="px-4 pt-4">
              <button
                onClick={() => setShowGroupSheet(true)}
                className="flex items-center justify-center gap-2 h-11 w-full rounded-full text-[13px] font-bold transition-transform active:scale-[0.97]"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                <Plus size={15} /> {isUrdu ? "نیا گروپ بنائیں" : "Create New Group"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Tab Content Switcher ── */
  function renderTabContent() {
    switch (mainTab) {
      case "action": return renderActionContent();
      case "followups": return renderFollowupsContent();
      case "groups": return renderGroupsContent();
      default: return null;
    }
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}>
      <StatusBar />
      <NavHeader title={isUrdu ? "ایکشن سینٹر" : "Action Center"} />

      <div className="flex flex-col px-4 pt-4 pb-8 gap-4" style={{ overflowY: "auto", flex: 1 }}>
        {/* Main tabs — premium segmented control */}
        <div className="flex items-center gap-1 p-1 rounded-[12px]" style={{ background: "var(--surface-2)" }}>
          {([
            { key: "action" as const, label: isUrdu ? "عمل درکار" : "Action Needed" },
            { key: "followups" as const, label: isUrdu ? "فالو اپس" : "Follow Ups" },
            { key: "groups" as const, label: isUrdu ? "گروپ ریمائنڈر" : "Group Reminder" },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setMainTab(tab.key); setSubTab(tab.key === "action" ? "urgent" : tab.key === "followups" ? "ready" : ""); }}
              className="flex-1 text-center py-2 rounded-[10px] text-[13px] font-semibold transition-all"
              style={{
                color: mainTab === tab.key ? "var(--text-primary)" : "var(--text-secondary)",
                background: mainTab === tab.key ? "var(--background)" : "transparent",
                boxShadow: mainTab === tab.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sub tabs — premium segmented control, smaller */}
        {currentSubTabs.length > 0 && (
          <div className="flex items-center gap-1 p-1 rounded-[10px] overflow-x-auto no-scrollbar" style={{ background: "var(--surface-2)" }}>
            {currentSubTabs.map(st => (
              <button
                key={st.key}
                onClick={() => setSubTab(st.key)}
                className="flex items-center gap-1.5 py-1.5 px-3 rounded-[8px] text-[12px] font-semibold whitespace-nowrap transition-all shrink-0"
                style={{
                  color: subTab === st.key ? "var(--text-primary)" : "var(--text-secondary)",
                  background: subTab === st.key ? "var(--background)" : "transparent",
                  boxShadow: subTab === st.key ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                }}
              >
                {st.label}
                {st.count > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{
                    background: subTab === st.key ? st.color : "var(--text-secondary)",
                    color: subTab === st.key ? "#fff" : "var(--surface-2)",
                    lineHeight: '1',
                  }}>{st.count}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Tab content */}
        {renderTabContent()}
      </div>

      {/* Send reminder bottom sheet */}
      {editingReminder && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setEditingReminder(null)}>
          <div className="w-full max-w-[390px] mx-auto rounded-t-[24px] flex flex-col" style={{ background: "var(--surface)", maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
            </div>
            <div className="px-5 pb-4 flex items-center justify-between">
              <p className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>{isUrdu ? "یاد دہانی بھیجیں" : "Send Reminder"}</p>
              <button onClick={() => setEditingReminder(null)} className="size-8 rounded-full flex items-center justify-center" style={{ background: "var(--surface-2)" }}>
                <X size={16} style={{ color: "var(--text-secondary)" }} />
              </button>
            </div>
            <div className="px-5 pb-6 flex flex-col gap-4 overflow-y-auto" style={{ flex: 1 }}>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0" style={{ background: getAvatarColor(editingReminder.customerName), color: "#fff" }}>
                  {getInitials(editingReminder.customerName)}
                </div>
                <div>
                  <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>{editingReminder.customerName}</p>
                  <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{editingReminder.customerPhone}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: TONE_CONFIG[editingReminder.tone].bg, color: TONE_CONFIG[editingReminder.tone].color }}>
                  {t(TONE_CONFIG[editingReminder.tone].labelKey as any)}
                </span>
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{editingReminder.triggerDetail}</span>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "var(--text-secondary)" }}>Message</label>
                <textarea value={editMessage} onChange={(e) => setEditMessage(e.target.value)} rows={5} className="w-full rounded-[14px] px-4 py-3 text-[13px] outline-none resize-none" style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }} />
              </div>
              <div className="flex gap-3">
                <button onClick={() => handleSend("whatsapp")} className="flex-1 h-12 rounded-full text-[14px] font-bold flex items-center justify-center gap-2" style={{ background: "#25D366", color: "#fff" }}>
                  <MessageCircle size={18} /> WhatsApp
                </button>
                <button onClick={() => handleSend("sms")} className="flex-1 h-12 rounded-full text-[14px] font-bold flex items-center justify-center gap-2" style={{ background: "var(--text-primary)", color: "var(--background)" }}>
                  <Smartphone size={18} /> SMS
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Group Reminder Sheet */}
      {showGroupSheet && (
        <GroupReminderSheet
          onSave={async (config, customerIds, name) => {
            try {
              await saveLocalGroup(config, customerIds, name);
              setShowGroupSheet(false);
              generateReminders({ customers, sales, t }).then(setAllReminders);
              loadLocalGroups().then(setReminderGroups);
            } catch (err) {
              console.error("Failed to save group:", err);
            }
          }}
          onClose={() => setShowGroupSheet(false)}
        />
      )}

      {/* Credit Request Action Sheet */}
      {creditAction && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setCreditAction(null)}>
          <div className="w-full max-w-[390px] mx-auto rounded-t-[24px] flex flex-col p-5 gap-4" style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
            </div>
            <p className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {creditAction.action === "approve" ? (isUrdu ? "درخواست منظور کریں" : "Approve Request") : (isUrdu ? "درخواست رد کریں" : "Reject Request")}
            </p>
            <div className="rounded-[12px] p-3 text-[13px]" style={{ background: "var(--surface-2)" }}>
              <p style={{ color: "var(--text-primary)" }} className="font-semibold">{creditAction.request.customerName}</p>
              <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
                {isUrdu ? "موجودہ حد" : "Current"}: {formatCurrency(creditAction.request.currentLimit)} → {isUrdu ? "نئی حد" : "New"}: {formatCurrency(creditAction.request.requestedLimit)}
              </p>
              <p style={{ color: "var(--text-secondary)" }}>
                {isUrdu ? "درخواست" : "By"}: {creditAction.request.requestedBy}
              </p>
              {creditAction.request.reason && (
                <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
                  {isUrdu ? "وجہ" : "Reason"}: {creditAction.request.reason}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              {creditAction.action === "reject" && (
                <button onClick={handleCreditAction} className="flex-1 h-12 rounded-full text-[14px] font-bold" style={{ background: "#dc2626", color: "#fff" }}>
                  {isUrdu ? "رد کریں" : "Reject"}
                </button>
              )}
              <button onClick={handleCreditAction} className="flex-1 h-12 rounded-full text-[14px] font-bold" style={{ background: creditAction.action === "approve" ? "var(--brand)" : "var(--surface-2)", color: creditAction.action === "approve" ? "#0a0a0a" : "var(--text-primary)" }}>
                {creditAction.action === "approve" ? (isUrdu ? "منظور کریں" : "Approve") : (isUrdu ? "رد کریں" : "Reject")}
              </button>
              <button onClick={() => setCreditAction(null)} className="flex-1 h-12 rounded-full text-[14px] font-bold" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                {isUrdu ? "منسوخ" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
