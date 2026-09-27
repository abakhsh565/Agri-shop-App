import { Check, Minus } from "lucide-react";

interface CheckboxProps {
  checked: boolean;
  /**
   * Some but not all of what this box stands for. A group header whose children are partly
   * granted says so instead of lying in either direction — the whole point of the header box
   * is to tell the owner "there is something in here", not just yes or no.
   */
  mixed?: boolean;
  disabled?: boolean;
  /** Drawn inside the box at small sizes; the caller usually renders its own label. */
  size?: number;
}

/**
 * A square checkbox, in the app's own tones.
 *
 * It exists because the design had no checkbox at all: every binary choice so far was a
 * chip or a switch. A permission list needs the thing people already know — a box you tick,
 * one per item, aligned in a column — because the alternative (tap a chip to grant, tap a
 * coloured chip to see it is an exception) required reading a legend before making a
 * decision.
 *
 * Presentation only: the label and the click target belong to the row that contains it, so
 * the whole row is the button and this draws the box. `aria-hidden` here, because the row
 * carries the real `role="checkbox"` and its state — a nested labelled control would be
 * announced twice.
 */
export default function Checkbox({ checked, mixed = false, disabled = false, size = 16 }: CheckboxProps) {
  const on = checked || mixed;
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center shrink-0 transition-colors"
      style={{
        width: 20,
        height: 20,
        borderRadius: 6,
        background: on ? "var(--brand)" : "transparent",
        border: `1.5px solid ${on ? "var(--brand)" : "var(--divider)"}`,
        color: "#0a0a0a",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {mixed ? (
        <Minus size={size - 2} strokeWidth={3} />
      ) : checked ? (
        <Check size={size - 2} strokeWidth={3} />
      ) : null}
    </span>
  );
}
