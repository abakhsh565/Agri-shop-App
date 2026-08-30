import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency } from "@/lib/formatters";
import { generateReminders, generateReminderMessage } from "@/lib/reminderEngine";
import type { GeneratedReminder } from "@/types";
import { Bell, MessageCircle, Smartphone, X } from "lucide-react";

interface ReminderLogEntry {
  id: string;
  customerId: string;
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

function logReminder(customerId: string, entry: ReminderLogEntry) {
  const logs = getReminderLogs(customerId);
  logs.unshift(entry);
  localStorage.setItem("reminder_logs_" + customerId, JSON.stringify(logs));
}

const TONE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  gentle: { color: "#3b82f6", bg: "#eff6ff", label: "Gentle reminder" },
  firmer: { color: "#f59e0b", bg: "#fffbeb", label: "Firmer follow-up" },
  final: { color: "#ef4444", bg: "#fef2f2", label: "Final notice" },
};

export default function RemindersOverviewPage() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customers = useCustomersStore((s) => s.customers);
  const sales = useSalesStore((s) => s.sales);

  const dueReminders = useMemo(
    () => generateReminders({ customers, sales, payments: [] }),
    [customers, sales]
  );

  const [editingReminder, setEditingReminder] = useState<GeneratedReminder | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const [sentKeys, setSentKeys] = useState<Set<string>>(new Set());

  const configuredCount = useMemo(
    () =>
      customers.filter((c) => {
        try {
          const r = localStorage.getItem("reminder_config_" + c.id);
          return r && JSON.parse(r).enabled;
        } catch {
          return false;
        }
      }).length,
    [customers]
  );

  const outstandingCount = customers.filter((c) => c.outstandingBalance > 0).length;

  function openSendSheet(reminder: GeneratedReminder) {
    setEditingReminder(reminder);
    setEditMessage(generateReminderMessage(reminder));
  }

  function sendVia(channel: "whatsapp" | "sms") {
    if (!editingReminder) return;
    const phone = editingReminder.customerPhone.replace(/[^0-9+]/g, "");
    const encodedMsg = encodeURIComponent(editMessage);
    const key = editingReminder.customerId + "-" + channel;

    if (channel === "whatsapp") {
      const waPhone = phone.startsWith("+")
        ? phone.slice(1)
        : phone.startsWith("0")
        ? "92" + phone.slice(1)
        : phone;
      window.open("https://wa.me/" + waPhone + "?text=" + encodedMsg, "_blank");
    } else {
      window.open("sms:" + phone + "?body=" + encodedMsg, "_blank");
    }

    logReminder(editingReminder.customerId, {
      id: "rem-" + Date.now(),
      customerId: editingReminder.customerId,
      type: editingReminder.tone,
      message: editMessage,
      channel,
      sentAt: new Date().toISOString(),
    });

    setSentKeys((prev) => new Set([...prev, key]));
    setEditingReminder(null);
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title="Reminders" />

      <div className="flex flex-col gap-3 px-4 pt-4 pb-8">
        {/* Summary */}
        <div className="flex gap-2.5">
          <div className="flex-1 rounded-[14px] p-3.5" style={{ background: "#FAEEDA" }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#854F0B" }}>
              CONFIGURED
            </p>
            <p className="text-[20px] font-bold mt-0.5" style={{ color: "#633806" }}>
              {configuredCount}
            </p>
          </div>
          <div className="flex-1 rounded-[14px] p-3.5" style={{ background: "#FCEBEB" }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#A32D2D" }}>
              DUE NOW
            </p>
            <p className="text-[20px] font-bold mt-0.5" style={{ color: "#791F1F" }}>
              {dueReminders.length}
            </p>
          </div>
          <div className="flex-1 rounded-[14px] p-3.5" style={{ background: "var(--surface-2)" }}>
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}
            >
              OUTSTANDING
            </p>
            <p className="text-[20px] font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {outstandingCount}
            </p>
          </div>
        </div>

        {/* Due reminders list */}
        {dueReminders.length === 0 ? (
          <div
            className="rounded-[14px] p-8 flex flex-col items-center gap-3"
            style={{ border: "1px solid var(--divider)" }}
          >
            <div
              className="size-12 rounded-full flex items-center justify-center"
              style={{ background: "var(--surface-2)" }}
            >
              <Bell size={20} style={{ color: "var(--text-secondary)" }} />
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              No reminders due
            </p>
            <p className="text-xs text-center" style={{ color: "var(--text-secondary)" }}>
              All caught up. Reminders will appear here when trigger conditions are met.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {dueReminders.map((r, i) => {
              const tc = TONE_CONFIG[r.tone] || TONE_CONFIG.gentle;
              const waSent = sentKeys.has(r.customerId + "-whatsapp");
              const smsSent = sentKeys.has(r.customerId + "-sms");
              return (
                <div
                  key={i}
                  className="rounded-[14px] p-4"
                  style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="size-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                      style={{ background: tc.bg, color: tc.color }}
                    >
                      {r.customerName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[14px] font-medium truncate"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {r.customerName}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: tc.bg, color: tc.color }}
                        >
                          {tc.label}
                        </span>
                        <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                          {r.triggerDetail}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
                        {formatCurrency(r.outstanding)}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                        outstanding
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => openSendSheet(r)}
                      className="flex-1 h-10 rounded-full text-[12px] font-bold flex items-center justify-center gap-2 transition-opacity active:opacity-70"
                      style={{ background: "var(--brand)", color: "#0a0a0a" }}
                    >
                      <MessageCircle size={14} /> Send Reminder
                    </button>
                    <button
                      onClick={() => navigate("/admin/customers/" + r.customerId)}
                      className="h-10 px-4 rounded-full text-[12px] font-medium flex items-center justify-center"
                      style={{ border: "1px solid var(--divider)", color: "var(--text-secondary)" }}
                    >
                      Profile
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
            </div>
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
            <div
              className="px-5 pb-6 flex flex-col gap-4 overflow-y-auto"
              style={{ flex: 1 }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="size-10 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{
                    background: TONE_CONFIG[editingReminder.tone].bg,
                    color: TONE_CONFIG[editingReminder.tone].color,
                  }}
                >
                  {editingReminder.customerName.charAt(0).toUpperCase()}
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

              <div className="flex items-center gap-2">
                <span
                  className="text-[11px] font-bold px-2 py-1 rounded-full"
                  style={{
                    background: TONE_CONFIG[editingReminder.tone].bg,
                    color: TONE_CONFIG[editingReminder.tone].color,
                  }}
                >
                  {TONE_CONFIG[editingReminder.tone].label}
                </span>
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {editingReminder.triggerDetail}
                </span>
              </div>

              <div>
                <label
                  className="text-[12px] font-semibold uppercase tracking-wide block mb-2"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Message
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

              <div className="flex gap-3">
                <button
                  onClick={() => sendVia("whatsapp")}
                  className="flex-1 h-12 rounded-full text-[14px] font-bold flex items-center justify-center gap-2 transition-opacity active:opacity-80"
                  style={{ background: "#25D366", color: "#fff" }}
                >
                  <MessageCircle size={18} /> WhatsApp
                </button>
                <button
                  onClick={() => sendVia("sms")}
                  className="flex-1 h-12 rounded-full text-[14px] font-bold flex items-center justify-center gap-2 transition-opacity active:opacity-80"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
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
