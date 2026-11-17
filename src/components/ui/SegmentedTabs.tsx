import type { ReactNode } from "react";

export interface SegmentedTab<K extends string = string> {
  key: K;
  label: ReactNode;
  /** A number the tab carries, e.g. open reminders. Rendered inside the pill. */
  count?: number;
}

interface SegmentedTabsProps<K extends string> {
  items: SegmentedTab<K>[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
  /**
   * `pressed` for a filter over one list (All / Credit / Paid); `tab` for panes of one screen.
   * Screen readers need to hear the difference, and the two read differently in a swipe.
   */
  semantics?: "pressed" | "tab";
  /** A smaller type step for four short tabs in one row (the supplier screen). */
  compact?: boolean;
  className?: string;
  testId?: string;
  itemTestId?: (key: K) => string;
}

/**
 * The app's one tab bar.
 *
 * A track with one raised pill, measured from the owner's reference: 48px track, 40px pill, so
 * the pill sits 4px clear on every side instead of touching the track's edge. The selected pill
 * is the app's black with white text in **both themes** — the ink token flips to near-white in
 * the dark theme, and a white pill on a pale track is the block the reference replaced. The
 * track is `--tone-sunken`, which is the pale grey it should be in light and the near-black it
 * should be in dark, so the same control reads correctly without a second set of colours.
 *
 * Labels stay on the 13px type step; nothing here invents a smaller one.
 */
export default function SegmentedTabs<K extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  semantics = "pressed",
  compact = false,
  className = "",
  testId,
  itemTestId,
}: SegmentedTabsProps<K>) {
  const isTab = semantics === "tab";
  return (
    <div
      role={isTab ? "tablist" : "group"}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`flex items-center gap-1 rounded-full ${className}`}
      style={{ background: "var(--tone-sunken)", height: 48, padding: 4 }}
    >
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role={isTab ? "tab" : undefined}
            aria-selected={isTab ? selected : undefined}
            aria-pressed={isTab ? undefined : selected}
            onClick={() => onChange(item.key)}
            data-testid={itemTestId?.(item.key)}
            className={`flex-1 min-w-0 rounded-full ${compact ? "text-12" : "text-13"} font-semibold truncate px-2 transition-colors active:opacity-70 flex items-center justify-center gap-1.5`}
            style={
              selected
                ? { height: 40, background: "#0a0a09", color: "#ffffff" }
                : { height: 40, background: "transparent", color: "var(--text-secondary)" }
            }
          >
            <span className="truncate">{item.label}</span>
            {item.count != null && item.count > 0 && (
              <span
                className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-10 font-bold tabular-nums"
                style={
                  selected
                    ? { background: "rgba(255,255,255,0.22)", color: "#ffffff" }
                    : { background: "var(--tone-card)", color: "var(--text-secondary)" }
                }
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
