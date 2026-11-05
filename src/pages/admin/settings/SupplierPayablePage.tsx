import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Building2, CalendarDays, ChevronRight, Download, Plus, Share2 } from "lucide-react";
import BalanceDateSheet, { type BalancePeriod } from "@/components/ui/BalanceDateSheet";
import PaymentReminderSheet, { type PaymentReminderDefaults } from "@/components/ui/PaymentReminderSheet";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import Sheet from "@/components/ui/Sheet";
import ListRow from "@/components/ui/ListRow";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";
import { useUIStore } from "@/stores/uiStore";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { formatCurrency } from "@/lib/formatters";
import { pkDateFromISO, pkToday } from "@/lib/pkDate";
import { daysUntilDue, isSupplierOverdue, summariseSupplierPayable } from "@/lib/supplierPayable";

/**
 * Supplier payments — the screen behind the overview's "Supplier payable" card.
 *
 * WHY IT IS ITS OWN SCREEN. The supplier list answers "who do I buy from" and counts the products
 * each one supplies. This answers the money question the card asks: of everything this branch has
 * bought, how much has been paid, how much is still owed, and which suppliers are past their date.
 * The two live in different parts of the business on purpose — this one never adds a product
 * count or a catalogue action, and the supplier list never claims to be a payable report.
 *
 * EVERY FIGURE IS THE BRANCH'S OWN. Each row carries the branch-scoped purchases and the payable
 * left on them (0242), so the money paid is the difference and the total is the sum of the rows
 * below it. "Overdue" is a due date that has passed on a balance still owed — the same test the
 * signal engine raises for supplier payables.
 *
 * ONE CARD, THEN THE LIST (owner's correction, 2026-10-30). The heading and its line under the
 * bar repeated the bar; the overdue figure beside the total was a second, unexplained number at
 * the top; the three count tiles answered what the chips already answer; and “what we owe” sat
 * outside the card while the bar inside it measured a different population. The card now holds
 * the total, the progress and the two amounts the bar is drawn between, and the “…” menu exports
 * or shares the list. This is the shape the owner drew for this screen, and the mirror of the
 * customer receivable screen beside it.
 */
type Filter = "all" | "outstanding" | "pending" | "overdue" | "paid";

export default function SupplierPayablePage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  // Business Overview when opened from there, the Reports hub when opened from its tile.
  const returnTo = useReturnTo(`${base}/settings/overview`);
  const companies = useCompaniesStore((s) => s.companies);
  const ready = useCompaniesStore((s) => s.ready);
  const load = useCompaniesStore((s) => s.load);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [period, setPeriod] = useState<BalancePeriod>("all");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // `null` is closed; an object is the row (or the plate) this sheet was opened for, so the
  // reminder is already about the right supplier and balance when the owner starts typing.
  const [reminderDefaults, setReminderDefaults] = useState<PaymentReminderDefaults | null>(null);
  // Recording a payment is the usual next step in this book, so it opens from the card, from
  // the search row and from a supplier's own row — one picker, one destination, no second form.
  const [payOpen, setPayOpen] = useState(false);
  const [payQuery, setPayQuery] = useState("");
  const { addToast } = useUIStore();
  // Writing a reminder is the owner's own note (0257), so only the owner is offered the bell.
  const isOwner = useAuthStore((s) => s.user?.membershipRole === "owner");

  useEffect(() => { if (!ready) void load(); }, [ready, load]);

  const todayISO = pkToday();

  const book = useMemo(
    () => summariseSupplierPayable(companies, todayISO),
    [companies, todayISO],
  );

  const summary = useMemo(() => {
    const billed = companies.reduce((sum, c) => sum + Math.max(0, c.totalPurchases), 0);
    const due = companies.reduce((sum, c) => sum + Math.max(0, c.outstandingPayable), 0);
    const total = Math.max(billed, due);
    const paid = Math.max(0, total - due);
    // What is late, in money rather than in suppliers: the headline's right-hand figure, so the
    // two numbers at the top of the screen answer the same question the list below does.
    const overdueDue = companies.reduce(
      (sum, c) => sum + (isSupplierOverdue(c, todayISO) ? Math.max(0, c.outstandingPayable) : 0),
      0,
    );
    return {
      total,
      paid,
      due,
      overdueDue,
      pct: total > 0 ? Math.round((paid / total) * 100) : 0,
      // A supplier is counted once it is actually owed money; the book holds the two date
      // slices the chips filter, so a tile and the list can never disagree.
      suppliers: companies.filter((c) => c.outstandingPayable > 0).length,
      pending: book.pending,
      overdue: book.overdue,
    };
  }, [companies, book, todayISO]);

  // Six days back, so "this week" is the seven days ending today.
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

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return companies
      .filter((c) => {
        // The same window the card is showing: a supplier whose balance falls due inside it.
        if (period !== "all") {
          if (!c.dueDate) return false;
          const due = pkDateFromISO(c.dueDate);
          if (due < windowFrom || due > windowTo) return false;
        }
        if (term && !c.name.toLowerCase().includes(term)) return false;
        if (filter === "outstanding") return c.outstandingPayable > 0;
        if (filter === "pending") return c.outstandingPayable > 0 && !isSupplierOverdue(c, todayISO);
        if (filter === "overdue") return isSupplierOverdue(c, todayISO);
        if (filter === "paid") return c.outstandingPayable <= 0;
        return true;
      })
      // Owed money first, worst first: the past-due ones, then the largest balance.
      .sort((a, b) => {
        const aOver = isSupplierOverdue(a, todayISO) ? 1 : 0;
        const bOver = isSupplierOverdue(b, todayISO) ? 1 : 0;
        if (aOver !== bOver) return bOver - aOver;
        return b.outstandingPayable - a.outstandingPayable;
      });
  }, [companies, search, filter, todayISO, period, windowFrom, windowTo]);

  /** Whoever is owed first, so the picker opens on the payment a counter is most likely taking. */
  const payableSuppliers = useMemo(() => {
    const term = payQuery.trim().toLowerCase();
    return companies
      .filter((c) => c.outstandingPayable > 0)
      .filter((c) => !term || c.name.toLowerCase().includes(term))
      .sort((a, b) => b.outstandingPayable - a.outstandingPayable);
  }, [companies, payQuery]);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t("payable.all") },
    { key: "outstanding", label: t("payable.outstanding") },
    { key: "pending", label: t("payable.pending") },
    { key: "overdue", label: t("payable.overdue") },
    { key: "paid", label: t("payable.paid") },
  ];

  /** The rows on screen, as the spreadsheet and the shared text both describe them. */
  function payableRows() {
    return rows.map((c) => {
      const billed = Math.max(0, c.totalPurchases);
      const due = Math.max(0, c.outstandingPayable);
      return {
        supplier: c.name,
        bill: formatCurrency(billed),
        paid: formatCurrency(Math.max(0, billed - due)),
        balance: formatCurrency(due),
        state: due <= 0 ? t("payable.paid") : isSupplierOverdue(c, todayISO) ? t("payable.overdue") : t("payable.outstanding"),
      };
    });
  }

  async function exportPayable() {
    setMenuOpen(false);
    try {
      const list = payableRows();
      const csv = toCsv(
        [
          { label: t("payable.suppliers"), value: (r: (typeof list)[number]) => r.supplier },
          { label: t("payable.totalBill"), value: (r: (typeof list)[number]) => r.bill },
          { label: t("payable.paid"), value: (r: (typeof list)[number]) => r.paid },
          { label: t("payable.balance"), value: (r: (typeof list)[number]) => r.balance },
        ],
        list,
      );
      const outcome = await exportCsv(csvFileName("supplier-payable"), csv, t("payable.title"));
      addToast(outcome === "shared" ? t("data.exportedShared") : t("data.exported"), "success");
    } catch {
      addToast(t("data.exportFailed"), "error");
    }
  }

  async function sharePayable() {
    setMenuOpen(false);
    const total = `${t("payable.totalOutstanding")}: ${formatCurrency(summary.due)}`;
    const text = [total, ...payableRows().map((r) => `${r.supplier} · ${r.balance}`)].join("\n");
    try {
      const outcome = await exportText(text, t("payable.title"));
      addToast(outcome === "shared" ? t("sales.reportShared") : t("sales.reportCopied"), "success");
    } catch {
      addToast(t("sales.shareFailed"), "error");
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="supplier-payable-page"
    >
      <StatusBar />
      <NavHeader
        title={t("payable.title")}
        backTo={returnTo}
        right={
          <SectionActionsButton
            onClick={() => setMenuOpen(true)}
            label={t("data.moreActions")}
            testId="payable-actions"
          />
        }
      />

      <SectionActionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("payable.title")}
        actions={[
          {
            id: "export",
            icon: Download,
            title: t("data.export"),
            description: t("data.exportHint"),
            onClick: () => { void exportPayable(); },
          },
          {
            id: "share",
            icon: Share2,
            title: t("sales.shareReport"),
            description: t("sales.shareReportHint"),
            onClick: () => { void sharePayable(); },
          },
        ]}
      />

      <div className="px-4 pt-3">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)" }}
          data-testid="payable-summary"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {period === "all" ? t("payable.totalOutstanding")
                  : period === "today" ? t("receivable.dueToday")
                  : period === "week" ? t("receivable.dueThisWeek")
                  : period === "month" ? t("receivable.dueThisMonth")
                  : period === "year" ? t("receivable.dueThisYear")
                  : t("receivable.dueInRange")}
              </p>
              <p className="text-26 font-bold mt-1 tabular-nums break-words" data-testid="payable-due">
                {ready ? formatCurrency(summary.due) : "—"}
              </p>
            </div>

            {/* The same calendar chip its mirror screen wears, so the payable and receivable
                books are narrowed by the same gesture (owner's instruction, 2026-10-30). */}
            <button
              type="button"
              onClick={() => setPeriodOpen(true)}
              aria-label={t("period.sheetTitle")}
              aria-haspopup="dialog"
              data-testid="payable-period"
              className="flex items-center gap-1.5 shrink-0 h-8 px-3 rounded-full text-11 font-semibold active:opacity-60"
              style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
            >
              <CalendarDays size={13} />
              {period === "all" ? t("period.allDates")
                : period === "today" ? t("period.today")
                : period === "week" ? t("period.week")
                : period === "month" ? t("period.month")
                : period === "year" ? t("period.year")
                : `${customFrom.slice(5)} – ${customTo.slice(5)}`}
            </button>
          </div>

          <div className="flex items-baseline justify-between gap-3 mt-4">
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("payable.progress")}</p>
            <p className="text-12 font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {summary.pct}%
            </p>
          </div>
          <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(0, Math.min(100, summary.pct))}%`, background: "var(--brand)" }}
            />
          </div>
          <div className="flex items-end justify-between gap-3 mt-2">
            <div className="min-w-0">
              <p className="text-10 flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--brand)" }} />
                {t("payable.paid")}
              </p>
              <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{formatCurrency(summary.paid)}</p>
            </div>
            <div className="min-w-0 text-end">
              <p className="text-10 flex items-center gap-1.5 justify-end" style={{ color: "var(--text-secondary)" }}>
                <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--muted)" }} />
                {t("payable.totalPayable")}
              </p>
              <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{formatCurrency(summary.total)}</p>
            </div>
          </div>

          {/* The payment the card is about. It is one row in the book's own grey — the same
              shape the supplier-payments screen uses — rather than a second bright button that
              competes with the balance above it. */}
          <button
            type="button"
            onClick={() => setPayOpen(true)}
            data-testid="payable-record-payment"
            className="w-full flex items-center gap-3 rounded-[var(--radius-card)] p-3 mt-4 text-start active:opacity-70"
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
                {t("supplierPayments.record")}
              </span>
              <span className="block text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {t("supplierPayments.recordHint")}
              </span>
            </span>
          </button>
        </div>
      </div>

      {/* The reminder is a note the owner keeps for themselves, on the same sheet the cash screen
          uses — the supplier book is where the bill is, so it is where the reminder belongs. */}
      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={() => setReminderDefaults({ kind: "supplier" })}
          data-testid="payable-reminder"
          className="w-full flex items-center gap-3 rounded-[var(--radius-card)] p-3 text-start active:opacity-70"
          style={{ background: "var(--tone-card)" }}
        >
          <span
            className="size-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--tone-sunken)" }}
          >
            <Bell size={16} style={{ color: "var(--text-secondary)" }} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-13 font-bold" style={{ color: "var(--text-primary)" }}>
              {t("cashPosition.setReminder")}
            </span>
            <span className="block text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {t("payable.reminderHint")}
            </span>
          </span>
          <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
        </button>
      </div>

      <div className="px-4 pt-3 pb-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("payable.search")}
        />
      </div>

      {/* The four states, as the same chip row the customer list uses: one height, one radius,
          one inset, and it scrolls sideways instead of wrapping so the row never grows a second
          line on a narrow phone. */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className="shrink-0 h-9 px-4 rounded-full text-12 font-semibold transition-colors active:opacity-70"
            style={
              filter === f.key
                ? { background: "var(--brand)", color: "#0a0a0a" }
                : { background: "var(--surface-2)", color: "var(--text-secondary)" }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {!ready ? (
        <SkeletonList rows={5} tile />
      ) : rows.length === 0 ? (
        <div className="px-4 pt-10 flex flex-col items-center gap-2">
          <Building2 size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("payable.empty")}</p>
        </div>
      ) : (
        <div id="payable-list" className="flex flex-col gap-2 px-4 pt-3 pb-8" style={{ scrollMarginTop: 8 }}>
          {rows.map((c) => {
            const billed = Math.max(0, c.totalPurchases);
            const due = Math.max(0, c.outstandingPayable);
            const paid = Math.max(0, billed - due);
            const pct = billed > 0 ? Math.min(100, Math.round((paid / billed) * 100)) : 0;
            const overdue = isSupplierOverdue(c, todayISO);
            const days = c.dueDate ? daysUntilDue(c.dueDate, todayISO) : null;

            // The second half of the meta line: which date this balance answers to.
            const timing = due <= 0
              ? null
              : overdue && days !== null ? t("payable.overdueBy", { days: Math.abs(days) })
              : days === 0 ? t("payable.dueToday")
              : days !== null && days > 0 ? t("payable.dueOn", {
                date: new Date(c.dueDate as string).toLocaleDateString("en-GB", {
                  day: "numeric", month: "short", timeZone: "Asia/Karachi",
                }),
              })
              : t("payable.noDate");

            const stateLabel = due <= 0
              ? t("payable.paid")
              : overdue ? t("payable.overdue")
              : days !== null && days <= 7 ? t("payable.dueSoon")
              : t("payable.outstanding");
            const stateColor = due <= 0
              ? "var(--text-secondary)"
              : overdue ? "var(--error)"
              : days !== null && days <= 7 ? "var(--warning)"
              : "var(--text-secondary)";

            return (
              <div
                key={c.id}
                data-testid={`payable-row-${c.id}`}
                className="rounded-[var(--radius-card)] p-3.5"
                style={{ background: "var(--tone-card)" }}
              >
                {/* The card opens the supplier; the bell below is its own control, so the two
                    actions are siblings rather than one nested inside the other. */}
                <button
                  type="button"
                  // The supplier's own page (identity, bills, payments, reminders), with this
                  // book as the way back. It used to be a second address for the same supplier.
                  onClick={() => navigate(`${base}/companies/${c.id}`, {
                    state: { from: `${base}/settings/overview/suppliers` },
                  })}
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
                    <p className="text-10" style={{ color: "var(--text-secondary)" }}>{t("payable.paid")}</p>
                    <p className="text-13 font-bold tabular-nums mt-0.5 break-words" style={{ color: "var(--brand-dark)" }}>
                      {formatCurrency(paid)}
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
                  <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>
                    {/* Only a bill can be a percentage of itself: with nothing billed the row
                        says it is settled rather than claiming "0% paid" of nothing. */}
                    {billed > 0 ? t("payable.paidPct", { pct }) : t("customers.noOutstanding")}
                    {timing ? ` · ${timing}` : ""}
                  </p>
                  <div className="flex items-center gap-1 shrink-0">
                    {isOwner && due > 0 && (
                      <button
                        type="button"
                        onClick={() => setReminderDefaults({
                          kind: "supplier",
                          companyId: c.id,
                          title: t("paymentBook.titleToSupplier", { name: c.name }),
                          amount: due,
                        })}
                        aria-label={t("paymentBook.setForSupplier", { name: c.name })}
                        data-testid={`payable-remind-${c.id}`}
                        className="size-8 rounded-full flex items-center justify-center active:opacity-60"
                        style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                      >
                        <Bell size={14} />
                      </button>
                    )}
                    {due > 0 ? (
                      <button
                        type="button"
                        onClick={() => navigate(`${base}/payments/supplier/${c.id}`)}
                        data-testid={`payable-pay-${c.id}`}
                        className="h-8 px-3 rounded-full text-10 font-bold active:opacity-60"
                        style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                      >
                        {t("supplierPayments.record")}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 text-10" style={{ color: "var(--text-secondary)" }}>
                        {t("payable.viewDetails")}
                        <ChevronRight size={12} />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
        testIdPrefix="payable-period"
      />

      <PaymentReminderSheet
        open={reminderDefaults !== null}
        reminder={null}
        defaults={reminderDefaults ?? undefined}
        onClose={() => setReminderDefaults(null)}
        onSaved={() => setReminderDefaults(null)}
      />

      {/* Which supplier? The search is the same one the screen already uses, and every row
          states the balance it is about, so the payment form opens on the right amount. */}
      <Sheet
        open={payOpen}
        onClose={() => {
          setPayOpen(false);
          setPayQuery("");
        }}
        title={t("supplierPayments.pickSupplier")}
      >
        <div className="px-4 pb-2">
          <SearchBar
            value={payQuery}
            onChange={(e) => setPayQuery(e.target.value)}
            onClear={() => setPayQuery("")}
            placeholder={t("payable.search")}
          />
        </div>
        <div className="px-4">
          {payableSuppliers.map((company) => (
            <ListRow
              key={company.id}
              testId={`payable-pick-${company.id}`}
              icon={Building2}
              title={company.name}
              description={formatCurrency(Math.max(0, company.outstandingPayable))}
              onClick={() => {
                setPayOpen(false);
                setPayQuery("");
                navigate(`${base}/payments/supplier/${company.id}`);
              }}
            />
          ))}
          {payableSuppliers.length === 0 && (
            <p className="px-4 py-6 text-13 text-center" style={{ color: "var(--text-secondary)" }}>
              {t("payable.empty")}
            </p>
          )}
        </div>
      </Sheet>
    </div>
  );
}
