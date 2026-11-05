import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Download,
  Plus,
  ReceiptText,
  RefreshCw,
  Share2,
  Wallet,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import Sheet from "@/components/ui/Sheet";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PaymentReminderSheet from "@/components/ui/PaymentReminderSheet";
import PaymentReminderCard from "@/components/ui/PaymentReminderCard";
import SectionActionsSheet, {
  SectionActionsButton,
  type SectionAction,
} from "@/components/ui/SectionActionsSheet";
import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useSalesStore } from "@/stores/salesStore";
import { loadPaymentLedger, type LedgerPayment } from "@/lib/paymentLedger";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { pkDateFromISO, pkToday } from "@/lib/pkDate";
import { cashTakenInMonth, movementsInMonth } from "@/lib/financeSummary";
import { downloadCsv } from "@/lib/csv";
import {
  deletePaymentReminder,
  setPaymentReminderStatus,
  sortReminders,
  usePaymentReminders,
  type PaymentReminder,
} from "@/lib/paymentReminders";

/**
 * The cash screen behind the Finance hub's "Cash position" row.
 *
 * SHAPE (owner's instruction, 2026-10-30). The screen used to open with its own title, then three
 * count tiles, then a per-branch split — three answers to questions nobody asked on the way to the
 * one figure they came for. All four are gone. What is left is the collection plate at the top,
 * one action to record money, the owner's payment reminders, then the movements themselves under a
 * search and the two direction chips. The app bar names the screen; repeating the name inside it
 * was decoration.
 *
 * EVERY FIGURE HAS ONE DEFINITION, SHARED WITH THE HUB:
 *   - Recorded cash is `cashTakenInMonth` (money taken on this month's sales), the same function
 *     the hub prints, so the two screens cannot disagree about the same words.
 *   - Money received and money paid are the two sides of the payments ledger
 *     (`movementsInMonth`) — never netted, because they are two different flows.
 *
 * THE OVERFLOW IS THE SCREEN'S SECOND HALF. Set a reminder, count the till, share the summary,
 * download the rows on screen, or refresh — each is a job this screen owns, and each is one row in
 * the one sheet every section screen uses (`SectionActionsSheet`) rather than a strip of loose
 * buttons under the list.
 *
 * THE REMINDERS ARE THE OWNER'S DIARY, NOT THE CREDIT BOOK'S. `payment_reminders` (0256) holds one
 * payment each with an optional cadence; the chasing engine does not read it, so a private note
 * cannot become a message to a customer. The app has no background job, so the screen shows the
 * reminder and marks the one that is due — it never claims a notification was delivered.
 */
type Direction = "all" | "in" | "out";

export default function CashPositionPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const role = useAuthStore((s) => s.user?.membershipRole);
  const isOwner = role === "owner";

  const sales = useSalesStore((s) => s.sales);
  const salesReady = useSalesStore((s) => s.ready);
  const loadSales = useSalesStore((s) => s.load);

  const [entries, setEntries] = useState<LedgerPayment[] | null>(null);
  const [ledgerFailed, setLedgerFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<Direction>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [period, setPeriod] = useState<"month" | "previous">("month");
  const [periodOpen, setPeriodOpen] = useState(false);

  const reminders = usePaymentReminders();
  const [reminderSheet, setReminderSheet] = useState<{ open: boolean; reminder: PaymentReminder | null }>({
    open: false,
    reminder: null,
  });
  const [removing, setRemoving] = useState<PaymentReminder | null>(null);
  const [deleting, setDeleting] = useState(false);

  const today = pkToday();
  const thisMonth = today.slice(0, 7);
  // A Pakistan calendar month, shifted one back: the same arithmetic the ledger's "Last month"
  // tab uses, so the two screens call September the same month.
  const previousMonth = useMemo(() => {
    const year = Number(today.slice(0, 4));
    const monthIndex = Number(today.slice(5, 7));
    return new Date(Date.UTC(year, monthIndex - 2, 1)).toISOString().slice(0, 7);
  }, [today]);
  const month = period === "month" ? thisMonth : previousMonth;

  useEffect(() => {
    if (!salesReady) void loadSales();
  }, [salesReady, loadSales]);

  useEffect(() => {
    let live = true;
    setLedgerFailed(false);
    loadPaymentLedger()
      .then((ledger) => {
        if (live) setEntries(ledger.entries);
      })
      .catch(() => {
        if (live) setLedgerFailed(true);
      })
      .finally(() => {
        if (live) setRefreshing(false);
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  const cash = useMemo(() => cashTakenInMonth(sales, month), [sales, month]);
  const monthEntries = useMemo(
    () => (entries ?? []).filter((entry) => pkDateFromISO(entry.createdAt).startsWith(month)),
    [entries, month],
  );
  const flows = useMemo(() => movementsInMonth(entries ?? [], month), [entries, month]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return monthEntries.filter((entry) => {
      if (direction === "in" && entry.direction !== "in") return false;
      if (direction === "out" && entry.direction !== "out") return false;
      if (term && !entry.counterparty.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [monthEntries, direction, search]);

  const reminderRows = useMemo(
    () => (reminders.rows ? sortReminders(reminders.rows, today) : []),
    [reminders.rows, today],
  );

  const methodLabel = (method: string) =>
    method === "cash" ? t("sale.cash") : method === "bank_transfer" ? t("sale.bankTransfer") : method;

  const filters: { key: Direction; label: string }[] = [
    { key: "all", label: t("cashPosition.filterAll") },
    { key: "in", label: t("cashPosition.received") },
    { key: "out", label: t("cashPosition.paid") },
  ];

  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((value) => value + 1);
    reminders.retry();
    if (!salesReady) void loadSales();
  }, [reminders, salesReady, loadSales]);

  function exportRows() {
    if (!rows.length) {
      addToast(t("cashPosition.exportEmpty"), "info");
      return;
    }
    const header = [
      t("finance.ledger.date"),
      t("cashPosition.exportDirection"),
      t("cashPosition.exportParty"),
      t("cashPosition.exportType"),
      t("finance.amount"),
    ];
    const body = rows.map((entry) => {
      const incoming = entry.direction === "in";
      return [
        formatSmartDateTime(entry.createdAt, undefined, t),
        incoming ? t("cashPosition.received") : t("cashPosition.paid"),
        entry.counterparty,
        incoming ? t("payments.customerPayment") : t("payments.supplierPayment"),
        (incoming ? 1 : -1) * entry.amount,
      ];
    });
    downloadCsv(`cash-position_${month}.csv`, [header, ...body]);
    addToast(t("cashPosition.exported"), "success");
  }

  async function shareSummary() {
    const text = t("cashPosition.shareText", {
      month,
      cash: formatCurrency(cash),
      received: entries ? formatCurrency(flows.received) : "—",
      paid: entries ? formatCurrency(flows.paid) : "—",
    });
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: t("cashPosition.title"), text });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        addToast(t("cashPosition.shared"), "success");
        return;
      }
      addToast(t("cashPosition.shareFailed"), "error");
    } catch (e) {
      // The reader dismissed the platform share sheet; that is not a failure worth a toast.
      if (e instanceof Error && e.name === "AbortError") return;
      addToast(t("cashPosition.shareFailed"), "error");
    }
  }

  async function removeReminder() {
    if (!removing || deleting) return;
    setDeleting(true);
    try {
      await deletePaymentReminder(removing.id);
      addToast(t("cashPosition.reminderDeleted"), "success");
      setRemoving(null);
      reminders.retry();
    } catch {
      addToast(t("cashPosition.reminderFailed"), "error");
    } finally {
      setDeleting(false);
    }
  }

  const actions: SectionAction[] = [
    // Recording money is the first thing the owner reaches for, so it leads the sheet — but it is
    // not the screen, so it is a row here rather than a button standing over the list or a plus
    // in the app bar.
    ...(isOwner
      ? [
          {
            id: "record",
            icon: Plus,
            title: t("cashPosition.record"),
            description: t("cashPosition.recordDesc"),
            onClick: () => navigate(`${base}/settings/hub/finance/record?kind=income`),
          },
          {
            id: "reminder",
            icon: Bell,
            title: t("cashPosition.setReminder"),
            description: t("cashPosition.reminderDesc"),
            onClick: () => setReminderSheet({ open: true, reminder: null }),
          },
        ]
      : []),
    {
      id: "daily-cash",
      icon: Wallet,
      title: t("cashPosition.dailyCheck"),
      description: t("cashPosition.dailyCheckDesc"),
      onClick: () => navigate(`${base}/payments/daily-cash`),
    },
    { id: "share", icon: Share2, title: t("cashPosition.share"), onClick: shareSummary },
    { id: "export", icon: Download, title: t("cashPosition.download"), onClick: exportRows },
    { id: "refresh", icon: RefreshCw, title: t("cashPosition.refresh"), onClick: refresh },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="cash-position-page"
    >
      <StatusBar />
      <NavHeader
        title={t("cashPosition.title")}
        backTo={`${base}/settings/hub/finance`}
        right={
          <SectionActionsButton
            onClick={() => setMenuOpen(true)}
            label={t("cashPosition.menu")}
            testId="cash-position-menu"
          />
        }
      />

      <div className="px-4 pt-2">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="cash-position-summary"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {salesReady ? (
                <p
                  className="text-22 font-bold tabular-nums break-words"
                  style={{ color: "var(--brand-dark)" }}
                  data-testid="cash-position-total"
                >
                  {formatCurrency(cash)}
                </p>
              ) : (
                <Skeleton w="140px" h="26px" />
              )}
              <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>
                {period === "month" ? t("financeHub.cashHint") : t("cashPosition.previousHint")}
              </p>
            </div>

            {/* The month, said once and changeable. The pill carries the icon and the words, so
                the card no longer prints "This month" on the left and nothing on the right. */}
            <button
              type="button"
              onClick={() => setPeriodOpen(true)}
              aria-haspopup="dialog"
              aria-label={t("cashPosition.choosePeriod")}
              data-testid="cash-position-period"
              className="flex items-center gap-1.5 shrink-0 h-8 px-3 rounded-full text-11 font-semibold active:opacity-60"
              style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
            >
              <CalendarDays size={13} />
              {period === "month" ? t("cashPosition.thisMonth") : t("cashPosition.lastMonth")}
            </button>
          </div>

          {/* The two directions sit under the figure the way Paid and Total payable sit under the
              supplier screen's — same card, same pair, no bar: cash has no percentage of itself
              to draw, and a bar over two unrelated flows would measure nothing. */}
          <div className="flex items-end justify-between gap-3 mt-4">
            <div className="min-w-0">
              <p className="text-10 flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--success)" }} />
                {t("payments.moneyReceived")}
              </p>
              <p
                className="text-13 font-bold tabular-nums mt-0.5 break-words"
                style={{ color: flows.received > 0 ? "var(--success)" : "var(--text-primary)" }}
                data-testid="cash-position-received"
              >
                {entries ? formatCurrency(flows.received) : "—"}
              </p>
            </div>
            <div className="min-w-0 text-end">
              <p className="text-10 flex items-center gap-1.5 justify-end" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--error)" }} />
                {t("payments.moneyPaid")}
              </p>
              <p
                className="text-13 font-bold tabular-nums mt-0.5 break-words"
                style={{ color: flows.paid > 0 ? "var(--error)" : "var(--text-primary)" }}
                data-testid="cash-position-paid"
              >
                {entries ? formatCurrency(flows.paid) : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* The owner's diary. One card per payment, the next day it falls on, and its cadence. */}
      {(reminderRows.length > 0 || reminders.failed) && (
        <div className="px-4 pt-5" data-testid="cash-position-reminders">
          <p className="text-15 font-bold">{t("cashPosition.reminders")}</p>
          {reminders.failed ? (
            <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>
              {t("cashPosition.remindersFailed")}
            </p>
          ) : (
            <div className="flex flex-col gap-2 mt-2">
              {reminderRows.map((reminder) => (
                <PaymentReminderCard
                  key={reminder.id}
                  reminder={reminder}
                  today={today}
                  testId={`cash-reminder-${reminder.id}`}
                  onEdit={isOwner ? () => setReminderSheet({ open: true, reminder }) : undefined}
                  onDelete={isOwner ? () => setRemoving(reminder) : undefined}
                  onStatus={
                    isOwner
                      ? (status) => {
                          void setPaymentReminderStatus(reminder.id, status)
                            .then(() => reminders.retry())
                            .catch(() => addToast(t("paymentBook.statusFailed"), "error"));
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="px-4 pt-4">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("cashPosition.search")}
        />
      </div>

      <div className="flex gap-2 px-4 pt-3 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setDirection(f.key)}
            aria-pressed={direction === f.key}
            data-testid={`cash-position-filter-${f.key}`}
            className="h-8 px-3.5 rounded-full text-12 font-semibold transition-colors"
            style={
              direction === f.key
                ? { background: "var(--brand)", color: "#0a0a0a" }
                : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
            }
          >
            {f.label}
          </button>
        ))}
        {refreshing && (
          <span className="text-11 self-center" style={{ color: "var(--text-tertiary)" }}>
            {t("cashPosition.refreshing")}
          </span>
        )}
      </div>


      {!entries ? (
        ledgerFailed ? (
          <p className="px-4 pt-6 text-12" style={{ color: "var(--text-secondary)" }}>
            {t("cashPosition.loadFailed")}
          </p>
        ) : (
          <SkeletonList rows={4} tile />
        )
      ) : rows.length === 0 ? (
        <div className="px-4 pt-10 flex flex-col items-center gap-2">
          <ReceiptText size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
            {search.trim() || direction !== "all" ? t("cashPosition.empty") : t("cashPosition.noRecent")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 pt-3 pb-8">
          {rows.map((entry) => {
            const incoming = entry.direction === "in";
            return (
              <div
                key={entry.id}
                className="rounded-[var(--radius-card)] p-3.5"
                style={{ background: "var(--tone-card)" }}
                data-testid={`cash-position-row-${entry.id}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="size-10 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                  >
                    {incoming ? (
                      <ArrowDownLeft size={16} style={{ color: "var(--success)" }} />
                    ) : (
                      <ArrowUpRight size={16} style={{ color: "var(--error)" }} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-14 font-bold truncate">{entry.counterparty || "—"}</p>
                    <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {incoming ? t("payments.customerPayment") : t("payments.supplierPayment")}
                      {" · "}
                      {methodLabel(entry.method)}
                    </p>
                  </div>
                  <p
                    className="text-13 font-bold tabular-nums shrink-0"
                    style={{ color: incoming ? "var(--success)" : "var(--error)" }}
                  >
                    {incoming ? "+" : "−"} {formatCurrency(entry.amount)}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 mt-2">
                  <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>
                    {formatSmartDateTime(entry.createdAt, undefined, t)}
                  </p>
                  <span
                    className="text-10 font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      color: incoming ? "var(--success)" : "var(--error)",
                      background: "var(--surface-2)",
                    }}
                  >
                    {incoming ? t("cashPosition.received") : t("cashPosition.paid")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SectionActionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("cashPosition.title")}
        actions={actions.map((action) => ({
          ...action,
          onClick: () => {
            setMenuOpen(false);
            action.onClick();
          },
        }))}
      />

      {/* One month at a time, the two the figures are defined for. A range outside these would
          need the per-day splits the helpers do not compute, so the picker does not offer one.
          Two choices are two chips, not two list rows (owner, 2026-10-30): the same one-line
          control the balance books use, so every date picker in the app looks and behaves alike. */}
      <Sheet open={periodOpen} onClose={() => setPeriodOpen(false)} title={t("cashPosition.choosePeriod")} closeButton={false}>
        <div className="flex gap-2 px-4 pb-4">
          {(["month", "previous"] as const).map((key) => {
            const chosen = period === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setPeriod(key);
                  setPeriodOpen(false);
                }}
                aria-pressed={chosen}
                data-testid={`cash-position-period-${key}`}
                className="h-10 px-4 rounded-full text-13 font-semibold active:opacity-70"
                style={
                  chosen
                    ? { background: "var(--brand)", color: "#0a0a0a" }
                    : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
                }
              >
                {key === "month" ? t("cashPosition.thisMonth") : t("cashPosition.lastMonth")}
              </button>
            );
          })}
        </div>
      </Sheet>

      <PaymentReminderSheet
        open={reminderSheet.open}
        reminder={reminderSheet.reminder}
        onClose={() => setReminderSheet({ open: false, reminder: null })}
        onSaved={() => reminders.retry()}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        title={t("cashPosition.deleteReminderTitle")}
        message={t("cashPosition.deleteReminderMessage", { title: removing?.title ?? "" })}
        confirmLabel={t("cashPosition.reminderDelete")}
        destructive
        loading={deleting}
        onConfirm={removeReminder}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
