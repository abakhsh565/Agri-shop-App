import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import PaymentReminderCard from "@/components/ui/PaymentReminderCard";
import PaymentReminderSheet from "@/components/ui/PaymentReminderSheet";
import { useCustomersStore } from "@/stores/customersStore";
import { useThemeStore } from "@/stores/themeStore";
import { useAuthStore } from "@/stores/authStore";
import { useCompletePaymentReminder } from "@/hooks/useCompletePaymentReminder";
import { useUIStore } from "@/stores/uiStore";
import { useShellBase } from "@/lib/useShellBase";
import { Bell, ChevronRight, Clock, AlertTriangle, Plus } from "lucide-react";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { pkToday } from "@/lib/pkDate";
import { sortReminders, usePaymentReminderBook, setPaymentReminderStatus } from "@/lib/paymentReminders";
import type { PaymentReminder, PaymentReminderStatus } from "@/lib/paymentReminders";

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

/**
 * One customer's reminders: the owner's payment diary entries about them, then the messages the
 * shop has already sent.
 *
 * TWO KINDS OF REMINDER, ONE SCREEN (owner's request, 2026-10-31). A reminder set here is the
 * same row the payment-reminders book shows — written by `save_payment_reminder` with this
 * customer linked, so the same note appears in the book, on the receivable screen and here. It
 * is deliberately not a second, local note: the two sides reading one row is what makes them
 * agree about the day, the amount and whether it is done.
 *
 * The sent log above is a different thing and stays separate: those are messages that went out,
 * recorded by the reminder engine, and a diary entry never claims to have been sent.
 */
export default function ReminderHistoryPage() {
  const t = useT();
  const { customerId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));
  const customersReady = useCustomersStore((s) => s.ready);
  const isOwner = useAuthStore((s) => s.user?.membershipRole === "owner");
  const { addToast } = useUIStore();

  const [logs, setLogs] = useState<ReminderLogEntry[]>([]);
  const book = usePaymentReminderBook();
  const completeReminder = useCompletePaymentReminder();
  const [sheet, setSheet] = useState<{ open: boolean; reminder: PaymentReminder | null }>({
    open: false,
    reminder: null,
  });
  const today = pkToday();

  useEffect(() => {
    if (!customerId) return;
    // Only what was really sent is shown: an empty history stays empty.
    setLogs(getReminderLogs(customerId));
  }, [customerId]);

  // The book already carries both party ids; filtering here keeps one read for every screen and
  // means a reminder written in the book shows up on this page without a second query.
  const customerReminders = useMemo(
    () =>
      sortReminders(
        (book.rows ?? []).filter((r) => r.kind === "customer" && r.customerId === customerId),
        today,
      ),
    [book.rows, customerId, today],
  );

  async function markStatus(reminder: PaymentReminder, status: PaymentReminderStatus) {
    if (status === "completed") {
      await completeReminder(reminder, book.retry);
      return;
    }
    try {
      await setPaymentReminderStatus(reminder.id, status);
      addToast(t("paymentBook.reopened"), "success");
      book.retry();
    } catch {
      addToast(t("paymentBook.statusFailed"), "error");
    }
  }

  if (!customer) return customersReady ? null : <SkeletonList rows={4} />;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("customerProfile.reminderHistory")} historyBack />

      <div className="flex flex-col gap-6 px-4 pt-4 pb-8">
        {/* ── The owner's payment diary, for this customer ───────────────────── */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>
              {t("paymentBook.title")}
            </p>
            {/* The Finance book is owner-only. An employee's "Open" used to leave this screen
                for an owner route, where the route guard ended the employee session instead of
                showing the reminders already listed here. The rows on this page are the
                employee's view; only the owner gets the door to the full book. */}
            {isOwner && (
              <button
                type="button"
                onClick={() => navigate(`${base}/settings/hub/finance/reminders`)}
                data-testid="customer-reminders-open-book"
                className="flex items-center gap-1 text-11 font-semibold shrink-0 active:opacity-70"
                style={{ color: "var(--brand-dark)" }}
              >
                {t("paymentBook.openBook")}
                <ChevronRight size={12} />
              </button>
            )}
          </div>

          {isOwner && (
            <button
              type="button"
              onClick={() => setSheet({ open: true, reminder: null })}
              data-testid="customer-reminder-add"
              className="w-full flex items-center gap-2.5 rounded-[var(--radius-card)] p-3 text-start active:opacity-70"
              style={{ background: "var(--tone-card)" }}
            >
              <span
                className="size-9 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "var(--tone-sunken)", color: "var(--brand-dark)" }}
              >
                <Plus size={16} strokeWidth={2.5} />
              </span>
              <span className="min-w-0 flex-1 text-13 font-bold">
                {t("paymentBook.setForCustomer", { name: customer.name })}
              </span>
              <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
            </button>
          )}

          {book.failed ? (
            <p className="py-2 text-12" style={{ color: "var(--text-secondary)" }}>
              {t("cashPosition.remindersFailed")}
            </p>
          ) : book.rows === null ? (
            <SkeletonList rows={2} tile />
          ) : customerReminders.length === 0 ? (
            <p className="py-2 text-12" style={{ color: "var(--text-secondary)" }}>
              {t("paymentBook.emptyHint")}
            </p>
          ) : (
            customerReminders.map((reminder) => (
              <PaymentReminderCard
                key={reminder.id}
                reminder={reminder}
                today={today}
                testId={`customer-reminder-${reminder.id}`}
                onStatus={
                  isOwner ? (status) => { void markStatus(reminder, status); } : undefined
                }
                onEdit={isOwner ? () => setSheet({ open: true, reminder }) : undefined}
              />
            ))
          )}
        </section>

        {/* ── What the shop has already sent ─────────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <p className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>
            {t("paymentReminders.sent")}
          </p>

          {logs.length === 0 ? (
            <div
              className="rounded-[var(--radius-card)] p-8 flex flex-col items-center gap-3"
              style={{ border: "1px solid var(--divider)" }}
            >
              <div
                className="size-12 rounded-full flex items-center justify-center"
                style={{ background: "var(--tone-card)" }}
              >
                <Bell size={20} style={{ color: "var(--text-secondary)" }} />
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {t("reminders.noneSent")}
              </p>
              {/* Was an English sentence written into the JSX, so an Urdu reader got English
                  here and only here. */}
              <p className="text-xs text-center" style={{ color: "var(--text-secondary)" }}>
                {t("reminders.sentWillAppear")}
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
        </section>
      </div>

      <PaymentReminderSheet
        open={sheet.open}
        reminder={sheet.reminder}
        defaults={{
          kind: "customer",
          customerId: customer.id,
          title: t("paymentBook.titleFromCustomer", { name: customer.name }),
        }}
        onClose={() => setSheet({ open: false, reminder: null })}
        onSaved={() => {
          setSheet({ open: false, reminder: null });
          book.retry();
        }}
      />
    </div>
  );
}
