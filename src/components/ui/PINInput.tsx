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
    <div className="flex flex-col items-center gap-10">
      {/* Dots */}
      <div className={`flex gap-5 ${shake ? "animate-[shake_0.4s_ease]" : ""}`}>
        {[0,1,2,3].map((i) => (
          <div
            key={i}
            className={`w-[18px] h-[18px] rounded-full border-[2.5px] transition-all duration-200 ${
              i < value.length
                ? "bg-black border-black scale-110"
                : "bg-transparent border-[#bbb]"
            } ${error ? "border-[#ef4444] bg-[#ef4444]/10" : ""}`}
          />
        ))}
      </div>

      {/* Number pad — modern Android-style with generous touch targets */}
      <div className="grid grid-cols-3 gap-4 w-full max-w-[300px]">
        {PAD.map((key, i) => (
          <button
            key={i}
            type="button"
            onClick={() => tap(key)}
            disabled={!key}
            className="
              h-[72px] rounded-full text-[22px] font-medium transition-all duration-150
              active:scale-95 active:bg-[#ddd]
              disabled:opacity-0 disabled:pointer-events-none
            "
            style={{
              color: key === "⌫" ? "var(--text-secondary, #888)" : "var(--text-primary, #111)",
              background: key ? "var(--surface-2, #f5f5f5)" : "transparent",
              fontSize: key === "⌫" ? "18px" : undefined,
            }}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}
