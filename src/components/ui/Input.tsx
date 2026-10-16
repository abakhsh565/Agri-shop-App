import { forwardRef, type ChangeEvent, type InputHTMLAttributes } from "react";
import { digitsOnlyPhone } from "@/lib/phoneInput";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = "", onChange, ...props }, ref) => {
    /**
     * A phone field takes a phone number: digits only, eleven at most, in every screen.
     *
     * The rule lives here rather than in each caller because it was forgotten in most of them —
     * three screens stripped letters and none capped the length. Applying it at the field means a
     * screen cannot get it wrong, and the value the caller's `onChange` receives is already the
     * one that belongs in the field.
     */
    const isPhone = props.type === "tel";
    const handleChange = isPhone
      ? (event: ChangeEvent<HTMLInputElement>) => {
          event.target.value = digitsOnlyPhone(event.target.value);
          onChange?.(event);
        }
      : onChange;

    return (
      <div className="flex flex-col gap-2 w-full">
        {label && (
          <span className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>{label}</span>
        )}
        <input
          ref={ref}
          {...props}
          onChange={handleChange}
          {...(isPhone ? { inputMode: "numeric" as const, autoComplete: props.autoComplete ?? "tel" } : null)}
          className={`
            h-[46px] w-full rounded-[var(--radius-card)] border px-4 text-13 font-normal
            placeholder:text-[#aaa] outline-none transition-colors
            ${error ? "border-[#ef4444] focus:ring-2 focus:ring-[#ef4444]/20" : "border-[var(--border-control)] focus:border-[var(--text-secondary)] focus:ring-2 focus:ring-[var(--ring)]"}
            disabled:opacity-40 disabled:cursor-not-allowed
            ${className}
          `}
          style={{ background: "var(--surface)", color: "var(--text-primary)" }}
        />
        {error && <span className="text-xs text-[#ef4444]">{error}</span>}
        {hint && !error && <span className="text-xs text-caption">{hint}</span>}
      </div>
    );
  }
);
Input.displayName = "Input";
export default Input;
