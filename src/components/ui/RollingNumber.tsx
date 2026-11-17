import { useState } from "react";

/**
 * A figure that rolls to its next value instead of swapping.
 *
 * WHY IT EXISTS. The reference's "rolling counter" is the one micro-interaction every number in
 * this app can use: a shopkeeper taps + or changes Today → Yesterday and the money should look
 * like it moved, not like a different string appeared. Because only the characters that changed
 * are animated, a tick in the last digit moves one column while the rest of the number stands
 * still — which is what makes it read as counting rather than as flickering.
 *
 * WHAT IT ANIMATES, AND WHAT IT DOES NOT. Digits only. A currency prefix, a thousands comma, a
 * minus sign and the `—` of "no figure yet" are drawn as they are: sliding "Rs." upward would be
 * decoration, and sliding the dash would suggest a value that is not there.
 *
 * `text` is already-formatted output (the app's own `formatCurrency`/`formatRs`), so the component
 * never invents a number or a currency. The whole thing is `aria-hidden` behind one readable copy
 * of the same text, so a screen reader hears "Rs. 24,182" once, not once per digit column.
 *
 * Turning the animation off needs no prop: `.nr-*` stops under `prefers-reduced-motion`, and the
 * outgoing digit is hidden rather than left on top of the new one.
 */
export default function RollingNumber({
  text,
  className,
  style,
}: {
  /** The formatted figure, e.g. `formatCurrency(4500)` → "Rs. 4,500". */
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  /**
   * The outgoing figure is STATE, not a ref updated in an effect. With a ref, the very next
   * re-render of the page (and a dashboard re-renders several times after a tab is tapped) already
   * saw the new value as "previous", so the outgoing digit was removed from the DOM a frame into
   * its 340ms exit and the counter looked like it had simply repainted.
   *
   * Adjusting state during render is what React documents for exactly this: the same commit then
   * carries both the old digit (leaving) and the new one (arriving), and later renders keep them.
   */
  const [state, setState] = useState({ shown: text, previous: text, nonce: 0 });
  if (state.shown !== text) {
    setState({ shown: text, previous: state.shown, nonce: state.nonce + 1 });
  }

  // Digits are matched from the RIGHT, because that is where a figure grows and shrinks: Rs. 5,000
  // → Rs. 12,500 keeps its units column in place, and animating that column is the point of a
  // counter. Leading characters with nothing opposite them are simply drawn.
  const before = state.shown === text ? state.previous : state.shown;
  const shift = text.length - before.length;

  return (
    <span className={className} style={style}>
      <span className="sr-only">{text}</span>
      <span className="nr" aria-hidden="true">
        {Array.from(text).map((char, i) => {
          const wasIndex = i - shift;
          const was = wasIndex >= 0 && wasIndex < before.length ? before[wasIndex] : char;
          const animate = was !== char && /\d/.test(char) && /\d/.test(was);
          if (!animate) {
            // No `nr-tick` at all: a still character must not carry an animation it then has to
            // switch off inline.
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
