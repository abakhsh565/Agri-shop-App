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
          <span className="text-xs font-bold text-black uppercase tracking-wide">{label}</span>
        )}
        <input
          ref={ref}
          {...props}
          className={`
            h-12 w-full rounded-[24px] border px-4 text-sm font-normal bg-white
            placeholder:text-[#888] text-black outline-none
            ${error ? "border-[#ef4444]" : "border-black"}
            focus:ring-2 focus:ring-black/20
            disabled:opacity-40 disabled:cursor-not-allowed
            ${className}
          `}
        />
        {error && <span className="text-xs text-[#ef4444]">{error}</span>}
        {hint && !error && <span className="text-xs text-[#888]">{hint}</span>}
      </div>
    );
  }
);
Input.displayName = "Input";
export default Input;
