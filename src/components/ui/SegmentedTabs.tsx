import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

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
 * The selected pill SLIDES between the tabs, the way the reference's toggle does. Painting black
 * onto whichever button is selected was the same shape in the same place, but it teleported — and
 * on a control whose whole job is answering "which of these", the movement is what says the answer
 * changed. Measured, not assumed: the tabs are `flex-1`, their widths follow the label and the
 * language, so the indicator is re-measured when the track resizes (rotation, split view, Urdu).
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

  const trackRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  // The first placement must not animate: arriving on a screen with the pill flying in from the
  // left edge would suggest a change that did not happen.
  const [settled, setSettled] = useState(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const el = tabRefs.current.get(value);
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    const id = requestAnimationFrame(() => setSettled(true));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(id);
    };
  }, [value, items, compact]);

  return (
    <div
      ref={trackRef}
      role={isTab ? "tablist" : "group"}
      aria-label={ariaLabel}
      data-testid={testId}
      className={`relative flex items-center gap-1 rounded-full ${className}`}
      style={{ background: "var(--tone-sunken)", height: 48, padding: 4 }}
    >
      {pill && (
        <span
          aria-hidden="true"
          data-testid={testId ? `${testId}-pill` : undefined}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: pill.left,
            width: pill.width,
            top: 4,
            bottom: 4,
            background: "#0a0a09",
            transition: settled
              ? "left 300ms cubic-bezier(0.34, 1.24, 0.64, 1), width 300ms cubic-bezier(0.34, 1.24, 0.64, 1)"
              : "none",
          }}
        />
      )}
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
            ref={(el) => {
              if (el) tabRefs.current.set(item.key, el);
              else tabRefs.current.delete(item.key);
            }}
            data-testid={itemTestId?.(item.key)}
            className={`relative z-10 flex-1 min-w-0 rounded-full ${compact ? "text-12" : "text-13"} font-semibold truncate px-2 flex items-center justify-center gap-1.5`}
            style={{
              height: 40,
              background: "transparent",
              color: selected ? "#ffffff" : "var(--text-secondary)",
              transition: "color 160ms var(--ease-out)",
            }}
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
