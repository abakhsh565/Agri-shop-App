import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useCustomersStore, type CreditLimitRequest } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useThemeStore } from "@/stores/themeStore";
import { computeLiveSignals, type LiveSignal, type SignalCategory, type SignalSeverity, type SignalAction, type CreditRequestInput } from "@/lib/signalEngine";
import { markSignalReviewed, isSignalSuppressed, isSignalEscalated, getSuppressionInterval, cleanupOldRecords } from "@/lib/signalSuppression";
import { formatCurrency } from "@/lib/formatters";
import { useT, tNow } from "@/lib/i18n";
import { generateReminders, generateReminderMessage, calculatePaymentStatus, markOccurrenceSent, categorizeReminders } from "@/lib/reminderEngine";
import type { GeneratedReminder } from "@/types";
import { MessageCircle, Smartphone, X, ChevronDown, ChevronUp, Bell, CheckCircle2, Clock, AlertTriangle, AlertOctagon, Info, Plus, Users, Trash2, Eye, Send, XCircle } from "lucide-react";
import GroupReminderSheet from "@/components/ui/GroupReminderSheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import {
  saveLocalGroup,
  loadLocalGroups,
  deleteLocalGroup,
  type LocalGroupEntry,
} from "@/lib/localGroupRegistry";
import {
  getCreditRequestsDB,
  approveCreditRequest,
  rejectCreditRequest,
  type LocalCreditRequest,
} from "@/lib/localGroupRegistry";

/* ── Types ── */
interface ReminderLogEntry {
  id: string;
  customerId: string;
  customerName?: string;
  customerImageUrl?: string;
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
    const customerIds = [...new Set(data.map((r: any) => r.customer_id).filter(Boolean))];
    let customerMap: Record<string, string> = {};
    if (customerIds.length > 0) {
      const { data: custs } = await supabase.from("customers").select("id, image_url").in("id", customerIds);
      (custs || []).forEach((c: any) => { customerMap[c.id] = c.image_url; });
    }
    return data.map((r: any) => ({
      id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerImageUrl: customerMap[r.customer_id] || undefined,
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
      className="w-full rounded-[var(--radius-card)] p-4 flex items-start gap-3 text-start transition-opacity active:opacity-70"
      style={{ background: cardBg }}
    >
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: iconBg, color: iconColor }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-14 font-bold" style={{ color: "var(--text-primary)" }}>{title}</p>
        <p className="text-12 mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{subtitle}</p>
      </div>
      <span className="text-12 font-bold shrink-0 mt-1" style={{ color: "var(--brand-dark, #65a30d)" }}>
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
    <div className="overflow-hidden transition-all">
      <ListRow
        onClick={() => setExpanded(!expanded)}
        tile={reminder.customerImage ? (
          <img src={reminder.customerImage} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-13 font-bold shrink-0" style={{ background: getAvatarColor(reminder.customerName), color: "#fff" }}>
            {getInitials(reminder.customerName)}
          </div>
        )}
        trailing={
          <div className="shrink-0 ms-1">
            {expanded ? <ChevronUp size={18} style={{ color: "var(--text-secondary)" }} /> : <ChevronDown size={18} style={{ color: "var(--text-secondary)" }} />}
          </div>
        }
      >
        <div className="min-w-0">
          <p className="text-15 font-semibold truncate" style={{ color: "var(--text-primary)" }}>{reminder.customerName}</p>
          <p className="text-13 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {formatCurrency(reminder.outstanding)} {t("reminders.outstanding")}
          </p>
        </div>
      </ListRow>

      <div className="px-4 pb-3 pt-0 flex items-center gap-2 flex-wrap">
        <span className="text-11 font-bold px-2.5 py-1 rounded-full" style={{ background: tc.bg, color: tc.color }}>
          {t(tc.labelKey as any)}
        </span>
        {isSent ? (
          <span className="text-11 font-bold px-2.5 py-1 rounded-full" style={{ background: "var(--brand-light, #d9f99d)", color: "var(--brand-dark, #65a30d)" }}>
            {t("reminders.sent")}
          </span>
        ) : (
          <span className="text-11 font-bold px-2.5 py-1 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
            {t(statusKey || "reminders.readyToSend")}
          </span>
        )}
        <span className="text-11" style={{ color: "var(--text-secondary)" }}>{reminder.triggerDetail}</span>
      </div>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3" style={{ borderTop: "1px solid var(--divider)" }}>
          <p className="text-10 font-bold uppercase tracking-wider pt-3" style={{ color: "var(--text-secondary)" }}>{t("common.message")}</p>
          <div className="rounded-[var(--radius-tile)] px-3 py-2.5" style={{ background: "var(--surface-2)" }}>
            <p className="text-13 leading-relaxed" style={{ color: "var(--text-primary)" }}>{generateReminderMessage(reminder)}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={(e) => { e.stopPropagation(); onSend(reminder); }} className="flex-1 h-12 rounded-full text-14 font-bold flex items-center justify-center gap-2" style={{ background: "#25D366", color: "#fff" }}>
              <MessageCircle size={18} /> WhatsApp
            </button>
            <button onClick={(e) => { e.stopPropagation(); onSend(reminder); }} className="flex-1 h-12 rounded-full text-14 font-bold flex items-center justify-center gap-2" style={{ background: "var(--text-primary)", color: "var(--background)" }}>
              <Smartphone size={18} /> SMS
            </button>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onNavigate(reminder.customerId); }} className="w-full h-10 rounded-full text-13 font-semibold flex items-center justify-center gap-2" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
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
  const name = log.customerName || t("common.customer");
  return (
    <ListRow
      tile={log.customerImageUrl ? (<img src={log.customerImageUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />) : (<div className="w-9 h-9 rounded-full flex items-center justify-center text-11 font-bold shrink-0" style={{ background: getAvatarColor(name), color: "#fff" }}>{getInitials(name)}</div>)}
      trailing={<span className="text-11 font-bold px-2.5 py-1 rounded-full shrink-0" style={{ background: "var(--brand-light, #d9f99d)", color: "var(--brand-dark, #65a30d)" }}>{t("common.sent")}</span>}
    >
      <div className="min-w-0">
        <p className="text-14 font-medium" style={{ color: "var(--text-primary)" }}>{name}</p>
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t(tc.labelKey as any)} · {channel} · {timeAgo(log.sentAt)}</p>
      </div>
    </ListRow>
  );
}

/* ── EmptyState ── */
function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="py-10 flex flex-col items-center gap-2">
      <div className="mb-1" style={{ color: "var(--text-secondary)", opacity: 0.5 }}>{icon}</div>
      <p className="text-13 font-medium" style={{ color: "var(--text-primary)" }}>{title}</p>
      <p className="text-12 text-center px-6" style={{ color: "var(--text-secondary)" }}>{subtitle}</p>
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
  const companies = useCompaniesStore((s) => s.companies);

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
    getCreditRequestsDB().then(setCreditRequests);
  }, []);
  // Refresh credit requests on mount and periodically
  useEffect(() => {
    const refresh = () => getCreditRequestsDB().then(setCreditRequests);
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
    stateSubTab || (stateTab === "followups" ? "ready" : stateTab === "groups" ? "" : "critical")
  );

  useEffect(() => {
    const t = (location.state as any)?.tab as string | undefined;
    const s = (location.state as any)?.subTab as string | undefined;
    if (t === "followups") { setMainTab("followups"); if (s) setSubTab(s); }
    else if (t === "groups") { setMainTab("groups"); setSubTab(""); }
    else if (t === "action") { setMainTab("action"); if (s) setSubTab(s); else setSubTab("critical"); }
  }, [location.state]);

  const [editingReminder, setEditingReminder] = useState<GeneratedReminder | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [sentOccurrenceKeys, setSentOccurrenceKeys] = useState<Set<string>>(new Set());
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

  /* ── Signal Suppression ── */
  const [suppressionVersion, setSuppressionVersion] = useState(0);

  useEffect(() => { cleanupOldRecords(); }, []);

  const handleReviewed = useCallback((signal: LiveSignal) => {
    markSignalReviewed(signal);
    setSuppressionVersion(v => v + 1);
  }, []);

  /* ── Pending credit requests as Critical signals ── */
  const creditRequestSignals: LiveSignal[] = useMemo(() =>
    creditRequests
      .filter(r => r.status === "pending")
      .map(r => ({
        id: `credit-request-${r.id}`,
        category: "credit_limit" as SignalCategory,
        severity: "critical" as SignalSeverity,
        priority: 85,
        entity_type: "customer" as const,
        entity_id: r.customerId,
        entity_name: r.customerName,
        title: r.customerName,
        detailKey: "signal.detailCreditRequest",
        detailParams: { from: Math.round(r.currentLimit).toLocaleString("en-PK"), to: Math.round(r.requestedLimit).toLocaleString("en-PK") },
        reason: `${tNow("common.creditRequestReason", {
          name: r.customerName,
          from: Math.round(r.currentLimit).toLocaleString("en-PK"),
          to: Math.round(r.requestedLimit).toLocaleString("en-PK"),
        })}${r.reason ? ` ${tNow("admin.reason")}: ${r.reason}` : ""}`,
        recommendedAction: "Approve or reject the request.",
        signalAction: "approve_reject" as SignalAction,
        value: r.requestedLimit,
        threshold: r.currentLimit,
        created_at: r.createdAt,
      })),
  [creditRequests]);

  /* ── Live Signals from Signal Engine + Credit Requests ── */
  const liveSignals = useMemo(() => {
    const engineSignals = computeLiveSignals({ customers, products, companies, now });
    return [...creditRequestSignals, ...engineSignals].sort((a, b) => b.priority - a.priority);
  }, [customers, products, companies, creditRequestSignals]);

  /* ── Filter through suppression ── */
  const visibleSignals = useMemo(() =>
    liveSignals.filter(s => {
      // Critical signals are never suppressed
      if (s.severity === "critical") return true;
      // Check escalation — if escalated, always show
      if (isSignalEscalated(s)) return true;
      // Check suppression
      const interval = getSuppressionInterval(s.severity);
      return !isSignalSuppressed(s.id, interval);
    }),
  [liveSignals, suppressionVersion]);

  const criticalSignals = useMemo(() =>
    visibleSignals.filter(s => s.severity === "critical"),
  [visibleSignals]);

  const warningSignals = useMemo(() =>
    visibleSignals.filter(s => s.severity === "warning"),
  [visibleSignals]);

  const infoSignals = useMemo(() =>
    visibleSignals.filter(s => s.severity === "info"),
  [visibleSignals]);

  /* ── Follow-ups categories ──
   * Use occurrence key (persistent identity) instead of customerId.
   * Occurrences with status 'sent' are excluded by generateReminders (only returns 'due' status).
   * sentOccurrenceKeys handles immediate UI updates before DB re-read.
   */
  const readyReminders = useMemo(() => {
    const { ready, future } = categorizeReminders(allReminders, sentOccurrenceKeys, now);
    return ready;
  }, [allReminders, sentOccurrenceKeys, now]);

  const upcomingReminders = useMemo(() => {
    const { ready, future } = categorizeReminders(allReminders, sentOccurrenceKeys, now);
    return future;
  }, [allReminders, sentOccurrenceKeys, now]);

  const sentLogs = useMemo(() => allLogs, [allLogs]);


  /* ── Sub-tabs using live signals ── */
  const actionSubTabs = [
    { key: "critical", label: t("inline.critical"), count: criticalSignals.length, color: "#dc2626" },
    { key: "warning", label: t("sale.warning"), count: warningSignals.length, color: "#d97706" },
    { key: "info", label: t("inline.info"), count: infoSignals.length, color: "#2563eb" },
  ];

  const followupSubTabs = [
    { key: "ready", label: t("inline.ready"), count: readyReminders.length, color: "var(--brand-dark, #65a30d)" },
    { key: "upcoming", label: t("inline.upcoming"), count: upcomingReminders.length, color: "#2563eb" },
    { key: "recently_sent", label: t("common.recentlySent"), count: sentLogs.length, color: "var(--text-secondary)" },
  ];

  const currentSubTabs = mainTab === "action" ? actionSubTabs : mainTab === "followups" ? followupSubTabs : [];

  function openSendSheet(reminder: GeneratedReminder) {
    setEditingReminder(reminder);
    setEditMessage(generateReminderMessage(reminder));
  }

  const handleSend = useCallback(async (channel: "whatsapp" | "sms") => {
    if (!editingReminder) return;
    const phone = editingReminder.customerPhone.replace(/[^0-9+]/g, "");
    const encodedMsg = encodeURIComponent(editMessage);
    const occKey = editingReminder._occurrenceKey || editingReminder.configId;

    // Persist reminder state to DB FIRST, before any external side effects.
    // This ensures the internal reminder state stays consistent even if the
    // external WhatsApp/SMS window fails to open or is blocked.
    if (editingReminder._occurrenceId) {
      await markOccurrenceSent(
        editingReminder._occurrenceId,
        editingReminder.customerId,
        editingReminder.customerName,
        editingReminder.configId,
        editingReminder.tone,
        editMessage,
        channel,
      );
    } else {
      // Fallback for reminders without occurrence tracking
      await logReminderToDb(editingReminder.customerId, editingReminder.customerName, {
        id: "rem-" + Date.now(),
        customerId: editingReminder.customerId,
        customerName: editingReminder.customerName,
        configId: editingReminder.configId,
        type: editingReminder.tone,
        message: editMessage,
        channel,
        sentAt: new Date().toISOString(),
      });
    }

    // Open external messaging window AFTER DB persistence is complete.
    if (channel === "whatsapp") {
      const waPhone = phone.startsWith("+") ? phone.slice(1) : phone.startsWith("0") ? "92" + phone.slice(1) : phone;
      window.open("https://wa.me/" + waPhone + "?text=" + encodedMsg, "_blank");
    } else {
      window.open("sms:" + phone + "?body=" + encodedMsg, "_blank");
    }

    // Immediate UI update: mark this occurrence key as sent
    setSentOccurrenceKeys(prev => new Set([...prev, occKey]));
    loadAllReminderLogs().then(setAllLogs);
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
      getCreditRequestsDB().then(setCreditRequests);
      setCreditAction(null);
    } catch (err) {
      console.error("Credit action failed:", err);
    }
  }, [creditAction]);

  /* ── Render action needed (signal-based) ── */
  function renderSignalCard(signal: LiveSignal) {
    const severityConfig: Record<string, { cardBg: string; iconBg: string; iconColor: string; icon: React.ReactNode }> = {
      critical: { cardBg: "rgba(220, 38, 38, 0.06)", iconBg: "rgba(220, 38, 38, 0.1)", iconColor: "#dc2626", icon: <AlertOctagon size={16} /> },
      warning: { cardBg: "rgba(217, 119, 6, 0.06)", iconBg: "rgba(217, 119, 6, 0.1)", iconColor: "#d97706", icon: <AlertTriangle size={16} /> },
      info: { cardBg: "var(--surface-2)", iconBg: "rgba(37, 99, 235, 0.1)", iconColor: "#2563eb", icon: <Info size={16} /> },
    };
    const config = severityConfig[signal.severity] || severityConfig.info;

    const onClick = () => {
      if (signal.entity_type === "customer") navigateToCustomer(signal.entity_id);
      else if (signal.entity_type === "product") navigate(`/admin/products/${signal.entity_id}`);
      else if (signal.entity_type === "company") navigate("/admin/companies");
    };

    return (
      <AlertCard
        key={signal.id}
        icon={config.icon}
        title={signal.title}
        subtitle={t(signal.detailKey, signal.detailParams)}
        actionLabel={t("admin.review")}
        cardBg={config.cardBg}
        iconBg={config.iconBg}
        iconColor={config.iconColor}
        onClick={() => {
          // Suppress non-critical signals on review
          if (signal.severity !== "critical") handleReviewed(signal);
          // Navigate to entity
          onClick();
        }}
      />
    );
  }

  function renderActionContent() {
    switch (subTab) {
      case "critical":
        return criticalSignals.length === 0 ? (
          <EmptyState icon={<AlertOctagon size={24} style={{ color: "var(--text-secondary)" }} />} title={t("inline.no_critical_actions")} subtitle={t("inline.no_critical_business_signals_right_now")} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {criticalSignals.map(s => renderSignalCard(s))}
          </div>
        );
      case "warning":
        return warningSignals.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={24} style={{ color: "var(--text-secondary)" }} />} title={t("inline.no_warnings")} subtitle={t("inline.everything_looks_fine")} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {warningSignals.map(s => renderSignalCard(s))}
          </div>
        );
      case "info":
        return infoSignals.length === 0 ? (
          <EmptyState icon={<Info size={24} style={{ color: "var(--text-secondary)" }} />} title={t("inline.no_info_signals")} subtitle={t("inline.all_information_is_complete")} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {infoSignals.map(s => renderSignalCard(s))}
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
          <EmptyState icon={<CheckCircle2 size={24} style={{ color: "var(--text-secondary)" }} />} title={t("reminders.allCaughtUp")} subtitle={t("inline.no_reminders_are_due_right_now")} />
        ) : (
          <ListCard className="mx-4">
            {readyReminders.map((r, i) => (
              <ReminderCard key={i} reminder={r} onSend={openSendSheet} onNavigate={navigateToCustomer} isSent={false} statusKey="reminders.readyToSend" />
            ))}
          </ListCard>
        );
      case "upcoming":
        return upcomingReminders.length === 0 ? (
          <EmptyState icon={<Clock size={24} style={{ color: "var(--text-secondary)" }} />} title={t("inline.no_upcoming_reminders")} subtitle={t("inline.configure_reminder_schedules_on_customer_pro")} />
        ) : (
          <ListCard className="mx-4">
            {upcomingReminders.map((r, i) => (
              <ReminderCard key={i} reminder={r} onSend={openSendSheet} onNavigate={navigateToCustomer} isSent={false} statusKey="reminders.futureReady" />
            ))}
          </ListCard>
        );
      case "recently_sent":
        return sentLogs.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={24} style={{ color: "var(--text-secondary)" }} />} title={t("inline.nothing_sent_yet")} subtitle={t("inline.sent_reminders_will_appear_here_after_you_se")} />
        ) : (
          <div>
            {(() => {
              const tenDaysAgo = new Date();
              tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
              const recentLogs = sentLogs.filter(l => new Date(l.sentAt) >= tenDaysAgo);
              const now2 = new Date();
              const todayStr = now2.toISOString().split("T")[0];
              const yesterday = new Date(now2); yesterday.setDate(yesterday.getDate() - 1);
              const yesterdayStr = yesterday.toISOString().split("T")[0];
              const groups: { heading: string; items: typeof recentLogs }[] = [];
              const byDate = new Map<string, typeof recentLogs>();
              for (const log of recentLogs) {
                const d = new Date(log.sentAt).toISOString().split("T")[0];
                if (!byDate.has(d)) byDate.set(d, []);
                byDate.get(d)!.push(log);
              }
              for (const [date, items] of byDate) {
                let heading = date;
                if (date === todayStr) heading = t("emp.today");
                else if (date === yesterdayStr) heading = t("sales.yesterday");
                groups.push({ heading, items });
              }
              return groups.map(g => (
                <div key={g.heading}>
                  <p className="px-4 pt-3 pb-1 text-10 font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{g.heading}</p>
                  <ListCard className="mx-4">
                  {g.items.map((log, i) => (
                    <ActivityItem key={log.id || i} log={log} />
                  ))}
                  </ListCard>
                </div>
              ));
            })()}
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
              title={t("inline.no_groups_yet")}
              subtitle={t("inline.create_a_group_reminder_to_manage_multiple_c")}
            />
            <button
              onClick={() => setShowGroupSheet(true)}
              className="flex items-center justify-center gap-2 h-11 rounded-full text-13 font-bold transition-transform active:scale-[0.97]"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              <Plus size={15} /> {t("inline.create_group_reminder_x")}
            </button>
          </div>
        ) : (
          <ListCard className="mx-4">
            {reminderGroups.map((group) => (
              <ListRow
                key={group.id}
                onClick={() => navigate(`/admin/alerts/groups/${group.id}`)}
                tile={
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "#ede9fe", color: "#7c3aed" }}>
                    <Users size={18} />
                  </div>
                }
                trailing={<ChevronDown size={16} style={{ color: "var(--text-secondary)", transform: "rotate(-90deg)" }} className="shrink-0" />}
              >
                <div className="min-w-0">
                  <p className="text-14 font-semibold truncate" style={{ color: "var(--text-primary)" }}>{group.name}</p>
                  <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {group.customerCount} {t("emp.customers")} · {group.config?.anchor === "before_due" ? `${group.config.startDays}d ${t("inline.before_due")}` : group.config?.anchor === "before_harvest" ? `${group.config.startDays}d ${t("reminder.beforeHarvest")}` : "—"}
                  </p>
                </div>
              </ListRow>
            ))}
            {/* Create button below groups list */}
            <div className="px-4 pt-4">
              <button
                onClick={() => setShowGroupSheet(true)}
                className="flex items-center justify-center gap-2 h-11 w-full rounded-full text-13 font-bold transition-transform active:scale-[0.97]"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                <Plus size={15} /> {t("inline.create_new_group")}
              </button>
            </div>
          </ListCard>
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
      <NavHeader title={t("inline.action_center")} />

      <div className="flex flex-col px-4 pt-4 pb-8 gap-4" style={{ overflowY: "auto", flex: 1 }}>
        {/* Main tabs — premium segmented control */}
        <div className="flex items-center gap-1 p-1 rounded-[var(--radius-tile)]" style={{ background: "var(--surface-2)" }}>
          {([
            { key: "action" as const, label: t("actions") },
            { key: "followups" as const, label: t("inline.follow_ups") },
            { key: "groups" as const, label: t("inline.group_reminder") },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setMainTab(tab.key); setSubTab(tab.key === "action" ? "critical" : tab.key === "followups" ? "ready" : ""); }}
              className="flex-1 text-center py-2 rounded-[var(--radius-tile)] text-13 font-semibold transition-all flex items-center justify-center gap-1.5"
              style={{
                color: mainTab === tab.key ? "var(--text-primary)" : "var(--text-secondary)",
                background: mainTab === tab.key ? "var(--background)" : "transparent",
                boxShadow: mainTab === tab.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {tab.label}
              {"count" in tab && (tab as any).count > 0 && (
                <span className="text-10 font-bold w-5 h-5 flex items-center justify-center rounded-full" style={{ background: mainTab === tab.key ? "var(--brand-dark, #65a30d)" : "var(--surface-2)", color: mainTab === tab.key ? "#fff" : "var(--text-secondary)", fontSize: '10px' }}>
                  {(tab as any).count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Sub tabs — refined text links with active underline */}
        {currentSubTabs.length > 0 && (
          <div className="flex items-center gap-5 overflow-x-auto no-scrollbar pt-1">
            {currentSubTabs.map(st => (
              <button
                key={st.key}
                onClick={() => setSubTab(st.key)}
                className="flex items-center gap-1.5 pb-2 text-12 font-medium whitespace-nowrap transition-all relative"
                style={{
                  color: subTab === st.key ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                {st.label}
                {st.count > 0 && (
                  <span className="text-10 font-bold w-5 h-5 flex items-center justify-center rounded-full" style={{
                    background: subTab === st.key ? "var(--text-secondary)" : "var(--surface-2)",
                    color: subTab === st.key ? "#fff" : "var(--text-secondary)",
                  }}>{st.count}</span>
                )}
                {subTab === st.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: "var(--text-secondary)" }} />
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
              <p className="text-16 font-semibold" style={{ color: "var(--text-primary)" }}>{t("inline.send_reminder")}</p>
              <button onClick={() => setEditingReminder(null)} className="size-8 rounded-full flex items-center justify-center" style={{ background: "var(--surface-2)" }}>
                <X size={16} style={{ color: "var(--text-secondary)" }} />
              </button>
            </div>
            <div className="px-5 pb-6 flex flex-col gap-4 overflow-y-auto" style={{ flex: 1 }}>
              <div className="flex items-center gap-3">
                {editingReminder.customerImage ? (
                  <img src={editingReminder.customerImage} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-13 font-bold shrink-0" style={{ background: getAvatarColor(editingReminder.customerName), color: "#fff" }}>
                    {getInitials(editingReminder.customerName)}
                  </div>
                )}
                <div>
                  <p className="text-14 font-medium" style={{ color: "var(--text-primary)" }}>{editingReminder.customerName}</p>
                  <p className="text-12" style={{ color: "var(--text-secondary)" }}>{editingReminder.customerPhone}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-11 font-bold px-2.5 py-1 rounded-full" style={{ background: TONE_CONFIG[editingReminder.tone].bg, color: TONE_CONFIG[editingReminder.tone].color }}>
                  {t(TONE_CONFIG[editingReminder.tone].labelKey as any)}
                </span>
                <span className="text-11" style={{ color: "var(--text-secondary)" }}>{editingReminder.triggerDetail}</span>
              </div>
              <div>
                <label className="text-11 font-semibold uppercase tracking-wider block mb-2" style={{ color: "var(--text-secondary)" }}>{t("common.message")}</label>
                <textarea value={editMessage} onChange={(e) => setEditMessage(e.target.value)} rows={5} className="w-full rounded-[var(--radius-card)] px-4 py-3 text-13 outline-none resize-none" style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-control)" }} />
              </div>
              <div className="flex gap-3">
                <button onClick={() => handleSend("whatsapp")} className="flex-1 h-12 rounded-full text-14 font-bold flex items-center justify-center gap-2" style={{ background: "#25D366", color: "#fff" }}>
                  <MessageCircle size={18} /> WhatsApp
                </button>
                <button onClick={() => handleSend("sms")} className="flex-1 h-12 rounded-full text-14 font-bold flex items-center justify-center gap-2" style={{ background: "var(--text-primary)", color: "var(--background)" }}>
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
            <p className="text-16 font-semibold" style={{ color: "var(--text-primary)" }}>
              {creditAction.action === "approve" ? (t("inline.approve_request")) : (t("superAdmin.rejectRequest"))}
            </p>
            <div className="rounded-[var(--radius-tile)] p-3 text-13" style={{ background: "var(--surface-2)" }}>
              <p style={{ color: "var(--text-primary)" }} className="font-semibold">{creditAction.request.customerName}</p>
              <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
                {t("inline.current")}: {formatCurrency(creditAction.request.currentLimit)} → {t("inline.new")}: {formatCurrency(creditAction.request.requestedLimit)}
              </p>
              <p style={{ color: "var(--text-secondary)" }}>
                {t("inline.by")}: {creditAction.request.requestedBy}
              </p>
              {creditAction.request.reason && (
                <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
                  {t("admin.reason")}: {creditAction.request.reason}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              {creditAction.action === "reject" && (
                <button onClick={handleCreditAction} className="flex-1 h-12 rounded-full text-14 font-bold" style={{ background: "#dc2626", color: "#fff" }}>
                  {t("superAdmin.reject")}
                </button>
              )}
              <button onClick={handleCreditAction} className="flex-1 h-12 rounded-full text-14 font-bold" style={{ background: creditAction.action === "approve" ? "var(--brand)" : "var(--surface-2)", color: creditAction.action === "approve" ? "#0a0a0a" : "var(--text-primary)" }}>
                {creditAction.action === "approve" ? (t("superAdmin.approve")) : (t("superAdmin.reject"))}
              </button>
              <button onClick={() => setCreditAction(null)} className="flex-1 h-12 rounded-full text-14 font-bold" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
