import { MoreHorizontal, type LucideIcon } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListRow from "@/components/ui/ListRow";

export interface SectionAction {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  onClick: () => void;
}

interface SectionActionsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Sheet title — the screen's own name, so the sheet always says where it came from. */
  title: string;
  actions: SectionAction[];
}

/**
 * The overflow, as one sheet, for every section screen.
 *
 * ONE COMPONENT because the same three things are asked of it everywhere — take the data out,
 * send a summary, and the one or two actions this screen owns — and because a menu that repeats
 * what is already visible on the screen is a menu nobody reads. Rows are `ListRow`s, so the sheet
 * has the same height, insets and icons as Settings, the customer hub and the sales overflow.
 */
export default function SectionActionsSheet({ open, onClose, title, actions }: SectionActionsSheetProps) {
  return (
    <Sheet open={open} title={title} onClose={onClose} closeButton={false}>
      <div className="px-4 pt-1">
        {actions.map((action) => (
          <ListRow
            key={action.id}
            testId={`section-action-${action.id}`}
            icon={action.icon}
            title={action.title}
            description={action.description}
            onClick={action.onClick}
          />
        ))}
      </div>
    </Sheet>
  );
}

/** The app bar's right-hand control. Same size, radius and press opacity as every other one. */
export function SectionActionsButton({
  onClick,
  label,
  testId,
}: {
  onClick: () => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-haspopup="dialog"
      data-testid={testId}
      className="flex items-center justify-center size-8 rounded-full active:opacity-60"
    >
      <MoreHorizontal size={20} style={{ color: "var(--text-primary)" }} />
    </button>
  );
}
