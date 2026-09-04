import { Search } from "lucide-react";
import { type InputHTMLAttributes } from "react";

interface SearchBarProps extends InputHTMLAttributes<HTMLInputElement> {
  containerClass?: string;
}

export default function SearchBar({ containerClass = "", ...props }: SearchBarProps) {
  return (
    <div className={`relative w-full ${containerClass}`}>
      <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "var(--text-secondary)" }} />
      <input
        type="text"
        {...props}
        className={`
          w-full h-[42px] ps-10 pe-4 rounded-[12px] text-[13px]
          placeholder:text-[#aaa] outline-none transition-colors
          ${props.className ?? ""}
        `}
        style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
      />
    </div>
  );
}
