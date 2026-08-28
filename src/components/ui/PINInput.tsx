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

      {/* Number pad — 100×100 circular buttons, comfortable spacing */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[340px]">
        {PAD.map((key, i) => (
          key ? (
            <button
              key={i}
              type="button"
              onClick={() => tap(key)}
              className="
                w-[100px] h-[100px] rounded-full text-[24px] font-medium
                flex items-center justify-center
                transition-all duration-100
                active:scale-90 active:brightness-90
              "
              style={{
                color: key === "⌫" ? "var(--text-secondary, #888)" : "var(--text-primary, #111)",
                background: "var(--surface-2, #f5f5f5)",
                fontSize: key === "⌫" ? "20px" : undefined,
              }}
            >
              {key}
            </button>
          ) : (
            <div key={i} className="w-[100px] h-[100px]" />
          )
        ))}
      </div>
    </div>
  );
}
