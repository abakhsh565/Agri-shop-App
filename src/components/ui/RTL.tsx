import { useDir } from "@/lib/dirContext";
import { ReactNode } from "react";

/**
 * <FlexRow> — a flex-row that automatically reverses in RTL.
 *
 * Usage:
 *   <FlexRow gap={3} align="center">
 *     <Icon />
 *     <Text />
 *   </FlexRow>
 *
 * In LTR: Icon → Text
 * In RTL: Text ← Icon (icon stays on logical "start" side)
 */
export function FlexRow({
  children,
  gap = 3,
  align = "center",
  justify,
  className = "",
  style,
}: {
  children: ReactNode;
  gap?: number;
  align?: string;
  justify?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { isRtl } = useDir();
  return (
    <div
      className={`flex items-${align} ${justify ? `justify-${justify}` : ""} gap-${gap} ${className}`}
      style={{ direction: isRtl ? "rtl" : "ltr", ...style }}
    >
      {children}
    </div>
  );
}

/**
 * <ActionRow> — a full-width action row with icon on logical-start side.
 * Used for menu items, action buttons, etc.
 *
 * Usage:
 *   <ActionRow icon={<Pencil />} label="Edit Customer" onClick={...} />
 *
 * In LTR: [icon] Edit Customer [→]
 * In RTL: [←] گاہک میں ترمیم [icon]
 */
export function ActionRow({
  icon,
  label,
  trailing,
  onClick,
  color,
  className = "",
  style,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  onClick?: () => void;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-4 py-3.5 ${className}`}
      style={{
        borderBottom: "0.5px solid var(--divider)",
        color: color || "var(--text-primary)",
        ...style,
      }}
    >
      {icon}
      <span className="flex-1 text-start text-[14px]" style={{ color: color || "var(--text-primary)" }}>
        {label}
      </span>
      {trailing}
    </button>
  );
}

/**
 * <Chip> — a toggleable chip for multi-select (crops, filters, etc.).
 * Automatically handles selection state with brand colors.
 *
 * Usage:
 *   <Chip selected={isSelected} onClick={toggle}>
 *     Cotton
 *   </Chip>
 */
export function Chip({
  selected,
  onClick,
  children,
  className = "",
}: {
  selected: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 px-4 rounded-full text-[12px] font-medium transition-colors ${className}`}
      style={{
        background: selected ? "var(--brand)" : "var(--surface-2)",
        color: selected ? "#0a0a0a" : "var(--text-secondary)",
        border: selected ? "none" : "1px solid var(--divider)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * <StatCard> — a stat display card with label + value.
 * Label uses text-start, value uses text-end.
 *
 * Usage:
 *   <StatCard label="OUTSTANDING" value="Rs. 3,330" valueColor="#D97706" />
 */
export function StatCard({
  label,
  value,
  valueColor,
  className = "",
}: {
  label: string;
  value: string;
  valueColor?: string;
  className?: string;
}) {
  return (
    <div className={`flex-1 text-center py-3.5 ${className}`}>
      <p className="text-[10px] tracking-[0.5px] font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </p>
      <p className="text-[15px] font-bold mt-1" style={{ color: valueColor || "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

/**
 * <SectionLabel> — a small uppercase section label.
 * Always uses text-start for proper RTL alignment.
 *
 * Usage:
 *   <SectionLabel text="CREDIT LIMIT" />
 */
export function SectionLabel({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <p
      className={`text-[11px] font-bold uppercase tracking-wider text-start ${className}`}
      style={{ color: "var(--text-secondary)" }}
    >
      {text}
    </p>
  );
}

/**
 * <EmptyState> — centered empty state with icon, title, and subtitle.
 * All text is centered and works in both directions.
 */
export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      {icon}
      <p className="text-[15px] font-medium" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>
      <p className="text-[13px] max-w-[280px]" style={{ color: "var(--text-secondary)" }}>
        {subtitle}
      </p>
    </div>
  );
}
