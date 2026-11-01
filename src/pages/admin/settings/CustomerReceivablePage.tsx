import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CalendarDays, ChevronRight, Download, Plus, Share2, UserRound } from "lucide-react";
import PaymentReminderSheet, { type PaymentReminderDefaults } from "@/components/ui/PaymentReminderSheet";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";
import { useUIStore } from "@/stores/uiStore";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import BalanceDateSheet from "@/components/ui/BalanceDateSheet";
import Sheet from "@/components/ui/Sheet";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useCustomersStore } from "@/stores/customersStore";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { formatCurrency } from "@/lib/formatters";
import { isCreditOverdue } from "@/lib/signalEngine";
import { reminderWhen, usePaymentReminderBook } from "@/lib/paymentReminders";
import { hasPermission } from "@/lib/tenantContext";
import { pkDateFromISO, pkToday } from "@/lib/pkDate";

/**
 * Customer collection — the screen behind the overview's "Customer receivable" card.
 *
 * WHY IT IS ITS OWN SCREEN. The Customers list answers "who buys from me": every account, cash
 * or credit, and the way in to each one's profile. This answers the narrower question the card
 * asks — of the money this branch has billed, how much has come back, and who is still holding
 * what. Opening the ordinary customer list from that card sent the reader to a different screen
 * with a different top figure, so the number they had just tapped was nowhere to be seen.
 *
 * EVERY FIGURE IS THE BRANCH'S OWN. The rows are the customers the store already loaded, and
 * each carries the branch-scoped money the database derives (0242): billed, collected, still
 * owed. The summary is the sum of the very rows below it, so the total can never disagree with
 * the list, and "overdue" is the S1 rule (`isCreditOverdue`) that Reminders and Home use.
 */
/**
 * This screen is the credit book, not the customer list: only accounts that have taken credit
 * appear, so "all customers" is not one of its views (owner's correction, 2026-10-28).
 *
 * ONE CARD, THEN THE LIST (owner's correction, 2026-10-30). The three count tiles under the card
 * and the floating Add-customer button are gone. The counts were figures the chips under the
 * search already answered — two ways to narrow the same list, one of them silent — and adding a
 * customer is a job for the customer list, not for the screen that collects what they owe.
 */
type Filter = "credit" | "pending" | "overdue";

/**
 * WHICH MONTH'S DUE CREDIT IS SHOWING (owner's instruction, 2026-10-30).
 *
 * The book is a balance, so "this month" cannot mean "money from this month's bills" without
 * inventing a second arithmetic underneath the first. It means the one thing the rows already
 * carry: the credit whose due date falls in that month — who must pay me now. "All dates" is
 * the live book the screen has always shown, and it stays the default so nothing changes for a
 * reader who never touches the chip.
 */
type DuePeriod = "all" | "today" | "week" | "month" | "year" | "custom";

export default function CustomerReceivablePage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  // The Reports directory opens this ledger as one of its answers; Settings Overview is the
  // default parent when the ledger is opened from its usual card.
  const returnTo = useReturnTo(`${base}/settings/overview`);
  const customers = useCustomersStore((s) => s.customers);
  const ready = useCustomersStore((s) => s.ready);
  const load = useCustomersStore((s) => s.load);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("credit");
  const [menuOpen, setMenuOpen] = useState(false);
  const [period, setPeriod] = useState<DuePeriod>("all");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Taking a payment is a customer-level job, so the picker starts here and the chosen account's
  // own form does the rest — the reader never has to know its address (owner, 2026-10-31).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const canRecordPayment = hasPermission("customers.payments");
  // A reminder is the owner's own note (0257), so the bell is offered only to the owner — the
  // database refuses the write from anyone else, and a control that exists to be refused is a
  // lie about what the reader can do.
  const isOwner = useAuthStore((s) => s.user?.membershipRole === "owner");
  const [reminderDefaults, setReminderDefaults] = useState<PaymentReminderDefaults | null>(null);
  // The diary's customer notes, so a row can say one already exists. Read-only here: the bell
  // writes, this line reports. A role without payments.view reads nothing and draws no marker.
  const customerReminders = usePaymentReminderBook();
  const { addToast } = useUIStore();

  useEffect(() => { if (!ready) void load(); }, [ready, load]);

  const todayISO = pkToday();
  /**
   * The window's first and last day. Today / week / month / year are computed here rather than
   * carried as four more pieces of state, so the window always follows the clock: a screen left
   * open over midnight does not keep yesterday as "Today".
   */
  // Six days back, not seven: "this week" is the seven days that end today.
  const weekStart = useMemo(() => {
    const d = new Date(`${todayISO}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  }, [todayISO]);

  const windowFrom =
    period === "custom" ? customFrom || todayISO
    : period === "today" ? todayISO
    : period === "week" ? weekStart
    : period === "month" ? `${todayISO.slice(0, 7)}-01`
    : `${todayISO.slice(0, 4)}-01-01`;
  const windowTo = period === "custom" ? customTo || todayISO : todayISO;

  /** Whoever owes first: that is the payment a counter is most likely taking. */
  const pickable = useMemo(() => {
    const term = customerQuery.trim().toLowerCase();
    return customers
      .filter((c) => c.outstandingBalance > 0)
      .filter((c) => !term || c.name.toLowerCase().includes(term) || c.phone.includes(term))
      .sort((a, b) => b.outstandingBalance - a.outstandingBalance);
  }, [customers, customerQuery]);

  /** The credit book, narrowed to the days the money falls due in when a window is chosen. */
  const scoped = useMemo(() => {
    const book = customers.filter((c) => c.outstandingBalance > 0);
    if (period === "all") return book;
    return book.filter((c) => {
      if (!c.dueDate) return false;
      const due = pkDateFromISO(c.dueDate as string);
      return due >= windowFrom && due <= windowTo;
    });
  }, [customers, period, windowFrom, windowTo]);

  const summary = useMemo(() => {
    const billed = scoped.reduce((sum, c) => sum + Math.max(0, c.totalPurchases), 0);
    const due = scoped.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0);
    const total = Math.max(billed, due);
    // What is left of the bill once the remainder is removed. The payments column is not used
    // for this: a return lowers the bill but not the money once taken, so summing it produced
    // "100,000 collected of 0 billed" after a full refund.
    const collected = Math.max(0, total - due);
    return {
      total,
      collected,
      due,
      pct: total > 0 ? Math.round((collected / total) * 100) : 0,
      // The tiles count the credit book, not the address book: only customers who have actually
      // taken credit appear here, and "pending" is the part of that book not yet past its date.
      accounts: scoped.length,
      pending: scoped.filter((c) => !isCreditOverdue(c, todayISO)).length,
      overdue: scoped.filter((c) => isCreditOverdue(c, todayISO)).length,
    };
  }, [scoped, todayISO]);

  /** The earliest open reminder per customer, as a PK day — the next thing to chase. */
  const nextReminderByCustomer = useMemo(() => {
    const next = new Map<string, string>();
    for (const reminder of customerReminders.rows ?? []) {
      if (reminder.status !== "upcoming" || reminder.kind !== "customer" || !reminder.customerId) continue;
      const when = reminderWhen(reminder, todayISO).on;
      const known = next.get(reminder.customerId);
      if (!known || when < known) next.set(reminder.customerId, when);
    }
    return next;
  }, [customerReminders.rows, todayISO]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return scoped
      .filter((c) => {
        // The book is already narrowed to customers who still owe; the chips judge the date.
        if (filter === "overdue") return isCreditOverdue(c, todayISO);
        if (filter === "pending") return !isCreditOverdue(c, todayISO);
        if (term && !c.name.toLowerCase().includes(term) && !c.phone.includes(term)) return false;
        return true;
      })
      // Worst first: the person already past their date, then whoever holds the most.
      .sort((a, b) => {
        const aOver = isCreditOverdue(a, todayISO) ? 1 : 0;
        const bOver = isCreditOverdue(b, todayISO) ? 1 : 0;
        if (aOver !== bOver) return bOver - aOver;
        return b.outstandingBalance - a.outstandingBalance;
      });
  }, [scoped, search, filter, todayISO]);

  const filters: { key: Filter; label: string }[] = [
    { key: "credit", label: t("receivable.onCredit") },
    { key: "pending", label: t("receivable.pending") },
    { key: "overdue", label: t("receivable.overdue") },
  ];

  /**
   * The same two actions the supplier ledger offers, because this is its mirror screen: the
   * reader who can take the payable book away as a spreadsheet or a message can take the
   * receivable book away the same way (owner's consistency rule, 2026-10-30).
   */
  async function exportReceivable() {
    setMenuOpen(false);
    try {
      const csv = toCsv(
        [
          { label: t("receivable.customers"), value: (r: (typeof rows)[number]) => r.name },
          { label: t("common.phone"), value: (r: (typeof rows)[number]) => r.phone },
          { label: t("receivable.totalOutstanding"), value: (r: (typeof rows)[number]) => formatCurrency(Math.max(0, r.outstandingBalance)) },
        ],
        rows,
      );
      const outcome = await exportCsv(csvFileName("customer-receivable"), csv, t("receivable.title"));
      addToast(outcome === "shared" ? t("data.exportedShared") : t("data.exported"), "success");
    } catch {
      addToast(t("data.exportFailed"), "error");
    }
  }

  async function shareReceivable() {
    setMenuOpen(false);
    const total = `${t("receivable.totalOutstanding")}: ${formatCurrency(summary.due)}`;
    const text = [total, ...rows.map((r) => `${r.name} · ${formatCurrency(Math.max(0, r.outstandingBalance))}`)].join("\n");
    try {
      const outcome = await exportText(text, t("receivable.title"));
      addToast(outcome === "shared" ? t("sales.reportShared") : t("sales.reportCopied"), "success");
    } catch {
      addToast(t("sales.shareFailed"), "error");
    }
  }


  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="customer-receivable-page"
    >
      <StatusBar />
      <NavHeader
        title={t("receivable.title")}
        backTo={returnTo}
        right={
          <SectionActionsButton
            onClick={() => setMenuOpen(true)}
            label={t("data.moreActions")}
            testId="receivable-actions"
          />
        }
      />

      <SectionActionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("receivable.title")}
        actions={[
          {
            id: "export",
            icon: Download,
            title: t("data.export"),
            description: t("data.exportHint"),
            onClick: () => { void exportReceivable(); },
          },
          {
            id: "share",
            icon: Share2,
            title: t("sales.shareReport"),
            description: t("sales.shareReportHint"),
            onClick: () => { void shareReceivable(); },
          },
        ]}
      />

      {/* The one summary the screen exists for: what is still out, how much of it has come back.
          The bar is the name of the screen's own job — collecting — so the heading that used to
          repeat the bar's title above it is gone (owner's correction, 2026-10-30). */}
      <div className="px-4 pt-3">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="receivable-summary"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {period === "all"
                  ? t("receivable.totalOutstanding")
                  : period === "month"
                    ? t("receivable.dueThisMonth")
                    : t("receivable.dueLastMonth")}
              </p>
              <p className="text-22 font-bold mt-1 tabular-nums break-words" data-testid="receivable-due">
                {ready ? formatCurrency(summary.due) : "—"}
              </p>
            </div>

            {/* The month, said once and changeable — the same calendar chip the cash screen
                wears, so the two collection plates read the same way. */}
            <button
              type="button"
              onClick={() => setPeriodOpen(true)}
              aria-haspopup="dialog"
              aria-label={t("receivable.choosePeriod")}
              data-testid="receivable-period"
              className="flex items-center gap-1.5 shrink-0 h-8 px-3 rounded-full text-11 font-semibold active:opacity-60"
              style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
            >
              <CalendarDays size={13} />
              {period === "all" ? t("receivable.allDates")
                : period === "today" ? t("period.today")
                : period === "week" ? t("period.week")
                : period === "month" ? t("period.month")
                : period === "year" ? t("period.year")
                : `${customFrom.slice(5)} – ${customTo.slice(5)}`}
            </button>
          </div>

          <div className="flex items-baseline justify-between gap-3 mt-4">
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("receivable.progress")}</p>
            <p className="text-12 font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {summary.pct}%
            </p>
          </div>
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--divider)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(0, Math.min(100, summary.pct))}%`, background: "var(--brand)" }}
            />
          </div>
          <div className="flex items-end justify-between gap-3 mt-2">
            <div className="min-w-0">
              <p className="text-10 flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--brand)" }} />
                {t("overall.collected")}
              </p>
              <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{formatCurrency(summary.collected)}</p>
            </div>
            <div className="min-w-0 text-end">
              <p className="text-10 flex items-center gap-1.5 justify-end" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--muted)" }} />
                {t("receivable.totalDue")}
              </p>
              <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{formatCurrency(summary.total)}</p>
            </div>
          </div>

        </div>
      </div>

      {/* RECORD A PAYMENT, ABOVE THE SEARCH (owner's instruction, 2026-10-31). The book states
          what is still owed; this is the action that changes it. It sits in the book's own grey
          rather than the brand colour: collecting money is routine here, not the screen's one
          call to action, and it must not outshout the list it sits over. */}
      {canRecordPayment && (
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            data-testid="receivable-record"
            className="w-full flex items-center gap-3 rounded-[var(--radius-card)] p-3 text-start active:opacity-70"
            style={{ background: "var(--tone-sunken)" }}
          >
            <span
              className="size-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "var(--surface-2)", color: "var(--brand-dark)" }}
            >
              <Plus size={18} strokeWidth={2.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-14 font-bold" style={{ color: "var(--text-primary)" }}>
                {t("customers.recordPayment")}
              </span>
              <span className="block text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {t("receivable.recordHint")}
              </span>
            </span>
            <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
          </button>
        </div>
      )}

      <div className="px-4 pt-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("customers.search")}
        />
      </div>

      <div className="flex gap-2 px-4 pt-3 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className="h-8 px-3.5 rounded-full text-12 font-semibold transition-colors"
            style={
              filter === f.key
                ? { background: "var(--brand)", color: "#0a0a0a" }
                : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <BalanceDateSheet
        open={periodOpen}
        onClose={() => setPeriodOpen(false)}
        title={t("period.sheetTitle")}
        value={period}
        from={customFrom}
        to={customTo}
        max={todayISO}
        onChange={(key, from, to) => {
          setPeriod(key);
          setCustomFrom(from);
          setCustomTo(to);
        }}
        testIdPrefix="receivable-period"
      />

      {!ready ? (
        <SkeletonList rows={5} tile />
      ) : rows.length === 0 ? (
        <div className="px-4 pt-10 flex flex-col items-center gap-2">
          <UserRound size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
            {search.trim() || filter !== "credit"
              ? t("receivable.empty")
              : period !== "all"
                ? t("receivable.noneInMonth")
                : t("receivable.none")}
          </p>
        </div>
      ) : (
        <div id="receivable-list" className="flex flex-col gap-2 px-4 pt-3 pb-8" style={{ scrollMarginTop: 8 }}>
          {rows.map((c) => {
            const overdue = isCreditOverdue(c, todayISO);
            // The same three figures the supplier row shows, in the same places: what the
            // account was billed, what has come back, and what is still owed. The bar is the
            // collected share of that bill — the mirror of the payable's paid share — so the two
            // ledgers cannot be read as two different ideas of "how far along is this account".
            const billed = Math.max(0, c.totalPurchases);
            const due = Math.max(0, c.outstandingBalance);
            const collected = Math.max(0, billed - due);
            const pct = billed > 0 ? Math.min(100, Math.round((collected / billed) * 100)) : 0;
            const used = c.creditLimit > 0
              ? Math.min(100, Math.round((due / c.creditLimit) * 100))
              : 0;
            const stateLabel = overdue
              ? t("receivable.overdue")
              : due > 0 ? t("sale.onCredit") : t("credit.cashCustomer");
            const stateColor = overdue
              ? "var(--error)"
              : due > 0 ? "var(--text-secondary)" : "var(--text-tertiary)";
            return (
              <div
                key={c.id}
                data-testid={`receivable-row-${c.id}`}
                className="rounded-[var(--radius-card)] p-3.5"
                style={{ background: "var(--tone-card)" }}
              >
                <button
                  type="button"
                  onClick={() => navigate(`${base}/customers/${c.id}`)}
                  className="w-full text-start active:opacity-70"
                >
                <div className="flex items-start gap-3">
                  <span
                    className="size-10 rounded-full flex items-center justify-center font-bold text-14 shrink-0"
                    style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                  >
                    {c.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-14 font-bold truncate">{c.name}</p>
                    <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {t("payable.totalBill")} · {formatCurrency(billed)}
                    </p>
                  </div>
                  <span
                    className="text-10 font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{ color: stateColor, background: "var(--surface-2)" }}
                  >
                    {stateLabel}
                  </span>
                </div>

                <div className="flex items-baseline justify-between gap-3 mt-3">
                  <div className="min-w-0">
                    <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("overall.collected")}</p>
                    <p className="text-13 font-bold tabular-nums mt-0.5 break-words" style={{ color: "var(--brand-dark)" }}>
                      {formatCurrency(collected)}
                    </p>
                  </div>
                  <div className="min-w-0 text-end">
                    <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("payable.balance")}</p>
                    <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{formatCurrency(due)}</p>
                  </div>
                </div>

                <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "var(--divider)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: overdue ? "var(--warning)" : "var(--brand)" }}
                  />
                </div>
                </button>
                <div className="flex items-center justify-between gap-3 mt-1.5">
                  {/* Phone where the supplier row puts its timing note, then the share of the
                      bill that has come back — and the limit in use only when a limit is set, so
                      a cash account is never shown "0% of a limit" it does not have. */}
                  <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>
                    {c.phone}
                    {billed > 0 ? ` · ${t("receivable.collectedPct", { pct })}` : ""}
                    {c.creditLimit > 0 ? ` · ${used}${t("credit.percentUsed")}` : ""}
                  </p>
                  {nextReminderByCustomer.get(c.id) && (
                    <span
                      className="flex items-center gap-1 shrink-0 text-10 tabular-nums ms-1"
                      style={{ color: "var(--brand-dark)" }}
                      data-testid={`receivable-reminder-date-${c.id}`}
                    >
                      <Bell size={10} />
                      {new Date(`${nextReminderByCustomer.get(c.id)}T00:00:00Z`).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        timeZone: "UTC",
                      })}
                    </span>
                  )}
                  <div className="flex items-center gap-1 shrink-0">
                    {isOwner && due > 0 && (
                      <button
                        type="button"
                        onClick={() => setReminderDefaults({
                          kind: "customer",
                          customerId: c.id,
                          title: t("paymentBook.titleFromCustomer", { name: c.name }),
                          amount: due,
                        })}
                        aria-label={t("paymentBook.setForCustomer", { name: c.name })}
                        data-testid={`receivable-remind-${c.id}`}
                        className="size-8 rounded-full flex items-center justify-center active:opacity-60"
                        style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                      >
                        <Bell size={14} />
                      </button>
                    )}
                    <span className="flex items-center gap-1 text-10" style={{ color: "var(--text-secondary)" }}>
                      {t("payable.viewDetails")}
                      <ChevronRight size={12} />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PaymentReminderSheet
        open={reminderDefaults !== null}
        reminder={null}
        defaults={reminderDefaults ?? undefined}
        onClose={() => setReminderDefaults(null)}
        onSaved={() => { setReminderDefaults(null); customerReminders.retry(); }}
      />

      <Sheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t("customers.recordPayment")}
        closeButton
      >
        <div className="px-4 pb-2">
          <SearchBar
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            onClear={() => setCustomerQuery("")}
            placeholder={t("customers.search")}
          />
        </div>
        {pickable.length === 0 ? (
          <p className="px-4 pt-4 text-12" style={{ color: "var(--text-secondary)" }}>
            {t("outstanding.emptyFilter")}
          </p>
        ) : (
          <div className="pb-4">
            {pickable.map((c) => (
              <ListRow
                key={c.id}
                testId={`receivable-pick-${c.id}`}
                title={c.name}
                description={c.phone}
                trailing={
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="text-13 font-bold tabular-nums">
                      {formatCurrency(c.outstandingBalance)}
                    </span>
                    <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                  </span>
                }
                onClick={() => {
                  setPickerOpen(false);
                  setCustomerQuery("");
                  navigate(`${base}/customers/${c.id}/record-payment`);
                }}
              />
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
