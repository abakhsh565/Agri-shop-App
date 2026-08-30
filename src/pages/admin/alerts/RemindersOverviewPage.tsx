import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency } from "@/lib/formatters";
import { generateReminders, generateReminderMessage, seedMockReminderData } from "@/lib/reminderEngine";
import type { GeneratedReminder } from "@/types";
import { MessageCircle, Smartphone, X, ChevronDown, ChevronUp, Bell, CheckCircle2, Clock } from "lucide-react";

/* ── Types ── */
interface ReminderLogEntry {
  id: string;
  customerId: string;
  customerName?: string;
  type: "gentle" | "firmer" | "final";
  message: string;
  channel: string;
  sentAt: string;
}

function getReminderLogs(customerId: string): ReminderLogEntry[] {
  try {
    const raw = localStorage.getItem("reminder_logs_" + customerId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function getAllReminderLogs(): ReminderLogEntry[] {
  const all: ReminderLogEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("reminder_logs_")) {
      try {
        const logs = JSON.parse(localStorage.getItem(key) || "[]");
        // Filter entries that have at minimum an id and sentAt
        const valid = Array.isArray(logs) ? logs.filter((l: ReminderLogEntry) => l && l.id && l.sentAt) : [];
        all.push(...valid);
      } catch { /* skip */ }
    }
  }
  return all.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
}

function logReminder(customerId: string, customerName: string, entry: ReminderLogEntry) {
  const logs = getReminderLogs(customerId);
  logs.unshift(entry);
  localStorage.setItem("reminder_logs_" + customerId, JSON.stringify(logs));
}

/* ── Tone config using brand palette ── */
const TONE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  gentle: { color: "var(--brand-dark, #65a30d)", bg: "var(--brand-light, #d9f99d)", label: "Gentle" },
  firmer: { color: "#b45309", bg: "#fef3c7", label: "Firmer" },
  final:  { color: "#dc2626", bg: "#fee2e2", label: "Final" },
};

const TAB_CONFIG = [
  { key: "ready", label: "Ready to Send", icon: MessageCircle },
  { key: "future", label: "Future Ready", icon: Clock },
  { key: "sent", label: "Recently Sent", icon: CheckCircle2 },
] as const;

type TabKey = typeof TAB_CONFIG[number]["key"];

/* ── Helper: get initials ── */
function getInitials(name: string | undefined): string {
  const n = name || "U";
  return n.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

/* ── Helper: get avatar color based on name hash ── */
function getAvatarColor(name: string | undefined): string {
  const colors = [
    "#65a30d", "#2563eb", "#7c3aed", "#db2777", "#ea580c",
    "#0891b2", "#4f46e5", "#16a34a", "#9333ea", "#dc2626",
  ];
  const n = name || "U";
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = n.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

/* ── Helper: relative time ── */
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

/* ── Reminder card (collapsible) ── */
function ReminderCard({
  reminder,
  onSend,
  isSent,
  accentColor,
}: {
  reminder: GeneratedReminder;
  onSend: (r: GeneratedReminder) => void;
  isSent: boolean;
  accentColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const tc = TONE_CONFIG[reminder.tone] || TONE_CONFIG.gentle;

  return (
    <div
      className="rounded-[16px] overflow-hidden transition-all"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--divider)",
      }}
    >
      {/* Card header — always visible */}
      <button
        className="w-full flex items-center gap-3 p-4 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Avatar */}
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0"
          style={{ background: getAvatarColor(reminder.customerName), color: "#fff" }}
        >
          {getInitials(reminder.customerName)}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
            {reminder.customerName}
          </p>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {formatCurrency(reminder.outstanding)} outstanding
          </p>
        </div>

        {/* Chevron */}
        <div className="shrink-0 ml-1">
          {expanded ? (
            <ChevronUp size={18} style={{ color: "var(--text-secondary)" }} />
          ) : (
            <ChevronDown size={18} style={{ color: "var(--text-secondary)" }} />
          )}
        </div>
      </button>

      {/* Tags row — below header */}
      <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
        <span
          className="text-[11px] font-bold px-2.5 py-1 rounded-full"
          style={{ background: tc.bg, color: tc.color }}
        >
          {tc.label}
        </span>
        {isSent ? (
          <span
            className="text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: "var(--brand-light, #d9f99d)", color: "var(--brand-dark, #65a30d)" }}
          >
            Sent
          </span>
        ) : (
          <span
            className="text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            Ready to Send
          </span>
        )}
        <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
          {reminder.triggerDetail}
        </span>
      </div>

      {/* Expanded — message + buttons */}
      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3" style={{ borderTop: "1px solid var(--divider)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wider pt-3" style={{ color: "var(--text-secondary)" }}>
            Message — Editable
          </p>
          <div
            className="rounded-[14px] px-4 py-3"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
          >
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
              {generateReminderMessage(reminder)}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); onSend(reminder); }}
              className="flex-1 h-12 rounded-full text-[14px] font-bold flex items-center justify-center gap-2"
              style={{ background: "#25D366", color: "#fff" }}
            >
              <MessageCircle size={18} /> WhatsApp
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onSend(reminder); }}
              className="flex-1 h-12 rounded-full text-[14px] font-bold flex items-center justify-center gap-2"
              style={{ background: "var(--text-primary)", color: "var(--background)" }}
            >
              <Smartphone size={18} /> SMS
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Activity item ── */
function ActivityItem({ log }: { log: ReminderLogEntry }) {
  const tc = TONE_CONFIG[log.type] || TONE_CONFIG.gentle;
  const channel = (log.channel || "sent").toUpperCase();
  const name = log.customerName || "Customer";
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-[12px]"
      style={{ borderBottom: "1px solid var(--divider)" }}
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
        style={{ background: getAvatarColor(name), color: "#fff" }}
      >
        {getInitials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
          {name}
        </p>
        <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          {tc.label} · {channel} · {timeAgo(log.sentAt)}
        </p>
      </div>
      <span
        className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0"
        style={{ background: "var(--brand-light, #d9f99d)", color: "var(--brand-dark, #65a30d)" }}
      >
        Sent
      </span>
    </div>
  );
}

/* ── Main page ── */
export default function RemindersOverviewPage() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customers = useCustomersStore((s) => s.customers);
  const sales = useSalesStore((s) => s.sales);

  useEffect(() => { if (customers.length > 0) seedMockReminderData(customers); }, [customers]);

  const allReminders = useMemo(
    () => generateReminders({ customers, sales, payments: [] }),
    [customers, sales]
  );

  const [activeTab, setActiveTab] = useState<TabKey>("ready");
  const [editingReminder, setEditingReminder] = useState<GeneratedReminder | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [sentKeys, setSentKeys] = useState<Set<string>>(new Set());
  const [allLogs, setAllLogs] = useState<ReminderLogEntry[]>(getAllReminderLogs);

  // Refresh logs periodically
  useEffect(() => {
    const timer = setInterval(() => setAllLogs(getAllReminderLogs()), 5000);
    return () => clearInterval(timer);
  }, []);

  // Lock background scroll when bottom sheet open
  useEffect(() => {
    if (editingReminder) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [editingReminder]);

  // Filter reminders into tabs
  const readyReminders = useMemo(() => {
    return allReminders.filter(r => !sentKeys.has(r.customerId + "-sent"));
  }, [allReminders, sentKeys]);

  const futureReminders = useMemo(() => {
    // Show reminders that have a future trigger (not yet due)
    return allReminders.filter(r => {
      const config = localStorage.getItem("reminder_config_" + r.customerId);
      if (!config) return false;
      try {
        const c = JSON.parse(config);
        if (c.repeat === "escalate") {
          return c.escalation.some((e: { day: number }) => e.day > 0);
        }
        return true;
      } catch { return false; }
    }).slice(0, 5);
  }, [allReminders]);

  const sentLogs = useMemo(() => allLogs, [allLogs]);

  const configuredCount = useMemo(
    () => customers.filter((c) => {
      try { const r = localStorage.getItem("reminder_config_" + c.id); return r && JSON.parse(r).enabled; }
      catch { return false; }
    }).length,
    [customers]
  );

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

    logReminder(editingReminder.customerId, editingReminder.customerName, {
      id: "rem-" + Date.now(),
      customerId: editingReminder.customerId,
      customerName: editingReminder.customerName,
      type: editingReminder.tone,
      message: editMessage,
      channel,
      sentAt: new Date().toISOString(),
    });

    setSentKeys(prev => new Set([...prev, key]));
    setAllLogs(getAllReminderLogs());
    setEditingReminder(null);
  }, [editingReminder, editMessage]);

  function renderTabContent() {
    switch (activeTab) {
      case "ready":
        return readyReminders.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={24} style={{ color: "var(--text-secondary)" }} />}
            title="All caught up"
            subtitle="No reminders are due right now. They'll appear here when trigger conditions are met."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {readyReminders.map((r, i) => (
              <ReminderCard
                key={i}
                reminder={r}
                onSend={openSendSheet}
                isSent={false}
                accentColor="var(--brand)"
              />
            ))}
          </div>
        );

      case "future":
        return futureReminders.length === 0 ? (
          <EmptyState
            icon={<Clock size={24} style={{ color: "var(--text-secondary)" }} />}
            title="No future reminders"
            subtitle="Configure reminder schedules on customer profiles to see upcoming reminders here."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {futureReminders.map((r, i) => (
              <ReminderCard
                key={i}
                reminder={r}
                onSend={openSendSheet}
                isSent={false}
                accentColor="var(--brand)"
              />
            ))}
          </div>
        );

      case "sent":
        return sentLogs.length === 0 ? (
          <EmptyState
            icon={<Bell size={24} style={{ color: "var(--text-secondary)" }} />}
            title="No sent reminders yet"
            subtitle="Reminders you send will appear here with full details."
          />
        ) : (
          <div className="flex flex-col">
            {sentLogs.map((log, i) => (
              <ActivityItem key={log.id || i} log={log} />
            ))}
          </div>
        );
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title="Reminders" />

      <div className="flex flex-col gap-4 px-4 pt-4 pb-8">
        {/* Summary cards */}
        <div className="flex gap-2.5">
          <SummaryCard
            label="CONFIGURED"
            value={configuredCount}
            bg="var(--brand-light, #d9f99d)"
            labelColor="var(--brand-dark, #65a30d)"
            valueColor="var(--brand-dark, #65a30d)"
          />
          <SummaryCard
            label="DUE NOW"
            value={readyReminders.length}
            bg="#fef3c7"
            labelColor="#b45309"
            valueColor="#b45309"
          />
          <SummaryCard
            label="SENT"
            value={sentLogs.length}
            bg="var(--surface-2)"
            labelColor="var(--text-secondary)"
            valueColor="var(--text-primary)"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-[14px]" style={{ background: "var(--surface-2)" }}>
          {TAB_CONFIG.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-[10px] text-[12px] font-semibold transition-all"
                style={{
                  background: isActive ? "var(--surface)" : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {renderTabContent()}
      </div>

      {/* Send reminder bottom sheet */}
      {editingReminder && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setEditingReminder(null)}
        >
          <div
            className="w-full max-w-[390px] mx-auto rounded-t-[24px] flex flex-col"
            style={{ background: "var(--surface)", maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
            </div>

            {/* Header */}
            <div className="px-5 pb-4 flex items-center justify-between">
              <p className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>
                Send Reminder
              </p>
              <button
                onClick={() => setEditingReminder(null)}
                className="size-8 rounded-full flex items-center justify-center"
                style={{ background: "var(--surface-2)" }}
              >
                <X size={16} style={{ color: "var(--text-secondary)" }} />
              </button>
            </div>

            <div className="px-5 pb-6 flex flex-col gap-4 overflow-y-auto" style={{ flex: 1 }}>
              {/* Customer info */}
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0"
                  style={{ background: getAvatarColor(editingReminder.customerName), color: "#fff" }}
                >
                  {getInitials(editingReminder.customerName)}
                </div>
                <div>
                  <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                    {editingReminder.customerName}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                    {editingReminder.customerPhone}
                  </p>
                </div>
              </div>

              {/* Tone + trigger */}
              <div className="flex items-center gap-2">
                <span
                  className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                  style={{ background: TONE_CONFIG[editingReminder.tone].bg, color: TONE_CONFIG[editingReminder.tone].color }}
                >
                  {TONE_CONFIG[editingReminder.tone].label}
                </span>
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {editingReminder.triggerDetail}
                </span>
              </div>

              {/* Message */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "var(--text-secondary)" }}>
                  Message — Editable
                </label>
                <textarea
                  value={editMessage}
                  onChange={(e) => setEditMessage(e.target.value)}
                  rows={5}
                  className="w-full rounded-[14px] px-4 py-3 text-[13px] outline-none resize-none"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--divider)",
                  }}
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => handleSend("whatsapp")}
                  className="flex-1 h-12 rounded-full text-[14px] font-bold flex items-center justify-center gap-2"
                  style={{ background: "#25D366", color: "#fff" }}
                >
                  <MessageCircle size={18} /> WhatsApp
                </button>
                <button
                  onClick={() => handleSend("sms")}
                  className="flex-1 h-12 rounded-full text-[14px] font-bold flex items-center justify-center gap-2"
                  style={{ background: "var(--text-primary)", color: "var(--background)" }}
                >
                  <Smartphone size={18} /> SMS
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function SummaryCard({
  label,
  value,
  bg,
  labelColor,
  valueColor,
}: {
  label: string;
  value: number;
  bg: string;
  labelColor: string;
  valueColor: string;
}) {
  return (
    <div className="flex-1 rounded-[14px] p-3.5" style={{ background: bg }}>
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: labelColor }}>
        {label}
      </p>
      <p className="text-[20px] font-bold mt-0.5" style={{ color: valueColor }}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div
      className="rounded-[14px] p-8 flex flex-col items-center gap-3"
      style={{ border: "1px solid var(--divider)" }}
    >
      <div className="size-12 rounded-full flex items-center justify-center" style={{ background: "var(--surface-2)" }}>
        {icon}
      </div>
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{title}</p>
      <p className="text-xs text-center" style={{ color: "var(--text-secondary)" }}>{subtitle}</p>
    </div>
  );
}
