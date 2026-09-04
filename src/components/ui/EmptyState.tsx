interface EmptyStateProps {
  icon?: string;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon = "📭", title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <span className="text-[40px] mb-3">{icon}</span>
      <p className="text-[15px] font-bold mb-1" style={{ color: "var(--text-primary)" }}>{title}</p>
      {subtitle && <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{subtitle}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 h-[42px] px-6 rounded-[12px] text-[13px] font-semibold"
          style={{ background: "#1a1a1a", color: "#fff" }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
