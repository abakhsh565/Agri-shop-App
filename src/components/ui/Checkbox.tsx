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
 *
 * The empty box is drawn from `--text-secondary`, not from the field-edge token. A checkbox
 * has to be findable on whatever it happens to sit on, and in Roles & Access that is the
 * sheet's inset block (`--tone-sunken`) — a tone the field token was never measured against.
 * `--border-control` there is a delta of ~19/255, which on a 20px square reads as no control
 * at all, in light and in dark alike. `--text-secondary` is a text tone in both themes, so it
 * carries real contrast on the page, on a card, and inside the block, and it stays a token:
 * nothing here hardcodes a colour. The ticked box is unchanged — brand fill, and the same 2px
 * so toggling a box does not shift its edge.
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
        // 2px, and the text tone while empty: the box is the control, so it has to be the
        // most findable thing in the row before anything is ticked.
        border: `2px solid ${on ? "var(--brand)" : "var(--text-secondary)"}`,
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
