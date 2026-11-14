import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import type { CustomerCollection } from "@/lib/customerCredit";

interface CollectionPlateProps {
  summary: CustomerCollection;
  ready: boolean;
  /** Distinguishes the two screens' plates in tests and in the DOM. */
  testId?: string;
}

/**
 * The collection plate: what the branch is owed, how much of that has come back, and the three
 * populations that make the figure up.
 *
 * ONE COMPONENT, TWO SCREENS (owner's correction, 2026-10-29). Customers & Credit and the account
 * list are one story told twice — the section says "here is the money and the four jobs", the
 * list says "here is who owes it" — so they open with the same plate, the same words and the same
 * measurements. While each screen drew its own copy, the two drifted: one showed the overdue
 * amount, the other an overdue count, and a reader had to work out whether they were looking at
 * the same figure.
 *
 * Every number comes from `summariseCustomerCollection`, i.e. from the rows the screen already
 * holds, so the plate can never describe a different population from the list under it.
 */
export default function CollectionPlate({ summary, ready, testId = "customers-collection" }: CollectionPlateProps) {
  const t = useT();
  const pct = Math.max(0, Math.min(100, summary.progressPct));

  return (
    <div
      className="rounded-[var(--radius-card)] p-4"
      style={{ background: "var(--surface)" }}
      data-testid={testId}
    >
      <p className="text-12" style={{ color: "var(--text-secondary)" }}>
        {t("receivable.totalOutstanding")}
      </p>
      <p
        className="text-26 font-bold mt-1 tabular-nums break-words"
        data-testid="customers-total-outstanding"
      >
        {ready ? formatCurrency(summary.due) : "—"}
      </p>

      <div className="flex items-baseline justify-between gap-3 mt-4">
        <p className="text-13" style={{ color: "var(--text-secondary)" }}>
          {t("receivable.progress")}
        </p>
        <p
          className="text-13 font-bold tabular-nums"
          style={{ color: summary.progressPct > 0 ? "var(--brand-dark)" : "var(--text-secondary)" }}
        >
          {ready ? `${summary.progressPct}%` : "—"}
        </p>
      </div>
      <div
        className="mt-2 h-1.5 rounded-full overflow-hidden"
        style={{ background: "var(--surface-2)" }}
        role="progressbar"
        aria-valuenow={summary.progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("receivable.progress")}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--brand)" }} />
      </div>

      <div className="flex items-end justify-between gap-3 mt-2">
        <div className="min-w-0">
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {t("overall.collected")}
          </p>
          <p className="text-14 font-bold mt-0.5 tabular-nums break-words">
            {ready ? formatCurrency(summary.collected) : "—"}
          </p>
        </div>
        <div className="min-w-0 text-end">
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {t("receivable.totalDue")}
          </p>
          <p className="text-14 font-bold mt-0.5 tabular-nums break-words">
            {ready ? formatCurrency(summary.billed) : "—"}
          </p>
        </div>
      </div>

      {/* Three counts, each naming the population it counts — never a number the reader has to
          guess the meaning of. Figures, not doors: the list's chips are the one control that
          filters accounts, and a count that also changed the view would be a second, silent way
          to do the same job. */}
      <div className="grid grid-cols-3 gap-2 mt-4">
        <div
          className="rounded-[var(--radius-tile)] px-3 py-2 min-w-0"
          style={{ background: "var(--surface-2)" }}
          data-testid="collection-count-accounts"
        >
          <p className="text-11 truncate" style={{ color: "var(--text-secondary)" }}>
            {t("receivable.customers")}
          </p>
          <p className="text-16 font-bold mt-0.5 tabular-nums">{ready ? summary.accounts : "—"}</p>
          <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>
            {t("receivable.accounts")}
          </p>
        </div>
        <div
          className="rounded-[var(--radius-tile)] px-3 py-2 min-w-0"
          style={{ background: "var(--surface-2)" }}
          data-testid="collection-count-pending"
        >
          <p className="text-11 truncate" style={{ color: "var(--text-secondary)" }}>
            {t("receivable.pending")}
          </p>
          <p className="text-16 font-bold mt-0.5 tabular-nums">{ready ? summary.pending : "—"}</p>
          <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>
            {t("receivable.haveBalance")}
          </p>
        </div>
        <div
          className="rounded-[var(--radius-tile)] px-3 py-2 min-w-0"
          style={{ background: "var(--surface-2)" }}
          data-testid="collection-count-overdue"
        >
          <p className="text-11 truncate" style={{ color: "var(--text-secondary)" }}>
            {t("receivable.overdue")}
          </p>
          <p
            className="text-16 font-bold mt-0.5 tabular-nums"
            style={{ color: summary.overdue > 0 ? "var(--error)" : "var(--text-primary)" }}
          >
            {ready ? summary.overdue : "—"}
          </p>
          <p className="text-10 truncate" style={{ color: "var(--text-tertiary)" }}>
            {t("receivable.followUp")}
          </p>
        </div>
      </div>
    </div>
  );
}
