import { Search, X } from "lucide-react";
import { type InputHTMLAttributes } from "react";
import { useT } from "@/lib/i18n";

interface SearchBarProps extends InputHTMLAttributes<HTMLInputElement> {
  containerClass?: string;
  /** Tapping the clear mark empties the field. Omit it and no mark is shown. */
  onClear?: () => void;
}

/**
 * The one search field in the app.
 *
 * Every list screen used to hand-roll its own pill — which is how a page could end
 * up showing two differently-shaped search boxes at once. This is the single
 * implementation, built from the design language's fully-rounded tone field with a
 * thin-stroke mark, so a search looks and measures the same everywhere by
 * construction rather than by convention.
 *
 * The clear mark was previously a text "×" glyph (and, on one screen, an icon).
 * It is one circular trailing icon here, in the same stroke weight as every other
 * icon, and it only appears when there is something to clear.
 */
export default function SearchBar({ containerClass = "", onClear, ...props }: SearchBarProps) {
  const t = useT();

  return (
    <div className={`ds-field ${containerClass}`}>
      <Search size={18} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
      <input
        type="text"
        {...props}
        className="h-full min-w-0 flex-1 bg-transparent outline-none ds-body"
        style={{ color: "var(--text-primary)" }}
      />
      {onClear && props.value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={t("common.clear")}
          className="flex shrink-0 items-center"
        >
          <X size={16} style={{ color: "var(--text-secondary)" }} />
        </button>
      ) : null}
    </div>
  );
}
