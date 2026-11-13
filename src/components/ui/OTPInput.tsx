import { useRef, type KeyboardEvent, type ClipboardEvent } from "react";

interface OTPInputProps {
  value: string;
  onChange: (val: string) => void;
  length?: number;
  disabled?: boolean;
  error?: boolean;
}

export default function OTPInput({ value, onChange, length = 6, disabled, error }: OTPInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(length, "").split("").slice(0, length);

  function handleChange(idx: number, ch: string) {
    if (!/^\d$/.test(ch)) return;
    const arr = digits.map((d) => d.trim());
    arr[idx] = ch;
    const next = arr.join("").slice(0, length);
    onChange(next);
    if (idx < length - 1) refs.current[idx + 1]?.focus();
  }

  function handleKey(idx: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const arr = digits.slice();
      if (arr[idx]) {
        arr[idx] = "";
        onChange(arr.join(""));
      } else if (idx > 0) {
        arr[idx - 1] = "";
        onChange(arr.join(""));
        refs.current[idx - 1]?.focus();
      }
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    onChange(pasted);
    const focusIdx = Math.min(pasted.length, length - 1);
    refs.current[focusIdx]?.focus();
  }

  return (
    /* The row is sized by `.ds-otp-row`/`.ds-otp-box` so six boxes and five gaps fit the
       narrowest phone in one line, and so the whole screen still clears a keyboard that is
       eating a third of the height. The box shrinks; the type inside stays on the ramp. */
    <div className="ds-otp-row">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          autoFocus={i === 0}
          value={digits[i] || ""}
          disabled={disabled}
          data-testid={`otp-digit-${i}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          /* Tokens, not literals. These boxes once read the legacy literal classes for
             white/black, which the old compatibility layer remapped onto `--border` — the
             in-card hairline — so a box had no discernible edge in either theme. They now
             name the tokens directly: `--surface` for the fill, `--border-control` for the
             outline that actually reads as a field edge in light AND dark. */
          /* No inline border: the field contract supplies the resting edge and the focus
             colour. Only the error state names a colour, and it does so as a class so a
             focused box can still turn brand green. */
          className={`ds-otp-box text-center font-semibold rounded-[var(--radius-tile)] outline-none focus:ring-2 disabled:opacity-40 ${
            error ? "border-[#ef4444]" : ""
          }`}
          style={{
            background: "var(--surface)",
            color: "var(--text-primary)",
            // The focus ring follows the theme's own ring token instead of a fixed black,
            // which is invisible on a dark field.
            boxShadow: "none",
            outlineColor: "var(--ring)",
          }}
        />
      ))}
      {/* Off-screen target for OTP auto-detection (Web OTP API / SMS autofill).
          Deliberately AFTER the digit boxes: when it came first in the DOM, the
          first text field on screen was an invisible one, so anything that
          addressed the fields in order put the first digit where nobody could
          see it — the visible row then read "23456" while the person believed
          they had typed "123456", and nothing submitted. */}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-hidden="true"
        data-testid="otp-autofill"
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
        tabIndex={-1}
      />
    </div>
  );
}
