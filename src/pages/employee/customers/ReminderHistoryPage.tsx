import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useCustomersStore } from "@/stores/customersStore";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { Bell, Clock, AlertTriangle, CheckCircle } from "lucide-react";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";

interface ReminderLogEntry {
  id: string;
  customerId: string;
  type: "gentle" | "firmer" | "final";
  message: string;
  sentAt: string;
}

function getReminderLogs(customerId: string): ReminderLogEntry[] {
  try {
    const raw = localStorage.getItem("reminder_logs_" + customerId);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  return days + "d ago";
}

const TYPE_CONFIG = {
  gentle: { color: "#3b82f6", bg: "#eff6ff", icon: Clock, label: "Gentle nudge" },
  firmer: { color: "#f59e0b", bg: "#fffbeb", icon: AlertTriangle, label: "Firmer follow-up" },
  final: { color: "#ef4444", bg: "#fef2f2", icon: Bell, label: "Final notice" },
};

export default function ReminderHistoryPage() {
  const t = useT();
  const { customerId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));
  const customersReady = useCustomersStore((s) => s.ready);

  const [logs, setLogs] = useState<ReminderLogEntry[]>([]);

  useEffect(() => {
    if (!customerId) return;
    // Only what was really sent is shown: an empty history stays empty.
    setLogs(getReminderLogs(customerId));
  }, [customerId]);

  if (!customer) return customersReady ? null : <SkeletonList rows={4} />;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("customerProfile.reminderHistory")} />

      <div className="flex flex-col gap-3 px-4 pt-4 pb-8">
        {logs.length === 0 ? (
          <div
            className="rounded-[var(--radius-card)] p-8 flex flex-col items-center gap-3"
            style={{ border: "1px solid var(--divider)" }}
          >
            <div
              className="size-12 rounded-full flex items-center justify-center"
              style={{ background: "var(--surface-2)" }}
            >
              <Bell size={20} style={{ color: "var(--text-secondary)" }} />
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {t("reminders.noneSent")}
            </p>
            <p className="text-xs text-center" style={{ color: "var(--text-secondary)" }}>
              Configure a reminder schedule for {customer.name} to start tracking reminders.
            </p>
          </div>
        ) : (
          <ListCard>
            {logs.map((log) => {
              const config = TYPE_CONFIG[log.type];
              const Icon = config.icon;
              return (
                <ListRow
                  key={log.id}
                  tile={
                    <div
                      className="size-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: config.bg }}
                    >
                      <Icon size={14} style={{ color: config.color }} />
                    </div>
                  }
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-10 font-bold px-1.5 py-0.5 rounded-full"
                        style={{ color: config.color, background: config.bg }}
                      >
                        {config.label}
                      </span>
                    </div>
                    <p className="text-12 mt-1" style={{ color: "var(--text-primary)" }}>
                      {log.message}
                    </p>
                    <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                      {formatRelativeTime(log.sentAt)}
                    </p>
                  </div>
                </ListRow>
              );
            })}
          </ListCard>
        )}
      </div>
    </div>
  );
}
