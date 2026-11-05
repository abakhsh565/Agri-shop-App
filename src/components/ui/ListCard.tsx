import type { ReactNode } from "react";

interface ListCardProps {
  children: ReactNode;
  className?: string;
  /** Small uppercase label shown above the card, as on the reference board. */
  section?: string;
  /**
   * `card` (the default) is the resting surface: the rounded tone block a page of rows lives on.
   * `plain` keeps the row grammar — the same heights, insets and full-bleed hairlines — but draws
   * no surface, for a list that stands INSIDE a card that is already there. That is the one case
   * where a second block would show as a box inside a box; the separators stay this component's
   * business either way, so there is still exactly one rule drawing them.
   */
  variant?: "card" | "plain";
}

/**
 * The reference's grouped list: one rounded card on the card tone, with rows
 * separated by a hairline that starts after the leading slot.
 *
 * There is deliberately no border and no shadow — on the board a resting
 * surface is separated from the page by tone alone (page #f9faf7 → card
 * #f4f4f2 → hairline #f0f0ee), and the hairline insets live in the CSS layer
 * so every row inherits the same separator without prop drilling.
 */
export default function ListCard({ children, className = "", section, variant = "card" }: ListCardProps) {
  return (
    <div className={className}>
      {section && <p className="ds-section px-4 mb-2">{section}</p>}
      <div className={variant === "plain" ? "ds-listcard ds-listcard-plain" : "ds-listcard"}>{children}</div>
    </div>
  );
}
