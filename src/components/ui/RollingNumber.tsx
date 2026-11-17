import { useEffect, useRef, useState } from "react";

/**
 * A figure that counts to its next value instead of swapping.
 *
 * WHY IT EXISTS. Two behaviours, one component, because both answer the same question — "did the
 * number under my finger change?":
 *
 * · `value` + `format` — the money path. The figure tweens from where it was to where it is now
 *   over ~600ms, so All → Today → Yesterday on the dashboard counts down from Rs. 157,000 to
 *   Rs. 5,000 instead of blinking. This is the reference's counter, applied to totals.
 * · `text` — the string path, for a figure that only exists already-formatted. Only the digits
 *   that changed roll, so a quantity's ones column moves on its own.
 *
 * WHAT IT NEVER DOES. It does not invent a number or a currency: `format` is always the app's own
 * `formatCurrency`/`formatRs`, and the dash used for "no figure yet" is drawn as it is.
 *
 * Accessibility and motion: the whole thing is `aria-hidden` behind one readable copy of the same
 * text, so a screen reader hears "Rs. 24,182" once. Both behaviours are off under
 * `prefers-reduced-motion`.
 */
export default function RollingNumber({
  text,
  value,
  format,
  className,
  style,
}: {
  /** The formatted figure, for a value that only exists as a string. */
  text?: string;
  /** The figure itself. With `format`, the number counts up/down to it. */
  value?: number;
  format?: (value: number) => string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const numeric = value != null && format != null;
  const target = numeric ? (value as number) : null;
  const [shown, setShown] = useState(target ?? 0);
  const settled = useRef(target ?? 0);

  useEffect(() => {
    if (target == null) return;
    const from = settled.current;
    if (from === target) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      settled.current = target;
      setShown(target);
      return;
    }

    const started = performance.now();
    const duration = 620;
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(from + (target - from) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      } else {
        settled.current = target;
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  /**
   * The outgoing text is STATE, not a ref updated in an effect. With a ref, the very next
   * re-render of the page already saw the new value as "previous", so the outgoing digit left the
   * DOM a frame into its exit and the counter looked like it had simply repainted.
   *
   * Both branches keep their hooks above every `return`, so the hook order cannot change with the
   * props.
   */
  const label = text ?? "";
  const [state, setState] = useState({ shown: label, previous: label, nonce: 0 });
  if (state.shown !== label) {
    setState({ shown: label, previous: state.shown, nonce: state.nonce + 1 });
  }

  if (numeric) {
    const formatted = (format as (n: number) => string)(Math.round(shown));
    return (
      <span className={className} style={style}>
        <span className="sr-only">{(format as (n: number) => string)(target as number)}</span>
        <span className="nr" aria-hidden="true" style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatted}
        </span>
      </span>
    );
  }

  // Digits are matched from the RIGHT: Rs. 5,000 → Rs. 12,500 keeps its units column in place.
  const before = state.shown === label ? state.previous : state.shown;
  const shift = label.length - before.length;

  return (
    <span className={className} style={style}>
      <span className="sr-only">{label}</span>
      <span className="nr" aria-hidden="true">
        {Array.from(label).map((char, i) => {
          const wasIndex = i - shift;
          const was = wasIndex >= 0 && wasIndex < before.length ? before[wasIndex] : char;
          const animate = was !== char && /\d/.test(char) && /\d/.test(was);
          if (!animate) {
            // No `nr-tick`: a still character must not carry an animation it then has to switch off.
            return (
              <span key={`s${state.nonce}-${i}`} className="nr-cell">
                {char === " " ? "\u00a0" : char}
              </span>
            );
          }
          const up = Number(char) > Number(was);
          return (
            <span key={`r${state.nonce}-${i}`} className="nr-cell">
              <span className={`nr-ghost${up ? "" : " nr-ghost--down"}`}>{was}</span>
              <span className={`nr-tick${up ? "" : " nr-tick--down"}`}>{char}</span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
