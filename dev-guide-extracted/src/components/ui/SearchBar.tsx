import { Search } from "lucide-react";
import { type InputHTMLAttributes } from "react";

interface SearchBarProps extends InputHTMLAttributes<HTMLInputElement> {
  containerClass?: string;
}

export default function SearchBar({ containerClass = "", ...props }: SearchBarProps) {
  return (
    <div className={`relative w-full ${containerClass}`}>
      <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#888]" />
      <input
        type="text"
        {...props}
        className={`
          w-full h-11 pl-10 pr-4 rounded-[100px] bg-[#f5f5f5] text-sm text-black
          placeholder:text-[#888] outline-none border-none
          ${props.className ?? ""}
        `}
      />
    </div>
  );
}
