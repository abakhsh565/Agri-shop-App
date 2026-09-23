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
    <div className="flex flex-col items-center gap-6 sm:gap-10 w-full">
      {/* Dots */}
      <div className={`flex gap-4 sm:gap-5 ${shake ? "animate-[shake_0.4s_ease]" : ""}`}>
        {[0,1,2,3].map((i) => (
          <div
            key={i}
            className={`w-4 h-4 sm:w-[18px] sm:h-[18px] rounded-full border-2 sm:border-[2.5px] transition-all duration-200 ${
              i < value.length
                ? "bg-ink border-border-control scale-110"
                : "bg-transparent border-[#bbb]"
            } ${error ? "border-[#ef4444] bg-[#ef4444]/10" : ""}`}
          />
        ))}
      </div>

      {/* Number pad — big touchable circular buttons */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3 w-full max-w-[300px]">
        {PAD.map((key, i) => (
          key ? (
            <button
              key={i}
              type="button"
              onClick={() => tap(key)}
              className="
                w-full aspect-square rounded-full text-2xl sm:text-26 font-medium
                flex items-center justify-center
                transition-all duration-100
                active:scale-90 active:brightness-90
                min-h-[56px] sm:min-h-[72px]
              "
              style={{
                color: key === "⌫" ? "var(--text-secondary, #888)" : "var(--text-primary, #111)",
                background: "var(--surface-2, #f5f5f5)",
                fontSize: key === "⌫" ? "22px" : undefined,
              }}
            >
              {key}
            </button>
          ) : (
            <div key={i} className="w-full aspect-square min-h-[56px] sm:min-h-[72px]" />
          )
        ))}
      </div>
    </div>
  );
}
