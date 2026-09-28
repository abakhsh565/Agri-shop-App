import { type ReactNode } from "react";

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  type?: "button" | "submit";
  className?: string;
  /**
   * Stable handle for the test lanes, rendered as `data-testid`.
   *
   * A `data-testid` written directly on `<Button …>` looks like it works and does not: React
   * only forwards attributes this component actually spreads, and TypeScript permits a
   * hyphenated attribute on a component without checking it — so the attribute compiles,
   * renders nothing, and the lane that looks for it fails with "element not found" while the
   * screen shows the button. Same reason `ListRow` takes `testId`.
   */
  testId?: string;
}

export default function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  loading,
  fullWidth,
  type = "button",
  className = "",
  testId,
}: ButtonProps) {
  // `ds-pressable` gives every button in the app the same press: a small scale
  // and dim on transform/opacity, which stay on the compositor.
  const base = "inline-flex items-center justify-center rounded-full font-bold ds-pressable select-none";

  const variants = {
    primary: "bg-ink text-ink-fg",
    outline: "bg-card border border-border-control text-foreground",
    ghost: "bg-transparent text-foreground",
    danger: "bg-[#ef4444] text-white",
  };

  const sizes = {
    sm: "h-9 px-4 text-xs",
    md: "h-12 px-6 text-sm",
    lg: "h-[52px] px-6 text-sm",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      data-testid={testId}
      disabled={disabled || loading}
      className={`
        ${base} ${variants[variant]} ${sizes[size]}
        ${fullWidth ? "w-full" : ""}
        ${disabled || loading ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
        ${className}
      `}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
          </svg>
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
