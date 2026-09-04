import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = "", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-2 w-full">
        {label && (
          <span className="text-[11px] font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>{label}</span>
        )}
        <input
          ref={ref}
          {...props}
          className={`
            h-[46px] w-full rounded-[14px] border px-4 text-[13px] font-normal
            placeholder:text-[#aaa] outline-none transition-colors
            ${error ? "border-[#ef4444] focus:ring-2 focus:ring-[#ef4444]/20" : "border-[var(--divider)] focus:border-[var(--text-secondary)] focus:ring-2 focus:ring-[var(--ring)]"}
            disabled:opacity-40 disabled:cursor-not-allowed
            ${className}
          `}
          style={{ background: "var(--surface)", color: "var(--text-primary)" }}
        />
        {error && <span className="text-xs text-[#ef4444]">{error}</span>}
        {hint && !error && <span className="text-xs text-[#888]">{hint}</span>}
      </div>
    );
  }
);
Input.displayName = "Input";
export default Input;
