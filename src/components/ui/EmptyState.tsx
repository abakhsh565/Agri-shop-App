interface EmptyStateProps {
  icon?: string;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon = "📭", title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <span className="text-4xl mb-4">{icon}</span>
      <p className="text-base font-bold text-black mb-1">{title}</p>
      {subtitle && <p className="text-sm text-[#888]">{subtitle}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 h-10 px-6 rounded-[100px] bg-black text-white text-sm font-bold"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
