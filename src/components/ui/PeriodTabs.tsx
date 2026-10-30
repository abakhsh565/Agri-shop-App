import { SlidersHorizontal } from "lucide-react";

/**
 * The app's one period tab: three presets in a sunken pill, and the range filter beside it.
 *
 * WHY IT IS A COMPONENT. The same three choices — today, this week, this month — were drawn
 * separately by every screen that needed a window, so each one had its own height, weight and
 * selected treatment. This is the shape from the owner's reference: one capsule holding the
 * presets, the selected one a slightly raised pill with its own edge, and a separate round
 * button to the right carrying the filter glyph for a hand-picked range.
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
   * Only the treatment changes — the choices, the test ids and the behaviour are the same.
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
      </div>

      {onFilter && (
        <button
          type="button"
          onClick={onFilter}
          aria-label={filterLabel}
          aria-pressed={filterActive}
          data-testid={`${testIdPrefix}-filter`}
          className={`${underline ? "size-10" : "size-11"} shrink-0 rounded-full flex items-center justify-center ds-pressable`}
          style={
            filterActive
              ? { background: "var(--brand-light)", color: "var(--brand-dark)" }
              : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }
          }
        >
          <SlidersHorizontal size={16} />
        </button>
      )}
    </div>
  );
}
