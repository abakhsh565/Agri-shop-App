import { SlidersHorizontal } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * The app's one period tab: three presets in a sunken pill, and the range filter beside it.
 *
 * WHY IT IS A COMPONENT. The same three choices — today, this week, this month — were drawn
 * separately by every screen that needed a window, so each one had its own height, weight and
 * selected treatment. This is the shape from the owner's reference: one capsule holding the
 * presets, the selected one a slightly raised pill with its own edge, and a separate round
 * button to the right carrying the filter glyph for a hand-picked range — except on the report
 * variant (`underline`), where that control is the word "Custom" instead (owner, 2026-11-12).
 *
 * `value` may be `null`: that is how a screen says "the figures cover a custom range, no preset
 * is selected". The filter button then takes the selected treatment instead, so the strip always
 * shows what the numbers below it are measuring.
 */
export interface PeriodOption<K extends string> {
  key: K;
  label: string;
}

interface PeriodTabsProps<K extends string> {
  options: readonly PeriodOption<K>[];
  value: K | null;
  onChange: (key: K) => void;
  /**
   * `pill` (the default) is the capsule every list screen wears. `underline` is the report
   * variant from the owner's reference: the presets sit on one hairline and the chosen one is
   * marked by a heavier rule under it, so a report reads as figures rather than as a filter.
   * That hairline spans the whole strip and runs on beneath the Custom control to the end of the
   * row (owner's reference, 2026-11-12) — Custom is the strip's last stop, not a floating control
   * beside it. Only the treatment changes — the choices, the test ids and the behaviour are the
   * same.
   */
  variant?: "pill" | "underline";
  /** Draws the filter button. Omit it on a screen with no range to pick. */
  onFilter?: () => void;
  /** Highlights the filter button — a custom range is what the screen is showing. */
  filterActive?: boolean;
  /** Accessible name for the strip itself, e.g. "Period". */
  label: string;
  /** Accessible name for the filter button; the glyph alone does not say what it does. */
  filterLabel: string;
  /** Stable prefix for the test ids: `${testIdPrefix}-${key}` and `${testIdPrefix}-filter`. */
  testIdPrefix?: string;
}

export default function PeriodTabs<K extends string>({
  options,
  value,
  onChange,
  variant = "pill",
  onFilter,
  filterActive = false,
  label,
  filterLabel,
  testIdPrefix = "period",
}: PeriodTabsProps<K>) {
  const t = useT();
  const underline = variant === "underline";

  return (
    <div className="flex items-center gap-2">
      <div
        className={
          underline
            ? "flex-1 flex items-end gap-1 min-w-0 border-b"
            : "flex-1 flex items-center gap-1 p-1 rounded-full min-w-0"
        }
        style={underline ? { borderColor: "var(--hairline)" } : { background: "var(--tone-sunken)" }}
        role="group"
        aria-label={label}
      >
        {options.map((option) => {
          const selected = value === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onChange(option.key)}
              aria-pressed={selected}
              data-testid={`${testIdPrefix}-${option.key}`}
              className={
                underline
                  ? "flex-1 h-10 px-1 text-13 font-semibold transition-colors truncate border-b-2 -mb-px"
                  : "flex-1 h-9 px-1 rounded-full text-13 font-semibold transition-colors truncate"
              }
              style={
                underline
                  ? {
                      background: "transparent",
                      color: selected ? "var(--text-primary)" : "var(--text-secondary)",
                      borderColor: selected ? "var(--text-primary)" : "transparent",
                    }
                  : selected
                    ? { background: "var(--tone-card)", color: "var(--text-primary)" }
                    : { background: "transparent", color: "var(--text-secondary)" }
              }
            >
              {option.label}
            </button>
          );
        })}

        {/* The hand-picked range on a report is a WORD, not a glyph, and it is the strip's last
            stop: the hairline under the presets runs on beneath it to the end of the row
            (owner, 2026-11-12). Same control, same test id, same active state as the pill
            variant's filter button — only the label and its place in the strip differ. */}
        {underline && onFilter && (
          <button
            type="button"
            onClick={onFilter}
            aria-label={filterLabel}
            aria-pressed={filterActive}
            data-testid={`${testIdPrefix}-filter`}
            className="shrink-0 h-10 px-1 text-13 font-semibold ds-pressable"
            style={{
              color: filterActive ? "var(--brand-dark)" : "var(--text-secondary)",
            }}
          >
            {t("overall.custom")}
          </button>
        )}
      </div>

      {onFilter && !underline && (
        <>
          <button
            type="button"
            onClick={onFilter}
            aria-label={filterLabel}
            aria-pressed={filterActive}
            data-testid={`${testIdPrefix}-filter`}
            className="size-11 shrink-0 rounded-full flex items-center justify-center ds-pressable"
            style={
              filterActive
                ? { background: "var(--brand-light)", color: "var(--brand-dark)" }
                : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
            }
          >
            <SlidersHorizontal size={16} />
          </button>
        </>
      )}
    </div>
  );
}
