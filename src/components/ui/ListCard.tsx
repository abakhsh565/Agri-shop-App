import type { ReactNode } from "react";

interface ListCardProps {
  children: ReactNode;
  className?: string;
  /** Small uppercase label shown above the card, as on the reference board. */
  section?: string;
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
export default function ListCard({ children, className = "", section }: ListCardProps) {
  return (
    <div className={className}>
      {section && <p className="ds-section px-4 mb-2">{section}</p>}
      <div className="ds-listcard">{children}</div>
    </div>
  );
}
