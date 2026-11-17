import { Trash2 } from "lucide-react";
import { useState, useCallback } from "react";
import { tNow } from "@/lib/i18n";
import RollingNumber from "@/components/ui/RollingNumber";

interface QuantityCounterProps {
  qty: number;
  onChange: (qty: number) => void;
  max?: number;
  step?: number;
  /**
   * The lowest number the counter may hold. Defaults to one step, because a cart line that reaches
   * zero is a removed line rather than a line with nothing on it. The product page stages several
   * packs at once and needs the opposite: a variant nobody has picked yet is a real, visible 0.
   */
  min?: number;
  deleteOnOne?: boolean;
  onDelete?: () => void;
  size?: "sm" | "md";
  /**
   * The reference's standalone control: its own hairline box, 4px inset, minus and plus at the two
   * ends. On for a stepper that stands alone under a "Quantity" label (the product page); off inside
   * a row that already has an edge (a cart line, a return line).
   */
  boxed?: boolean;
}

function clampAndRound(value: number, min: number, max: number | undefined, step: number): number {
  const rounded = Math.round(value / step) * step;
  const clamped = Math.max(min, max ? Math.min(rounded, max) : rounded);
  return Math.round(clamped * 1000) / 1000; // avoid floating point drift
}

/** 3 → "3", 1.5 → "1.5", 0.25 → "0.25" — decimals only when the unit has them. */
function formatQty(value: number, step: number): string {
  if (step >= 1) return String(Math.round(value));
  const fixed = value.toFixed(step <= 0.25 ? 2 : 1);
  return fixed.replace(/\.?0+$/, "");
}

export default function QuantityCounter({
  qty,
  onChange,
  max,
  step = 1,
  min,
  deleteOnOne = false,
  onDelete,
  size = "md",
  boxed = false,
}: QuantityCounterProps) {
  const isSmall = size === "sm";
  const minQty = min ?? step;
  const [inputValue, setInputValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const commitInput = useCallback(() => {
    if (inputValue === "") {
      setIsFocused(false);
      return;
    }
    const parsed = parseFloat(inputValue);
    if (!isNaN(parsed) && parsed >= minQty) {
      onChange(clampAndRound(parsed, minQty, max, step));
    }
    setInputValue("");
    setIsFocused(false);
  }, [inputValue, minQty, max, step, onChange]);

  function decrement() {
    if (qty <= minQty && deleteOnOne) {
      onDelete?.();
      return;
    }
    if (qty > minQty) {
      const next = Math.round((qty - step) * 1000) / 1000;
      onChange(Math.max(minQty, next));
    }
  }

  function increment() {
    if (!max || qty < max) {
      const next = Math.round((Math.max(qty, minQty) + step) * 1000) / 1000;
      onChange(max ? Math.min(next, max) : next);
    }
  }

  const removing = qty <= minQty && deleteOnOne;

  /**
   * The two ends are deliberately different weights, as in the reference: minus is a raised grey
   * disc on the surface, plus is the page's ink disc — the one control that ADDS is the one that
   * reads as a control. `--ink`/`--ink-fg` invert per theme, so the plus is white-on-dark here and
   * black-on-light in the light theme, and it is never invisible.
   */
  const btn = isSmall ? "size-9" : "size-10";
  const glyph = isSmall ? 14 : 16;

  return (
    <div
      className={
        boxed
          ? "flex items-center gap-2 w-full h-[52px] px-1.5 rounded-[14px]"
          : "flex items-center gap-2"
      }
      style={boxed ? { border: "1px solid var(--divider)" } : undefined}
    >
      <button
        type="button"
        onClick={decrement}
        disabled={qty <= minQty && !deleteOnOne}
        // Icon-only (a minus, or a bin at the minimum): with no name a screen reader
        // announces an unlabelled button.
        aria-label={removing ? tNow("common.remove") : tNow("common.decrease")}
        className={`${btn} rounded-full flex items-center justify-center shrink-0 ds-pressable transition-colors disabled:opacity-30`}
        style={
          removing
            ? { background: "var(--error)", color: "#ffffff" }
            : { background: "var(--surface-2)", color: "var(--text-primary)" }
        }
      >
        {removing ? (
          <Trash2 size={glyph - 2} />
        ) : (
          <span className="font-semibold leading-none" style={{ fontSize: glyph }}>
            −
          </span>
        )}
      </button>

      {isFocused ? (
        <input
          type="number"
          inputMode="numeric"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={commitInput}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitInput();
            }
          }}
          min={minQty}
          max={max}
          step={step}
          autoFocus
          className={`${boxed ? "flex-1" : isSmall ? "w-12" : "w-14"} h-12 text-center font-bold text-foreground bg-card rounded-[var(--radius-tile)] outline-none ${isSmall ? "text-base" : "text-lg"}`}
          style={{ border: "1.5px solid var(--brand)" }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setIsFocused(true);
            setInputValue("");
          }}
          className={`${boxed ? "flex-1" : isSmall ? "w-12" : "w-14"} h-12 text-center font-bold text-foreground bg-transparent rounded-[var(--radius-tile)] ${isSmall ? "text-base" : "text-16"}`}
        >
          {/* The reference's rolling counter: + and − move the digit rather than repaint it. A
              digit roll, not a count-up — one step of a stepper must land immediately, so only the
              characters that changed move, over 340ms. */}
          <RollingNumber text={formatQty(qty, step)} className="justify-center" />
        </button>
      )}

      <button
        type="button"
        onClick={increment}
        disabled={!!max && qty >= max}
        aria-label={tNow("common.increase")}
        className={`${btn} rounded-full flex items-center justify-center shrink-0 ds-pressable disabled:opacity-30`}
        style={{ background: "var(--ink)", color: "var(--ink-fg)" }}
      >
        <span className="font-semibold leading-none" style={{ fontSize: glyph }}>
          +
        </span>
      </button>
    </div>
  );
}
