import { ChevronRight, type LucideIcon } from "lucide-react";
import ListRow from "@/components/ui/ListRow";

/**
 * One pack of stock, as the inventory screens list it.
 *
 * THREE SCREENS, ONE ROW. Stock management, Stock alerts and Expiry alerts all list the same
 * thing — a pack on this branch's shelf — and each of them used to be a slightly different row:
 * one showed the product's total, one showed a threshold, one showed a date in the description
 * slot where the colour lives. A reader moving between them had to re-read the same row three
 * times. This is that row, once: what the thing is, which pack and how much of it, the one line
 * that decides anything about it right now (a branch, a date), and its state on the trailing
 * side where state belongs.
 *
 * It is built on `ListRow`, so the skeleton — height, insets, separator, press state — stays the
 * app's, and it is a `children` row exactly as the products list is, because the state line is
 * the one thing the primitive's `description` slot cannot tint.
 */
export default function StockRow({
  icon,
  title,
  line,
  note,
  statusLabel,
  statusColor,
  testId,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  /** Pack and quantity: "1 L bottle · 24 liters". */
  line: string;
  /** The deciding line, when there is one: the branch, or the pack's date. */
  note?: string;
  statusLabel: string;
  statusColor: string;
  testId?: string;
  onClick?: () => void;
}) {
  return (
    <ListRow
      testId={testId}
      icon={icon}
      onClick={onClick}
      trailing={
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-10 font-bold whitespace-nowrap" style={{ color: statusColor }}>
            {statusLabel}
          </span>
          <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
        </div>
      }
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-13 font-bold truncate" style={{ color: "var(--text-primary)" }}>
          {title}
        </p>
        <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
          {line}
        </p>
        {note && (
          <p className="text-11 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {note}
          </p>
        )}
      </div>
    </ListRow>
  );
}
