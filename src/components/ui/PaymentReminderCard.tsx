import { Bell, CheckCircle2, ChevronRight, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency } from "@/lib/formatters";
import { REPEAT_KEY, type RepeatUnit } from "@/lib/financeEntries";
import {
  reminderWhen,
  type PaymentReminder,
  type PaymentReminderStatus,
} from "@/lib/paymentReminders";
import { reminderParty } from "@/lib/paymentReminders";

/**
 * One line of the owner's payment diary, on every screen that shows one.
 *
 * ONE CARD because the same reminder is read on the cash screen, in the supplier's tab and in the
 * reminder book. Three drawings of the same entry is how a date, a cadence or a status starts
 * disagreeing with itself.
 *
 * THE CARD SAYS FOUR THINGS AND NOTHING ELSE: what the reminder is called, who it is about and for
 * how much, when it next falls, and where it stands. Notes are one clamped line — the owner asked
 * for less text, not a second screen.
 */
interface PaymentReminderCardProps {
  reminder: PaymentReminder;
  /** Today in the shop's timezone; the caller already knows it. */
  today: string;
  /** Shown only when the reader may act on the row. */
  onEdit?: () => void;
  onDelete?: () => void;
  onStatus?: (status: PaymentReminderStatus) => void;
  /**
   * Where the party's own record lives. The same reminder is read in the diary and on the
   * customer or supplier screen, so the line that names the party is the way between them —
   * a link on only one of the two screens was the one-way door (owner's request, 2026-10-31).
   */
  onOpenParty?: () => void;
  testId?: string;
}

/** "Every 2 weeks", "Monthly", "Once" — the same words the form offers. */
const EVERY_KEY = {
  day: "finance.repeat.everyDays",
  week: "finance.repeat.everyWeeks",
  month: "finance.repeat.everyMonths",
  year: "finance.repeat.everyYears",
} as const;

function dayLabel(day: string, today: string, locale: "ur-PK" | "en-GB", t: ReturnType<typeof useT>) {
  if (day === today) return t("cashPosition.dueToday");
  const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (day === tomorrow) return t("cashPosition.dueTomorrow");
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function repeatWords(unit: RepeatUnit, every: number, t: ReturnType<typeof useT>): string {
  if (unit === "none") return t("finance.repeat.none");
  return every <= 1 ? t(REPEAT_KEY[unit]) : t(EVERY_KEY[unit], { n: every });
}

export default function PaymentReminderCard({
  reminder,
  today,
  onEdit,
  onDelete,
  onStatus,
  onOpenParty,
  testId,
}: PaymentReminderCardProps) {
  const t = useT();
  const language = useThemeStore((s) => s.language);
  const when = reminderWhen(reminder, today);
  const party = reminderParty(reminder);
  const closed = reminder.status !== "upcoming";

  const statusLabel =
    reminder.status === "completed"
      ? t("paymentBook.statusCompleted")
      : reminder.status === "cancelled"
        ? t("paymentBook.statusCancelled")
        : null;

  const tone = when.dueToday || when.late ? "var(--brand-dark)" : "var(--text-tertiary)";

  return (
    <div
      className="rounded-[var(--radius-card)] p-3.5"
      style={{ background: "var(--tone-card)", opacity: closed ? 0.72 : 1 }}
      data-testid={testId}
    >
      <div className="flex items-start gap-3">
        <span
          className="size-10 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: "var(--tone-sunken)",
            color: when.dueToday && !closed ? "var(--brand-dark)" : "var(--text-secondary)",
          }}
        >
          <Bell size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-14 font-bold truncate">{reminder.title}</p>
          {onOpenParty ? (
            <button
              type="button"
              onClick={onOpenParty}
              data-testid={testId ? `${testId}-party` : undefined}
              className="flex items-center gap-1 mt-0.5 max-w-full text-start active:opacity-70"
            >
              <span className="text-11 truncate" style={{ color: "var(--text-secondary)" }}>
                {[party, reminder.amount == null ? null : formatCurrency(reminder.amount)]
                  .filter(Boolean)
                  .join(" · ") || t("cashPosition.reminderNoPerson")}
              </span>
              <ChevronRight
                size={12}
                className="shrink-0"
                style={{ color: "var(--text-tertiary)" }}
              />
            </button>
          ) : (
            <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
              {[party, reminder.amount == null ? null : formatCurrency(reminder.amount)]
                .filter(Boolean)
                .join(" · ") || t("cashPosition.reminderNoPerson")}
            </p>
          )}
        </div>
        {statusLabel && (
          <span
            className="shrink-0 text-10 font-bold px-2 py-0.5 rounded-full"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            {statusLabel}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 mt-2">
        <p className="text-10 truncate tabular-nums" style={{ color: closed ? "var(--text-tertiary)" : tone }}>
          {closed ? t("paymentBook.wasDue", { date: reminder.dueOn }) : dayLabel(when.on, today, language === "ur" ? "ur-PK" : "en-GB", t)}
          {" · "}
          {reminder.dueTime}
        </p>
        {!statusLabel && (
          <span
            className="text-10 font-bold px-2 py-0.5 rounded-full shrink-0"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            {repeatWords(reminder.repeatUnit, reminder.repeatEvery, t)}
          </span>
        )}
      </div>

      {reminder.notes && (
        <p className="text-11 mt-2 line-clamp-2 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {reminder.notes}
        </p>
      )}

      {(onStatus || onEdit || onDelete) && (
        <div className="flex items-center gap-1 mt-3">
          {onStatus && (
            <button
              type="button"
              onClick={() => onStatus(closed ? "upcoming" : "completed")}
              data-testid={testId ? `${testId}-status` : undefined}
              className="h-8 px-3 rounded-full flex items-center gap-1.5 text-11 font-bold active:opacity-70"
              style={{ background: "var(--tone-sunken)", color: "var(--brand-dark)" }}
            >
              {closed ? <RotateCcw size={13} /> : <CheckCircle2 size={13} />}
              {closed ? t("paymentBook.reopen") : t("paymentBook.markDone")}
            </button>
          )}
          <span className="flex-1" />
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={t("cashPosition.editReminder")}
              data-testid={testId ? `${testId}-edit` : undefined}
              className="size-9 rounded-full flex items-center justify-center active:opacity-60"
              style={{ color: "var(--text-secondary)" }}
            >
              <Pencil size={15} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={t("cashPosition.reminderDelete")}
              data-testid={testId ? `${testId}-delete` : undefined}
              className="size-9 rounded-full flex items-center justify-center active:opacity-60"
              style={{ color: "var(--error)" }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
