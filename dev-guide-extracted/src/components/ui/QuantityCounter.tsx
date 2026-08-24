import { Trash2 } from "lucide-react";

interface QuantityCounterProps {
  qty: number;
  onChange: (qty: number) => void;
  max?: number;
  deleteOnOne?: boolean;
  onDelete?: () => void;
  size?: "sm" | "md";
}

export default function QuantityCounter({
  qty,
  onChange,
  max,
  deleteOnOne = false,
  onDelete,
  size = "md",
}: QuantityCounterProps) {
  const isSmall = size === "sm";

  function decrement() {
    if (qty <= 1 && deleteOnOne) {
      onDelete?.();
      return;
    }
    if (qty > 1) onChange(qty - 1);
  }

  const btnSize = isSmall ? "w-8 h-8 text-sm" : "w-9 h-9 text-base";

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={decrement}
        className={`
          ${btnSize} rounded-full flex items-center justify-center shrink-0 transition-colors
          ${qty <= 1 && deleteOnOne
            ? "bg-[#ef4444] text-white"
            : "bg-[#f5f5f5] text-black"
          }
        `}
      >
        {qty <= 1 && deleteOnOne ? (
          <Trash2 size={isSmall ? 12 : 14} />
        ) : (
          <span className="font-bold leading-none">−</span>
        )}
      </button>

      <span className={`font-bold text-black ${isSmall ? "text-base w-5" : "text-lg w-6"} text-center`}>
        {qty}
      </span>

      <button
        type="button"
        onClick={() => (!max || qty < max) && onChange(qty + 1)}
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
