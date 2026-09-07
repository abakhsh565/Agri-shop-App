import { Trash2 } from "lucide-react";
import { useState, useCallback } from "react";

interface QuantityCounterProps {
  qty: number;
  onChange: (qty: number) => void;
  max?: number;
  step?: number;
  deleteOnOne?: boolean;
  onDelete?: () => void;
  size?: "sm" | "md";
}

function clampAndRound(value: number, min: number, max: number | undefined, step: number): number {
  const rounded = Math.round(value / step) * step;
  const clamped = Math.max(min, max ? Math.min(rounded, max) : rounded);
  return Math.round(clamped * 1000) / 1000; // avoid floating point drift
}

export default function QuantityCounter({
  qty,
  onChange,
  max,
  step = 1,
  deleteOnOne = false,
  onDelete,
  size = "md",
}: QuantityCounterProps) {
  const isSmall = size === "sm";
  const minQty = step;
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
      const next = Math.round((qty + step) * 1000) / 1000;
      onChange(max ? Math.min(next, max) : next);
    }
  }

  const btnSize = isSmall ? "w-8 h-8 text-sm" : "w-9 h-9 text-base";

  // Format qty display: show decimals only if step < 1
  const displayQty = step < 1
    ? qty.toFixed(step <= 0.25 ? 2 : 1).replace(/\.?0+$/, "")
    : String(Math.round(qty));

  const inputWidth = isSmall ? "w-12" : "w-14";

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={decrement}
        className={`
          ${btnSize} rounded-full flex items-center justify-center shrink-0 transition-colors
          ${qty <= minQty && deleteOnOne
            ? "bg-[#ef4444] text-white"
            : "bg-[#f5f5f5] text-black"
          }
        `}
      >
        {qty <= minQty && deleteOnOne ? (
          <Trash2 size={isSmall ? 12 : 14} />
        ) : (
          <span className="font-bold leading-none">−</span>
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
          className={`${inputWidth} text-center font-bold text-black bg-white border border-gray-300 rounded-lg outline-none focus:border-[var(--brand)] ${isSmall ? "text-base" : "text-lg"}`}
        />
      ) : (
        <button
          type="button"
          onClick={() => { setIsFocused(true); setInputValue(""); }}
          className={`${inputWidth} text-center font-bold text-black bg-transparent border border-transparent rounded-lg hover:border-gray-200 ${isSmall ? "text-base min-w-[2.5rem]" : "text-lg min-w-[3rem]"}`}
        >
          {displayQty}
        </button>
      )}

      <button
        type="button"
        onClick={increment}
        disabled={!!max && qty >= max}
        className={`
          ${btnSize} rounded-full bg-black text-white flex items-center justify-center shrink-0
          disabled:opacity-30
        `}
      >
        <span className="font-bold leading-none">+</span>
      </button>
    </div>
  );
}
