import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { BellRing, ChevronRight, Plus } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PaymentReminderCard from "@/components/ui/PaymentReminderCard";
import PaymentReminderSheet from "@/components/ui/PaymentReminderSheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { hasPermission } from "@/lib/tenantContext";
import { pkToday } from "@/lib/pkDate";
import {
  deletePaymentReminder,
  setPaymentReminderStatus,
  sortReminders,
  usePaymentReminderBook,
  type PaymentReminder,
  type PaymentReminderStatus,
} from "@/lib/paymentReminders";

/**
 * Payment reminders — the whole diary, in one place.
 *
 * WHY IT LIVES IN FINANCE. 0256 put a reminder on the cash screen, which answered "what is coming
 * in or out of this month's cash". The owner then asked for the same note about a customer, a
 * supplier, or a payment with no record at all, and for one screen that holds all of them. That is
 * a money screen, so it sits in the Finance hub beside the cash position and the ledger.
 *
 * WHY THE CLOSED ONES ARE STILL HERE. A reminder that was done or dropped is not deleted — the
 * owner asked to look back at it. The four chips are the four states the database records, and the
 * counts are the rows below them, so a tab cannot say "3" and open an empty list.
 *
 * NOTHING IS CLAIMED TO HAVE BEEN SENT. There is no scheduler and no message: a card states the day
 * the reminder next falls and, once closed, the day it was about. Marking it done records the
 * owner's decision and moves no money.
 */
type View = "upcoming" | PaymentReminderStatus | "all";

export default function PaymentRemindersBookPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const book = usePaymentReminderBook();
  // Writing is the owner's own note, so a role that may read the diary is not offered controls
  // the database will refuse.
  const isOwner = useAuthStore((s) => s.user?.membershipRole === "owner");

  const [view, setView] = useState<View>("upcoming");
  const [sheet, setSheet] = useState<{ open: boolean; reminder: PaymentReminder | null }>({
    open: false,
    reminder: null,
  });
  const [removing, setRemoving] = useState<PaymentReminder | null>(null);
  const [working, setWorking] = useState(false);
  const today = pkToday();

  const rows = useMemo(() => book.rows ?? [], [book.rows]);

  const counts = useMemo(
    () => ({
      upcoming: rows.filter((r) => r.status === "upcoming").length,
      completed: rows.filter((r) => r.status === "completed").length,
      cancelled: rows.filter((r) => r.status === "cancelled").length,
      all: rows.length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const filtered = view === "all" ? rows : rows.filter((r) => r.status === view);
    // Open ones read as a calendar; closed ones read as a history, newest day first.
    if (view === "upcoming") return sortReminders(filtered, today);
    return [...filtered].sort((a, b) => (a.dueOn < b.dueOn ? 1 : a.dueOn > b.dueOn ? -1 : 0));
  }, [rows, view, today]);

  // The diary is about money, so reading it asks for the same grant the cash screen does. The
  // grant is checked here rather than in a route wrapper because the wrapper is not a screen the
  // index can map; a deep link from a role without it lands back on Finance, where the row is
  // already hidden. This sits after every hook, so the component's hook order never changes.
  if (!hasPermission("payments.view")) {
    return <Navigate to={`${base}/settings/hub/finance`} replace />;
  }

  async function markStatus(reminder: PaymentReminder, status: PaymentReminderStatus) {
    try {
      await setPaymentReminderStatus(reminder.id, status);
      addToast(
        status === "completed" ? t("paymentBook.markedDone") : t("paymentBook.reopened"),
        "success",
      );
      book.retry();
    } catch {
      addToast(t("paymentBook.statusFailed"), "error");
    }
  }

  async function remove() {
    if (!removing) return;
    setWorking(true);
    try {
      await deletePaymentReminder(removing.id);
      addToast(t("cashPosition.reminderDeleted"), "success");
      setRemoving(null);
      book.retry();
    } catch {
      addToast(t("paymentBook.deleteFailed"), "error");
    } finally {
      setWorking(false);
    }
  }

  const tabs: { key: View; label: string; count: number }[] = [
    { key: "upcoming", label: t("paymentBook.upcoming"), count: counts.upcoming },
    { key: "completed", label: t("paymentBook.statusCompleted"), count: counts.completed },
    { key: "cancelled", label: t("paymentBook.statusCancelled"), count: counts.cancelled },
    { key: "all", label: t("paymentBook.all"), count: counts.all },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="payment-reminders-book"
    >
      <StatusBar />
      <NavHeader title={t("paymentBook.title")} backTo={`${base}/settings/hub/finance`} historyBack />

      {isOwner && (
      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={() => setSheet({ open: true, reminder: null })}
          data-testid="reminder-book-add"
          className="w-full flex items-center gap-3 rounded-[var(--radius-card)] p-3 text-start active:opacity-70"
          style={{ background: "var(--tone-card)" }}
        >
          <span
            className="size-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--tone-sunken)", color: "var(--brand-dark)" }}
          >
            <Plus size={18} strokeWidth={2.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-13 font-bold">{t("paymentBook.add")}</span>
            <span className="block text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {t("paymentBook.addHint")}
            </span>
          </span>
          <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
        </button>
      </div>
      )}

      <div className="flex gap-2 px-4 pt-3 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setView(tab.key)}
            aria-pressed={view === tab.key}
            data-testid={`reminder-book-tab-${tab.key}`}
            className="shrink-0 h-9 px-4 rounded-full text-12 font-semibold transition-colors active:opacity-70"
            style={
              view === tab.key
                ? { background: "var(--brand)", color: "#0a0a0a" }
                : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
            }
          >
            {tab.label} · {tab.count}
          </button>
        ))}
      </div>

      {book.rows === null && !book.failed ? (
        <SkeletonList rows={4} tile />
      ) : book.failed ? (
        <div className="px-6 pt-10 flex flex-col items-center gap-2 text-center">
          <BellRing size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>
            {t("cashPosition.remindersFailed")}
          </p>
          <button
            type="button"
            onClick={book.retry}
            className="text-12 font-bold underline underline-offset-2"
            style={{ color: "var(--brand-dark)" }}
          >
            {t("paymentBook.tryAgain")}
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="px-6 pt-12 flex flex-col items-center gap-2 text-center">
          <BellRing size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-14 font-semibold">{t("paymentBook.empty")}</p>
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("paymentBook.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pt-3 pb-8">
          {visible.map((reminder) => (
            <PaymentReminderCard
              key={reminder.id}
              reminder={reminder}
              today={today}
              testId={`reminder-book-${reminder.id}`}
              // The diary and the party's own screen read one row (0257); this is the link back,
              // so a reminder set here is findable where the customer or supplier is managed.
              onOpenParty={
                reminder.kind === "customer" && reminder.customerId
                  ? () => navigate(`${base}/customers/${reminder.customerId}`)
                  : reminder.kind === "supplier" && reminder.companyId
                    ? () => navigate(`${base}/companies/${reminder.companyId}`)
                    : undefined
              }
              onStatus={isOwner ? (status) => { void markStatus(reminder, status); } : undefined}
              onEdit={isOwner ? () => setSheet({ open: true, reminder }) : undefined}
              onDelete={isOwner ? () => setRemoving(reminder) : undefined}
            />
          ))}
        </div>
      )}

      <PaymentReminderSheet
        open={sheet.open}
        reminder={sheet.reminder}
        onClose={() => setSheet({ open: false, reminder: null })}
        onSaved={book.retry}
      />

      <ConfirmDialog
        open={removing !== null}
        title={t("cashPosition.deleteReminderTitle")}
        message={t("cashPosition.deleteReminderMessage", { title: removing?.title ?? "" })}
        confirmLabel={working ? t("common.saving") : t("common.delete")}
        onConfirm={() => { void remove(); }}
        onCancel={() => setRemoving(null)}
        destructive
        loading={working}
      />
    </div>
  );
}
