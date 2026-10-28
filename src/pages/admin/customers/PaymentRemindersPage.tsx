import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, ChevronRight } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { useShopStore } from "@/stores/shopStore";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import {
  categorizeReminders,
  generateReminders,
  getPaymentStatusColor,
  getPaymentStatusLabel,
  loadReminderLogs,
} from "@/lib/reminderEngine";
import type { GeneratedReminder } from "@/types";

type ReminderLog = {
  id: string;
  customerId: string;
  customerName?: string;
  message: string;
  channel: string;
  sentAt: string;
};

type ReminderView = "ready" | "scheduled" | "sent";

/**
 * Payment reminders: who is ready to be chased, what is scheduled, and what has gone out.
 *
 * SHAPE (owner's reference, 2026-10-28): two counts, the three states the app can actually
 * prove — Ready, Scheduled, Sent — then one card per customer with the amount, the next
 * reminder, and the two ways into the record.
 *
 * ONLY WHAT THE APP RECORDS. The engine produces occurrences and `reminder_logs` records what
 * was sent; there is no delivery-failure table and no "paid" reminder state, so those chips are
 * not drawn. A chip that always reads zero would be an invented status, and a card would have
 * nothing real to say under it.
 *
 * READY IS THE ENGINE'S OWN ANSWER. `categorizeReminders` splits the generated occurrences by
 * date (due → ready, future → scheduled), and Sent is the log the send path already writes. The
 * counts are the rows below them, so a tab cannot say "6" and open an empty list.
 */
export default function PaymentRemindersPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);
  const sales = useSalesStore((s) => s.sales);
  const branchName = useShopStore((s) => s.activeBranchName);

  const [reminders, setReminders] = useState<GeneratedReminder[] | null>(null);
  const [logs, setLogs] = useState<ReminderLog[] | null>(null);
  const [view, setView] = useState<ReminderView>("ready");

  useEffect(() => {
    if (!customersReady) return;
    let live = true;
    // The engine is the same one the Action Center uses; it reads the schedules the owner
    // configured on customer profiles and materialises the occurrences the database stores.
    generateReminders({ customers, sales, t }).then((next) => {
      if (live) setReminders(next);
    });
    return () => { live = false; };
    // `t` is deliberately not a dependency: it changes identity with the render, and the
    // engine's copy is only used for the labels it carries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, sales, customersReady]);

  useEffect(() => {
    let live = true;
    loadReminderLogs().then((next) => {
      if (live) setLogs(next as ReminderLog[]);
    });
    return () => { live = false; };
  }, []);

  const { ready, future } = useMemo(
    () => categorizeReminders(reminders ?? [], new Set(), new Date()),
    [reminders],
  );

  // `loadReminderLogs` carries the subject's id, not its name; the customer list is already
  // loaded, so the log cards can say who the reminder went to without a second query.
  const nameById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer.name])),
    [customers],
  );

  const tabs: { key: ReminderView; label: string; count: number }[] = [
    { key: "ready", label: t("paymentReminders.ready"), count: ready.length },
    { key: "scheduled", label: t("paymentReminders.scheduled"), count: future.length },
    { key: "sent", label: t("paymentReminders.sent"), count: logs?.length ?? 0 },
  ];

  const openCustomer = (customerId: string) => navigate(`${base}/customers/${customerId}`);
  const openHistory = (customerId: string) => navigate(`${base}/customers/${customerId}/reminders`);

  const card = (reminder: GeneratedReminder, state: "ready" | "scheduled") => {
    const statusColor = getPaymentStatusColor(reminder.paymentStatus);
    return (
      <div
        key={reminder._occurrenceKey ?? `${reminder.customerId}-${reminder.triggerDate}`}
        className="rounded-[var(--radius-card)] p-4"
        style={{ background: "var(--surface)" }}
        data-testid={`reminder-row-${reminder._occurrenceKey ?? reminder.customerId}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-15 font-semibold truncate">{reminder.customerName}</p>
            <p className="text-12 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
              {branchName ? `${branchName} · ` : ""}
              {formatCurrency(reminder.outstanding)} {t("reminders.outstanding")}
            </p>
          </div>
          <span
            className="shrink-0 text-10 font-bold px-2 py-0.5 rounded-full"
            style={{
              color: state === "ready" ? "var(--brand-dark)" : "var(--text-secondary)",
              background: state === "ready" ? "var(--brand-light)" : "var(--surface-2)",
            }}
          >
            {state === "ready" ? t("paymentReminders.ready") : t("paymentReminders.scheduled")}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span
            className="text-10 font-semibold px-2 py-0.5 rounded-full"
            style={{ color: statusColor.color, background: statusColor.bg }}
          >
            {getPaymentStatusLabel(reminder.paymentStatus, t)}
          </span>
          <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
            {t("paymentReminders.nextReminder", {
              when: formatSmartDateTime(reminder.triggerDate, undefined, t),
            })}
          </p>
        </div>

        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={() => openCustomer(reminder.customerId)}
            className="flex-1 h-10 rounded-full text-12 font-semibold flex items-center justify-center gap-1 active:opacity-70"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
          >
            {t("reminders.viewCustomer")}
            <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
          </button>
          <button
            type="button"
            onClick={() => openHistory(reminder.customerId)}
            className="flex-1 h-10 rounded-full text-12 font-semibold active:opacity-70"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
          >
            {t("paymentReminders.history")}
          </button>
        </div>
      </div>
    );
  };

  const sentCard = (log: ReminderLog) => (
    <div
      key={log.id}
      className="rounded-[var(--radius-card)] p-4"
      style={{ background: "var(--surface)" }}
      data-testid={`reminder-sent-${log.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-15 font-semibold truncate">
            {log.customerName || nameById.get(log.customerId) || t("common.customer")}
          </p>
          <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {formatSmartDateTime(log.sentAt, undefined, t)} · {(log.channel || "").toUpperCase()}
          </p>
        </div>          <span
            className="shrink-0 text-10 font-bold px-2 py-0.5 rounded-full"
            style={{ color: "var(--text-secondary)", background: "var(--surface-2)" }}
          >
            {t("paymentReminders.sent")}
          </span>
      </div>
      <p className="text-12 mt-2 line-clamp-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {log.message}
      </p>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => openCustomer(log.customerId)}
          className="flex-1 h-10 rounded-full text-12 font-semibold flex items-center justify-center gap-1 active:opacity-70"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
        >
          {t("reminders.viewCustomer")}
          <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
        </button>
        <button
          type="button"
          onClick={() => openHistory(log.customerId)}
          className="flex-1 h-10 rounded-full text-12 font-semibold active:opacity-70"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
        >
          {t("paymentReminders.history")}
        </button>
      </div>
    </div>
  );

  const loading = reminders === null || logs === null;
  const activeRows = view === "ready" ? ready : view === "scheduled" ? future : (logs ?? []);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="payment-reminders-page"
    >
      <StatusBar />
      <NavHeader title={t("hub.customers.reminders")} backTo={`${base}/settings/hub/customers`} />

      <div className="px-4 pt-1 flex items-start gap-5">
        <div className="min-w-0 flex-1">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("paymentReminders.readyCount")}
          </p>
          <p className="text-22 font-bold mt-1 leading-none tabular-nums" data-testid="reminders-ready-count">
            {reminders ? ready.length : "—"}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("paymentReminders.sentCount")}
          </p>
          <p className="text-22 font-bold mt-1 leading-none tabular-nums">
            {logs ? logs.length : "—"}
          </p>
        </div>
      </div>

      {/* Line tabs, the same grammar as Sales: a label over one hairline, with the active one
          marked by weight and a 2px brand rule. Pills made these three read as filters beside
          the screen rather than as the three states of one list (owner's correction,
          2026-10-28). */}
      <div
        className="flex gap-6 mt-4 mx-4"
        style={{ borderBottom: "1px solid var(--divider)" }}
        role="tablist"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={view === tab.key}
            onClick={() => setView(tab.key)}
            className="pb-2 text-13 transition-colors"
            style={{
              fontWeight: view === tab.key ? "var(--weight-strong)" : "var(--weight-body)",
              color: view === tab.key ? "var(--brand-dark)" : "var(--text-secondary)",
              borderBottom: view === tab.key ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {tab.label} · {tab.count}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonList rows={3} tile />
      ) : activeRows.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-14 gap-2">
          <BellRing size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-14 font-semibold text-center" style={{ color: "var(--text-primary)" }}>
            {view === "ready"
              ? t("paymentReminders.emptyReady")
              : view === "scheduled"
                ? t("paymentReminders.emptyScheduled")
                : t("paymentReminders.emptySent")}
          </p>
          <p className="text-12 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("reminders.configureSchedules")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pt-3 pb-8">
          {view === "sent"
            ? (activeRows as ReminderLog[]).map(sentCard)
            : (activeRows as GeneratedReminder[]).map((reminder) =>
                card(reminder, view === "ready" ? "ready" : "scheduled"),
              )}
        </div>
      )}

    </div>
  );
}
