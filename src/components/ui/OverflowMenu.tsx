import { useState, type ComponentType } from "react";
import { MoreVertical } from "lucide-react";
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
 * One implementation for every screen: the toggle, the dismissal surface, the placement and the
 * divider between rows are decided here, so product and customer (and whatever comes next) cannot
 * drift into three slightly different menus.
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
  testId,
}: {
  actions: OverflowAction[];
  /** Accessible name for the toggle; falls back to "More". */
  label?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label ?? tNow("common.more")}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid={testId}
        // 44px of target around an 18px glyph, the same floor as the back arrow.
        className="flex items-center justify-center size-11 rounded-full active:opacity-60 transition-opacity -me-2.5"
        style={{ color: "var(--text-primary)" }}
      >
        <MoreVertical size={18} />
      </button>

      {open && (
        <>
          {/* Tap anywhere else, including the page behind, to dismiss. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute z-50 mt-1 min-w-[196px] rounded-[var(--radius-card)] overflow-hidden"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--divider)",
              boxShadow: "0 12px 32px rgb(0 0 0 / 0.28)",
              // Logical: the menu opens inward from the trailing edge in both directions.
              insetInlineEnd: 0,
            }}
          >
            {actions.map((action, index) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  data-testid={action.testId}
                  onClick={() => {
                    setOpen(false);
                    action.onClick();
                  }}
                  className="w-full flex items-center gap-3 px-4 h-12 text-start active:opacity-60 transition-opacity disabled:opacity-50"
                  style={{
                    borderTop: index === 0 ? undefined : "1px solid var(--divider)",
                    color: action.destructive ? "var(--error)" : "var(--text-primary)",
                  }}
                >
                  <Icon size={16} />
                  <span className="text-13 font-semibold">{action.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
