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
  /**
   * Whether rows draw the hairline between them. Defaults to true. A flat menu that already
   * separates its actions with an icon, a label and a line of context can turn the rule off;
   * the decision still belongs to this component, so no screen draws its own separator.
   */
  separated?: boolean;
  /**
   * Draw a section rule above the label. Used when a screen's groups need an Instagram-style
   * band between them; it is a section separator, not a row separator, and stays here so the
   * page never draws its own list line.
   */
  sectionSeparator?: boolean;
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
export default function ListCard({
  children,
  className = "",
  section,
  variant = "card",
  separated = true,
  sectionSeparator = false,
}: ListCardProps) {
  const listClass = `${variant === "plain" ? "ds-listcard ds-listcard-plain" : "ds-listcard"}${separated ? "" : " ds-listcard-unseparated"}`;
  if (!sectionSeparator) {
    return (
      <div className={className}>
        {section && <p className="ds-section px-4 mb-2">{section}</p>}
        <div className={listClass}>{children}</div>
      </div>
    );
  }
  // A sectioned list is the one that must reach the page's edges with its band, so its own
  // wrapper is full width and the gutter moves inside: the label keeps its inset and the
  // list gets the same 16px either side it had when the whole section carried the margin.
  return (
    <div className={`ds-listcard-sectioned ${className}`}>
      {section && <p className="ds-section px-4 mb-2">{section}</p>}
      <div className="px-4">
        <div className={listClass}>{children}</div>
      </div>
    </div>
  );
}
