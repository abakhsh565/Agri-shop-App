import { useEffect, useState } from "react";
import Sheet from "@/components/ui/Sheet";
import { useT } from "@/lib/i18n";

/**
 * The date window for a book of balances, as one line of chips.
 *
 * WHY CHIPS (owner's correction, 2026-10-30). The first version was a list of plates, each with a
 * glyph and a sentence explaining what the window measures. That reads as a settings list: five
 * rows, five captions and a tick, to pick one of five known words. The windows are short and
 * already understood — yesterday's work is not explained — so the choice is one row of chips, the
 * same control the screens already use for their other filters. The labels are still the whole
 * answer, so nothing is lost but the explaining.
 *
 * "Custom" is the one choice that needs more than a word, so the two dates appear under the chips
 * when it is chosen, inside this same sheet. Every other chip applies and closes the sheet in one
 * tap.
 *
 * "All dates" stays first and stays the default: a reader who never opens the sheet sees exactly
 * what the screen showed before it existed.
 */
export type BalancePeriod = "all" | "today" | "week" | "month" | "year" | "custom";

interface BalanceDateSheetProps {
  open: boolean;
  onClose: () => void;
  /** The sheet's own name — "Choose dates". */
  title: string;
  value: BalancePeriod;
  /** The custom range in force (YYYY-MM-DD). */
  from: string;
  to: string;
  /** Today in the shop's timezone — the newest day a range may end on. */
  max: string;
  onChange: (key: BalancePeriod, from: string, to: string) => void;
  testIdPrefix: string;
}

export default function BalanceDateSheet({
  open,
  onClose,
  title,
  value,
  from,
  to,
  max,
  onChange,
  testIdPrefix,
}: BalanceDateSheetProps) {
  const t = useT();
  const [draftFrom, setDraftFrom] = useState(from || max);
  const [draftTo, setDraftTo] = useState(to || max);
  // The two dates are shown for the choice being made, not only for the range already in force:
  // tapping Custom on a screen set to "This month" must open From and To, not hide them behind a
  // second tap.
  const [customChosen, setCustomChosen] = useState(value === "custom");

  // Reopening starts from the range in force, never from an abandoned draft.
  useEffect(() => {
    if (open) {
      setDraftFrom(from || max);
      setDraftTo(to || max);
      setCustomChosen(value === "custom");
    }
  }, [open, from, to, max, value]);

  const options: { key: BalancePeriod; label: string }[] = [
    { key: "all", label: t("period.allDates") },
    { key: "today", label: t("period.today") },
    { key: "week", label: t("period.week") },
    { key: "month", label: t("period.month") },
    { key: "year", label: t("period.year") },
    { key: "custom", label: t("overall.custom") },
  ];

  const valid = Boolean(draftFrom && draftTo) && draftFrom <= max && draftTo <= max && draftFrom <= draftTo;

  return (
    <Sheet open={open} onClose={onClose} title={title} closeButton={false}>
      <div className="px-4 pb-4">
        {/* One row, scrolling sideways on a narrow phone rather than wrapping into a second line:
            the six windows are one choice, so they stay one row. */}
        <div
          className="flex gap-2 overflow-x-auto pb-1"
          data-testid={`${testIdPrefix}-options`}
          style={{ scrollbarWidth: "none" }}
        >
          {options.map((option) => {
            const chosen = option.key === "custom" ? customChosen : value === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  if (option.key === "custom") {
                    // Stay open: the two dates are the rest of this answer.
                    setCustomChosen(true);
                    return;
                  }
                  setCustomChosen(false);
                  onChange(option.key, from, to);
                  onClose();
                }}
                aria-pressed={chosen}
                data-testid={`${testIdPrefix}-${option.key}`}
                className="shrink-0 whitespace-nowrap h-10 px-4 rounded-full text-13 font-semibold transition-colors active:opacity-70"
                style={
                  chosen
                    ? { background: "var(--brand)", color: "#0a0a0a" }
                    : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {customChosen && (
          <div className="mt-3">
            <div className="flex items-end gap-2">
              <label className="flex-1 min-w-0">
                <span className="ds-section-label block mb-1">{t("admin.from")}</span>
                <input
                  type="date"
                  value={draftFrom}
                  max={draftTo || max}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next > max) return;
                    setDraftFrom(next);
                    if (next && draftTo && next > draftTo) setDraftTo(next);
                  }}
                  data-testid={`${testIdPrefix}-from`}
                  className="w-full h-12 rounded-[var(--radius-tile)] px-2 outline-none text-13"
                  style={{ background: "var(--field-bg)" }}
                />
              </label>
              <label className="flex-1 min-w-0">
                <span className="ds-section-label block mb-1">{t("admin.to")}</span>
                <input
                  type="date"
                  value={draftTo}
                  min={draftFrom || undefined}
                  max={max}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next > max) return;
                    setDraftTo(next);
                  }}
                  data-testid={`${testIdPrefix}-to`}
                  className="w-full h-12 rounded-[var(--radius-tile)] px-2 outline-none text-13"
                  style={{ background: "var(--field-bg)" }}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={!valid}
              onClick={() => {
                onChange("custom", draftFrom, draftTo);
                onClose();
              }}
              data-testid={`${testIdPrefix}-apply`}
              className="mt-2 w-full h-12 rounded-full text-14 font-bold ds-pressable disabled:opacity-45"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {t("reports.apply")}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
