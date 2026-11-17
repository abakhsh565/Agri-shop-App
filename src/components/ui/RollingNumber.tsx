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
 * ON ARRIVAL. A figure that is already correct on the first paint had nothing to animate, which is
 * why the home card's total moved (its data landed a tick later) while net profit and credit sat
 * still. On arrival the previous value is seeded with the same figure zeroed, so every amount rolls
 * up from zeros to what it really is as the screen appears — ON by default since the owner asked
 * for the motion on every screen, and switchable off with `animateOnMount={false}` where a list of
 * figures would read as noise.
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
  animateOnMount = true,
}: {
  /** The formatted figure, for a value that only exists as a string. */
  text?: string;
  /** The figure itself. With `format`, it is formatted here and rolled the same way. */
  value?: number;
  format?: (value: number) => string;
  className?: string;
  style?: React.CSSProperties;
  /** Roll the first figure in from zeros instead of showing it already settled. */
  animateOnMount?: boolean;
}) {
  const label = text ?? (value != null && format ? format(Math.round(value)) : "");
  // Same length and same punctuation, every digit zeroed: the roll then only moves digits.
  const seed = animateOnMount ? label.replace(/\d/g, "0") : label;

  /**
   * The outgoing text is STATE, not a ref updated in an effect. With a ref, the very next
   * re-render of the page already saw the new value as "previous", so the outgoing digit left the
   * DOM a frame into its exit and the counter looked like it had simply repainted.
   */
  const [state, setState] = useState({ shown: label, previous: seed, nonce: 0 });
  if (state.shown !== label) {
    setState({ shown: label, previous: state.shown, nonce: state.nonce + 1 });
  }

  const before = state.shown === label ? state.previous : state.shown;
  /**
   * Align the two strings from the RIGHT — the units column is what a money figure agrees on, and
   * it is what the old left-edge alignment got wrong. A figure that gains digits (Rs. 0 →
   * Rs. 159,250, or a month that adds a zero) has no counterpart for its new leading digits, so
   * those compare against "0" and roll in instead of appearing already painted. Without this the
   * card's total swapped silently while the profit beside it rolled.
   */
  const offset = before.length - label.length;

  return (
    <span className={className} style={style}>
      <span className="sr-only">{label}</span>
      <span className="nr" aria-hidden="true">
        {Array.from(label).map((char, i) => {
          const wasIndex = i + offset;
          const peer = wasIndex >= 0 && wasIndex < before.length ? before[wasIndex] : undefined;
          const was = peer != null && /\d/.test(peer) ? peer : /\d/.test(char) ? "0" : char;
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
