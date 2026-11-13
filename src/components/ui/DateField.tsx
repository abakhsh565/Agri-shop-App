import { useEffect, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import { useT } from "@/lib/i18n";
import { pkToday } from "@/lib/pkDate";

/**
 * A date, chosen on the app's own calendar.
 *
 * WHY NOT `<input type="date">`. On the phones this app is used on, the native control opens a
 * picker drawn by Android, in the device's language, with its own idea of a month grid — a second
 * design language inside a screen that has one. It also cannot show which days are allowed before
 * the picker is open, and on a small screen the dialog can cover the field it belongs to. The
 * owner's instruction (2026-10-30) was to use our calendar everywhere instead.
 *
 * The field is a button that states the day it holds; the month grid is one sheet, the same on
 * every screen, with the window the caller allows (no future deliveries, no date before the range)
 * drawn as disabled days rather than as a surprise when Apply is pressed. One tap on a day is the
 * answer — there is no Apply here, because the sheet is answering exactly one question.
 */

function parseISO(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The day a person reads: 30 Oct 2026. English months, as every other date in the app. */
export function displayDate(value: string): string {
  const parsed = parseISO(value);
  if (!parsed) return "";
  return new Date(parsed.y, parsed.m - 1, parsed.d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface CalendarSheetProps {
  open: boolean;
  value: string;
  /** The newest day that may be chosen (YYYY-MM-DD). */
  max?: string;
  /** The oldest day that may be chosen (YYYY-MM-DD). */
  min?: string;
  title?: string;
  onClose: () => void;
  onPick: (value: string) => void;
}

export function CalendarSheet({ open, value, max, min, title, onClose, onPick }: CalendarSheetProps) {
  const t = useT();
  const today = pkToday();
  const seed = parseISO(value) ?? parseISO(today)!;
  const [shown, setShown] = useState({ y: seed.y, m: seed.m });

  // Opening starts on the month of the day the field holds, not on the month last browsed.
  useEffect(() => {
    if (!open) return;
    const next = parseISO(value) ?? parseISO(today)!;
    setShown({ y: next.y, m: next.m });
  }, [open, value, today]);

  const first = new Date(shown.y, shown.m - 1, 1);
  const daysInMonth = new Date(shown.y, shown.m, 0).getDate();
  // Sunday first — the same week the app's "This week" filter starts on (`pkWeekStart`).
  const leading = first.getDay();
  const monthLabel = first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];

  function step(delta: number) {
    const next = new Date(shown.y, shown.m - 1 + delta, 1);
    setShown({ y: next.getFullYear(), m: next.getMonth() + 1 });
  }

  const outOfWindow = (day: string) => (max != null && day > max) || (min != null && day < min);

  return (
    <Sheet open={open} title={title ?? t("calendar.title")} onClose={onClose} closeButton={false}>
      <div className="px-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t("calendar.previous")}
            data-testid="calendar-prev"
            className="ds-iconbtn"
          >
            <ChevronLeft size={18} />
          </button>
          <p className="text-14 font-bold" aria-live="polite">{monthLabel}</p>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t("calendar.next")}
            data-testid="calendar-next"
            className="ds-iconbtn"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Latin weekday initials and Sunday-first order, fixed left-to-right: the grid is a
            calendar, not a paragraph, and reversing it would put Saturday under S. */}
        <div dir="ltr">
          <div className="grid grid-cols-7 mb-1">
            {weekdayLabels.map((label, index) => (
              <span
                key={`${label}-${index}`}
                className="text-center text-10 font-semibold py-1"
                style={{ color: "var(--text-tertiary)" }}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1">
            {Array.from({ length: leading }, (_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const valueOfDay = iso(shown.y, shown.m, day);
              const selected = valueOfDay === value;
              const isToday = valueOfDay === today;
              const disabled = outOfWindow(valueOfDay);
              return (
                <button
                  key={valueOfDay}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  aria-label={displayDate(valueOfDay)}
                  data-testid={`calendar-day-${valueOfDay}`}
                  onClick={() => {
                    onPick(valueOfDay);
                    onClose();
                  }}
                  className="mx-auto size-10 rounded-full flex items-center justify-center text-13 font-semibold transition-colors active:opacity-70 disabled:opacity-25"
                  style={
                    selected
                      ? { background: "var(--brand)", color: "var(--ink-fg)" }
                      : isToday
                        ? { background: "var(--surface-2)", color: "var(--text-primary)" }
                        : { background: "transparent", color: "var(--text-primary)" }
                  }
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        {!outOfWindow(today) && value !== today && (
          <button
            type="button"
            onClick={() => {
              onPick(today);
              onClose();
            }}
            data-testid="calendar-today"
            className="mt-3 w-full h-11 rounded-full text-13 font-semibold ds-pressable"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
          >
            {t("period.today")}
          </button>
        )}
      </div>
    </Sheet>
  );
}

interface DateFieldProps {
  /** YYYY-MM-DD, or "" for a day not chosen yet. */
  value: string;
  onChange: (value: string) => void;
  max?: string;
  min?: string;
  /** The sheet's heading; defaults to "Choose a day". */
  title?: string;
  testId?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Height and text size follow the field it stands in for. */
  className?: string;
}

/**
 * The field: a button that says the day it holds, and opens the calendar above.
 *
 * It deliberately does not carry its own label — the screen already writes "From" or "To" above
 * it, and a control that repeated the label would be two labels for one answer.
 */
export default function DateField({
  value,
  onChange,
  max,
  min,
  title,
  testId,
  ariaLabel,
  disabled,
  className,
}: DateFieldProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={ariaLabel ?? t("calendar.title")}
        data-testid={testId}
        className={
          className ??
          "w-full h-12 rounded-[var(--radius-tile)] px-3 flex items-center justify-between gap-2 text-13 text-start active:opacity-70 disabled:opacity-45"
        }
        style={{ background: "var(--field-bg)", color: value ? "var(--text-primary)" : "var(--text-tertiary)" }}
      >
        <span className="truncate">{value ? displayDate(value) : t("dateField.empty")}</span>
        <Calendar size={15} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
      </button>

      <CalendarSheet
        open={open}
        value={value}
        min={min}
        max={max}
        title={title}
        onClose={() => setOpen(false)}
        onPick={onChange}
      />
    </>
  );
}
