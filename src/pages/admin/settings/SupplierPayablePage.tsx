import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronRight } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";
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

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return companies
      .filter((c) => {
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
  }, [companies, search, filter, todayISO]);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t("payable.all") },
    { key: "outstanding", label: t("payable.outstanding") },
    { key: "pending", label: t("payable.pending") },
    { key: "overdue", label: t("payable.overdue") },
    { key: "paid", label: t("payable.paid") },
  ];


  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="supplier-payable-page"
    >
      <StatusBar />
      <NavHeader title={t("payable.title")} backTo={returnTo} />

      <div className="px-4 pt-2">
        <h1 className="text-22 font-bold">{t("payable.subtitle")}</h1>
        <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>{t("overall.youOwe")}</p>
      </div>

      {/* Two figures, then one card — the same head as Customers & Credit: what is owed on the
          left, what is late on the right, each value under its own left-aligned label. This screen
          used to bury the total inside the card and leave the counts outside it, the exact mirror
          of the customer screen, so two lists of the same kind looked like two designs. */}
      <div className="px-4 pt-5 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("payable.totalOutstanding")}</p>
          <p className="text-26 font-bold mt-1 tabular-nums break-words" data-testid="payable-due">
            {ready ? formatCurrency(summary.due) : "—"}
          </p>
        </div>
        <div className="min-w-0 flex-1 text-end">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("payable.overdue")}</p>
          <p
            className="text-26 font-bold mt-1 tabular-nums break-words"
            data-testid="payable-overdue"
            style={{ color: summary.overdueDue > 0 ? "var(--error)" : "var(--text-primary)" }}
          >
            {ready ? formatCurrency(summary.overdueDue) : "—"}
          </p>
        </div>
      </div>

      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)" }}
          data-testid="payable-summary"
        >
          <div className="flex items-baseline justify-between gap-3">
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

          {/* The three counts live INSIDE the same card, on the pattern the customer list uses:
              a small surface, the figure, then the population it counts. They are figures, not
              doors — the chips under the search are the one control that filters the list, so a
              count that also changed the view would be a second, silent way to do the same job. */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div
              className="rounded-[var(--radius-tile)] px-3 py-2 min-w-0"
              style={{ background: "var(--surface-2)" }}
              data-testid="payable-tile-suppliers"
            >
              <p className="text-10 truncate" style={{ color: "var(--text-secondary)" }}>{t("payable.suppliers")}</p>
              <p className="text-16 font-bold mt-0.5 tabular-nums">{ready ? summary.suppliers : "—"}</p>
              <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>{t("payable.withPayable")}</p>
            </div>
            <div
              className="rounded-[var(--radius-tile)] px-3 py-2 min-w-0"
              style={{ background: "var(--surface-2)" }}
              data-testid="payable-tile-pending"
            >
              <p className="text-10 truncate" style={{ color: "var(--text-secondary)" }}>{t("payable.pending")}</p>
              <p className="text-16 font-bold mt-0.5 tabular-nums">{ready ? summary.pending : "—"}</p>
              <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>{t("payable.unpaid")}</p>
            </div>
            <div
              className="rounded-[var(--radius-tile)] px-3 py-2 min-w-0"
              style={{ background: "var(--surface-2)" }}
              data-testid="payable-tile-overdue"
            >
              <p className="text-10 truncate" style={{ color: "var(--text-secondary)" }}>{t("payable.overdue")}</p>
              <p
                className="text-16 font-bold mt-0.5 tabular-nums"
                style={{ color: summary.overdue > 0 ? "var(--error)" : "var(--text-primary)" }}
              >
                {ready ? summary.overdue : "—"}
              </p>
              <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>{t("payable.needsAction")}</p>
            </div>
          </div>
        </div>
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
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`${base}/settings/overview/suppliers/${c.id}`)}
                data-testid={`payable-row-${c.id}`}
                className="rounded-[var(--radius-card)] p-3.5 text-start active:opacity-70"
                style={{ background: "var(--tone-card)" }}
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
                <div className="flex items-center justify-between gap-3 mt-1.5">
                  <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>
                    {/* Only a bill can be a percentage of itself: with nothing billed the row
                        says it is settled rather than claiming "0% paid" of nothing. */}
                    {billed > 0 ? t("payable.paidPct", { pct }) : t("customers.noOutstanding")}
                    {timing ? ` · ${timing}` : ""}
                  </p>
                  <span className="flex items-center gap-1 shrink-0 text-10" style={{ color: "var(--text-secondary)" }}>
                    {t("payable.viewDetails")}
                    <ChevronRight size={12} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
