import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  /** A lucide icon. The reference marks an empty state with a small monochrome
   *  glyph, never a colour emoji, so the caller passes the icon itself. */
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon: Icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <Icon
        size={28}
        style={{ color: "var(--text-tertiary)" }}
        className="mb-3"
      />
      <p className="ds-body" style={{ fontWeight: "var(--weight-strong)" }}>{title}</p>
      {subtitle && <p className="ds-meta mt-1">{subtitle}</p>}
      {action && (
        <button type="button" onClick={action.onClick} className="ds-pill mt-4">
          {action.label}
        </button>
      )}
    </div>
  );
}
