import { useState, type ComponentType } from "react";
import { MoreVertical } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListRow from "@/components/ui/ListRow";
import { tNow } from "@/lib/i18n";

/**
 * The three dots on a detail screen's title bar.
 *
 * WHY IT EXISTS. A record's management actions — edit, stock, barcode, delete — were a card at the
 * bottom of the page, which meant the page had to be read to its end before anyone knew what could
 * be done to it, and the reader's own scroll position decided whether the actions were "there".
 * They now live behind the three dots beside the title, which is where a phone user already looks
 * for them, and the page keeps its body for the record itself (owner, 2026-11-17).
 *
 * A BOTTOM SHEET, NOT A DROPDOWN (owner, 2026-11-17). Every other three-dot control in the app —
 * the section screens' `SectionActionsSheet` — opens the same modal sheet from the bottom. A small
 * popover anchored under the title was the one screen pattern that behaved differently: it sat
 * under the thumb's own target, escaped the reachable half of the phone, and dismissed on a tap
 * that felt like it had landed on the row. Rows are `ListRow`s and the surface is `Sheet`, so the
 * height, insets, press state and dismissal (scrim, Escape, Android back) are the app's own.
 *
 * One implementation for every detail screen: product and customer (and whatever comes next)
 * cannot drift into three slightly different menus.
 */
export interface OverflowAction {
  icon: ComponentType<{ size?: number | string; style?: React.CSSProperties }>;
  label: string;
  onClick: () => void;
  /** Rendered in the error colour: deleting or archiving a record. */
  destructive?: boolean;
  disabled?: boolean;
  testId?: string;
}

export default function OverflowMenu({
  actions,
  label,
  title,
  testId,
}: {
  actions: OverflowAction[];
  /** Accessible name for the toggle; falls back to "More". */
  label?: string;
  /** The sheet's title — the record's own name, so the sheet says what it acts on. */
  title?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label ?? tNow("common.more")}
        aria-haspopup="dialog"
        data-testid={testId}
        // 44px of target around an 18px glyph, the same floor as the back arrow.
        className="flex items-center justify-center size-11 rounded-full active:opacity-60 transition-opacity -me-2.5"
        style={{ color: "var(--text-primary)" }}
      >
        <MoreVertical size={18} />
      </button>

      <Sheet open={open} title={title ?? label ?? tNow("common.more")} onClose={() => setOpen(false)} closeButton={false}>
        <div className="px-4 pt-1">
          {actions.map((action) => (
            <ListRow
              key={action.label}
              testId={action.testId}
              icon={action.icon as never}
              title={action.label}
              danger={action.destructive}
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
            />
          ))}
        </div>
      </Sheet>
    </>
  );
}
