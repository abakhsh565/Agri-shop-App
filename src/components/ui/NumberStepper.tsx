import { useEffect, useRef, useState } from "react";
import { tNow } from "@/lib/i18n";

interface NumberStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** `sm` for a field that sits inside a sheet row; `md` for a standalone control. */
  size?: "sm" | "md";
  /** Width of the whole plate. A count needs less room than a quantity. */
  width?: number | string;
  /** The number the field holds, e.g. "Days" or "Reminders" — read by a screen reader. */
  ariaLabel?: string;
  /** Test handle for the input itself, so a lane can still type a value directly. */
  inputTestId?: string;
  disabled?: boolean;
}

/**
 * A number that is stepped, not spun.
 *
 * The browser's own number field brings two 8px arrows painted in the platform's colours, they
 * sit on top of the value on a phone, and they cannot be styled. This is the app's own control:
 * one rounded plate, a minus key, the number, a plus key — the same shape the quantity counter
 * uses in the cart, small enough to sit in a reminder row beside its label.
 *
 * The number is an ordinary text box with a numeric keyboard, so it is still typed directly
 * (a shopkeeper who knows the number should not have to tap a plus fifteen times), and the
 * step buttons move it by one, clamped to the field's own floor and ceiling.
 *
 * Sizes are deliberately not fixed: `width` lets a two-digit day count stay compact while a
 * stock threshold gets the room its three digits need.
 */
export default function NumberStepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  size = "sm",
  width = 116,
  ariaLabel,
  inputTestId,
  disabled = false,
}: NumberStepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A value changed from outside (a form reset, a schedule loaded) is what the field shows.
    if (draft !== null && document.activeElement !== inputRef.current) setDraft(null);
  }, [value, draft]);

  const clamp = (n: number) => {
    const stepped = Math.round(n / step) * step;
    const floor = Math.max(min, stepped);
    return Math.round((max != null ? Math.min(floor, max) : floor) * 1000) / 1000;
  };

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
    setDraft(null);
  };

  const height = size === "sm" ? 40 : 44;
  const key = size === "sm" ? 32 : 36;

  return (
    <div
      className="inline-flex items-center shrink-0 rounded-[var(--radius-tile)] p-0.5"
      style={{ background: "var(--surface-2)", height, width }}
      data-testid={inputTestId ? `${inputTestId}-stepper` : undefined}
    >
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        disabled={disabled || value <= min}
        aria-label={tNow("common.decrease")}
        className="flex items-center justify-center shrink-0 rounded-[10px] ds-pressable disabled:opacity-30"
        style={{ height: key, width: key, background: "var(--background)", color: "var(--text-primary)" }}
      >
        <span className="font-semibold leading-none" style={{ fontSize: 16 }}>−</span>
      </button>

      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
        onFocus={() => { setDraft(String(value)); requestAnimationFrame(() => inputRef.current?.select()); }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLInputElement).value); }
          if (e.key === "ArrowUp") { e.preventDefault(); onChange(clamp(value + step)); setDraft(null); }
          if (e.key === "ArrowDown") { e.preventDefault(); onChange(clamp(value - step)); setDraft(null); }
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={inputTestId}
        className="flex-1 min-w-0 h-full bg-transparent text-center font-semibold outline-none tabular-nums"
        style={{ color: "var(--text-primary)", fontSize: 15, border: "none", height: "100%" }}
      />

      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        disabled={disabled || (max != null && value >= max)}
        aria-label={tNow("common.increase")}
        className="flex items-center justify-center shrink-0 rounded-[10px] ds-pressable disabled:opacity-30"
        style={{ height: key, width: key, background: "var(--background)", color: "var(--text-primary)" }}
      >
        <span className="font-semibold leading-none" style={{ fontSize: 16 }}>+</span>
      </button>
    </div>
  );
}
