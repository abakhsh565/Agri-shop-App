interface PINInputProps {
  value: string;
  onChange: (val: string) => void;
  error?: boolean;
  shake?: boolean;
}

const PAD = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

export default function PINInput({ value, onChange, error, shake }: PINInputProps) {
  function tap(key: string) {
    if (key === "⌫") {
      onChange(value.slice(0, -1));
    } else if (key && value.length < 4) {
      onChange(value + key);
    }
  }

  return (
    <div className="flex flex-col items-center gap-8">
      {/* Dots */}
      <div className={`flex gap-4 ${shake ? "animate-[shake_0.4s_ease]" : ""}`}>
        {[0,1,2,3].map((i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-colors ${
              i < value.length ? "bg-black border-black" : "bg-transparent border-[#888]"
            } ${error ? "border-[#ef4444]" : ""}`}
          />
        ))}
      </div>

      {/* Number pad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
        {PAD.map((key, i) => (
          <button
            key={i}
            type="button"
            onClick={() => tap(key)}
            disabled={!key}
            className={`
              h-16 rounded-2xl text-xl font-semibold text-black transition-colors
              ${key ? "bg-[#f5f5f5] active:bg-[#e5e5e5] cursor-pointer" : "opacity-0 pointer-events-none"}
              ${key === "⌫" ? "text-base" : ""}
            `}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}
