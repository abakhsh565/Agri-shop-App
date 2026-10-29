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
          // The app's one field shape: fully rounded, field-washed, edged at rest, green when it
          // has focus. The edge is what says "you can type here" before anything is touched, and
          // it comes from `--field-border` so it matches every other field on every other screen.
          className={`
            h-12 w-full rounded-[var(--radius-field)] px-4 text-13 font-normal
            placeholder:text-[var(--text-tertiary)] outline-none transition-colors
            ${error ? "border border-[var(--error)] focus:ring-2 focus:ring-[var(--error-border)]" : "border border-[var(--field-border)] focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-light)]"}
            disabled:opacity-45 disabled:cursor-not-allowed
            ${className}
          `}
          // The fill comes from the local field pair, so the same component sits correctly on a
          // page, a card or a sheet without the caller choosing a colour for it.
          style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
        />
        {error && <span className="text-xs text-[var(--error)]">{error}</span>}
        {hint && !error && <span className="text-xs text-caption">{hint}</span>}
      </div>
    );
  }
);
Input.displayName = "Input";
export default Input;
