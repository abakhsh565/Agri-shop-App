import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ReceiptText } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";

/**
 * One credit book, two ways of reading it.
 *
 * Pending and overdue are the same list with a different date test, so they are the same screen:
 * the summary, the ageing tabs, the three views and the two row actions are written once here and
 * the customer and supplier pages only supply the rows. That is what keeps the two sides of the
 * business reading alike — a change to one is a change to both.
 *
 * THE TWO FIGURES ARE DIFFERENT QUESTIONS. The left one is the whole book (everything still owed
 * in this branch); the right one is what this screen is about — the overdue slice for one mode,
 * the not-yet-due slice for the other, or the number of suppliers owed. The rows below are always
 * the mode's slice, and the ageing tabs narrow that slice without changing the totals.
 *
 * NOTHING HERE INVENTS A DATE. A row's `days` is computed by the page from the record's own due
 * date; a customer or supplier with no date is listed under "All" and says so, rather than being
 * sorted into a bucket it does not belong to.
 */
/**
 * One count on a credit screen: what it is, the figure, and what the figure counts.
 *
 * Shared by the customer and supplier collection screens so the three counts are literally the
 * same control on both — a figure on one side cannot be a control on the other.
 *
 * A FIGURE, NOT A BUTTON (owner's correction, 2026-10-28). These tiles used to carry an arrow and
 * open a screen of their own; then they filtered the list below; now they are read-only. The
 * filtering lives on the chips under the search — one control for one job — so the tile is a
 * plain card with no press state and no pointer.
 */
export function StatTile({
  label, value, caption, testId, color,
}: {
  label: string;
  value: number;
  caption: string;
  testId: string;
  color?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-[var(--radius-tile)] px-3 py-2.5"
      style={{ background: "var(--tone-card)" }}
    >
      <span className="block text-10 truncate" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="block text-16 font-bold mt-0.5 tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
      <span className="block text-10 truncate" style={{ color: "var(--text-tertiary)" }}>{caption}</span>
    </div>
  );
}

export interface CreditRow {
  id: string;
  name: string;
  /** Branch and due date, as the row's second line. */
  meta: string;
  amount: number;
  stateLabel: string;
  stateColor: string;
  /** Days past due (overdue) or days until due (pending); 0 when there is no date. */
  days: number;
}

interface Props {
  /** Nav bar title. */
  title: string;
  backTo: string;
  /** Branch and currency, under the summary's title. */
  scope: string;
  summaryTitle: string;
  totalLabel: string;
  totalValue: number;
  sliceLabel: string;
  /** Already formatted: an amount on one side, a count on the other. */
  sliceValue: string;
  /** The ageing strip's "all" label — "All overdue" or "All pending". */
  allLabel: string;
  /** The three views, as navigation: all outstanding, not yet due, overdue. */
  views: { label: string; to: string; active: boolean }[];
  rows: CreditRow[];
  emptyLabel: string;
  viewLabel: string;
  testId: string;
  onView: (id: string) => void;
  onPay: (id: string) => void;
}

type Ageing = "all" | "1-7" | "8-30";

export default function CreditListScreen({
  title, backTo, scope, summaryTitle, totalLabel, totalValue, sliceLabel, sliceValue,
  allLabel, views, rows, emptyLabel, viewLabel, testId, onView, onPay,
}: Props) {
  const t = useT();
  const navigate = useNavigate();
  const [ageing, setAgeing] = useState<Ageing>("all");

  const shown = rows.filter((row) => {
    if (ageing === "all") return true;
    if (row.days <= 0) return false;
    return ageing === "1-7" ? row.days <= 7 : row.days > 7 && row.days <= 30;
  });

  const ageingOptions: { key: Ageing; label: string }[] = [
    { key: "all", label: allLabel },
    { key: "1-7", label: t("creditList.days1to7") },
    { key: "8-30", label: t("creditList.days8to30") },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid={testId}
    >
      <StatusBar />
      <NavHeader title={title} backTo={backTo} />

      {/* Ageing, straight on the page: the tabs only narrow the list below, they never change a
          total, so they sit above the card rather than inside it. */}
      <div className="flex gap-2 px-4 pt-2 pb-1 flex-wrap">
        {ageingOptions.map((option) => {
          const selected = ageing === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setAgeing(option.key)}
              aria-pressed={selected}
              className="h-9 px-4 rounded-full text-13 font-semibold transition-colors"
              style={
                selected
                  ? { background: "var(--brand)", color: "#0a0a0a" }
                  : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid={`${testId}-summary`}
        >
          <p className="text-15 font-bold">{summaryTitle}</p>
          <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>{scope}</p>

          <div className="flex gap-5 mt-4">
            <div className="min-w-0 flex-1">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>{totalLabel}</p>
              <p className="text-18 font-bold mt-0.5 tabular-nums break-words">{formatCurrency(totalValue)}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>{sliceLabel}</p>
              <p className="text-18 font-bold mt-0.5 tabular-nums break-words">{sliceValue}</p>
            </div>
          </div>

          <div className="flex gap-2 mt-4 flex-wrap">
            {views.map((view) => (
              <button
                key={view.to}
                type="button"
                onClick={() => navigate(view.to)}
                aria-pressed={view.active}
                className="h-7 px-3 rounded-full text-11 font-semibold"
                style={
                  view.active
                    ? { background: "var(--brand)", color: "#0a0a0a" }
                    : { background: "var(--surface-2)", color: "var(--text-secondary)" }
                }
              >
                {view.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="px-4 pt-10 flex flex-col items-center gap-2">
          <ReceiptText size={28} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>{emptyLabel}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 px-4 pt-4 pb-8">
          {shown.map((row) => (
            <div
              key={row.id}
              className="rounded-[var(--radius-card)] p-3.5"
              style={{ background: "var(--tone-card)" }}
              data-testid={`${testId}-row-${row.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-14 font-bold truncate">{row.name}</p>
                  <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                    {row.meta}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="text-14 font-bold tabular-nums">{formatCurrency(row.amount)}</p>
                  <span
                    className="inline-block mt-1 text-10 font-bold px-2 py-0.5 rounded-full"
                    style={{ color: row.stateColor, background: "var(--surface-2)" }}
                  >
                    {row.stateLabel}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => onView(row.id)}
                  className="flex-1 h-9 rounded-[var(--radius-tile)] text-12 font-semibold active:opacity-70"
                  style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
                >
                  {viewLabel}
                </button>
                <button
                  type="button"
                  onClick={() => onPay(row.id)}
                  className="flex-1 h-9 rounded-[var(--radius-tile)] text-12 font-bold active:opacity-70"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  {t("creditList.recordPayment")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
