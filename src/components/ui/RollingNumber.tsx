import { useState } from "react";

/**
 * A figure whose changed digits roll into place.
 *
 * ONE ANIMATION, EVERY FIGURE. The app shows money in a dozen places — the home card's total,
 * the Sales summary, the profit headline, the cart's line totals — and they used to move in two
 * different ways: a spent-600ms count-up on the ones driven by a number, and a digit roll on the
 * ones handed a formatted string. Two motions for the same kind of figure meant the app felt like
 * it was animating for two different reasons. This is the roll only: when the value changes, each
 * digit that changed travels out while the next travels in from the other side, over ~340ms.
 *
 * WHY NOT THE COUNT-UP. A total that ticks 157,000 → 5,000 spends six hundred milliseconds
 * displaying numbers that were never true, and every screen had to wait for it before it could be
 * read. The roll lands on the real figure immediately — the movement decorates the change instead
 * of delaying it.
 *
 * Digits are matched from the RIGHT, so `Rs. 5,000` → `Rs. 12,500` keeps its units column in
 * place, and only the characters that actually changed move. Widths stay tabular, so nothing
 * shifts while it happens.
 *
 * Accessibility and motion: the whole thing is `aria-hidden` behind one readable copy of the
 * final text, so a screen reader hears "Rs. 24,182" once, and `prefers-reduced-motion` removes the
 * movement (index.css).
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
  /** The figure itself. With `format`, it is formatted here and rolled the same way. */
  value?: number;
  format?: (value: number) => string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const label = text ?? (value != null && format ? format(Math.round(value)) : "");

  /**
   * The outgoing text is STATE, not a ref updated in an effect. With a ref, the very next
   * re-render of the page already saw the new value as "previous", so the outgoing digit left the
   * DOM a frame into its exit and the counter looked like it had simply repainted.
   */
  const [state, setState] = useState({ shown: label, previous: label, nonce: 0 });
  if (state.shown !== label) {
    setState({ shown: label, previous: state.shown, nonce: state.nonce + 1 });
  }

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
