import { useEffect, useState } from "react";
import { Search, Check, X } from "lucide-react";
import { useT } from "@/lib/i18n";

export interface SelectOption {
  value: string;
  label: string;
  sub?: string;
  imageUrl?: string;
}

interface SelectSheetProps {
  open: boolean;
  title: string;
  options: SelectOption[];
  selected?: string;
  searchable?: boolean;
  emptyLabel?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

/**
 * In-app bottom-sheet picker used in place of native <select> dialogs so
 * selection UI matches the app's design. Slides up from the bottom, dims the
 * backdrop, and (optionally) filters a long list.
 */
export default function SelectSheet({
  open, title, options, selected, searchable = false,
  emptyLabel, onSelect, onClose,
}: SelectSheetProps) {
  const t = useT();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] mx-auto rounded-t-[20px] max-h-[75vh] flex flex-col animate-slide-up"
        style={{ background: "var(--surface)", borderTop: "1px solid var(--divider)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <p className="text-[15px] font-bold" style={{ color: "var(--text-primary)" }}>{title}</p>
          <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
            <X size={16} />
          </button>
        </div>

        {searchable && (
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2 h-[40px] rounded-[12px] px-3"
              style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}>
              <Search size={14} style={{ color: "var(--text-secondary)" }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("common.searchPlaceholder")}
                className="flex-1 bg-transparent text-[13px] outline-none"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
          </div>
        )}

        <div className="overflow-y-auto px-3 pb-6 pt-1">
          {filtered.length === 0 ? (
            <p className="text-center text-[13px] py-8" style={{ color: "var(--text-secondary)" }}>{emptyLabel ?? t("common.nothingToChoose")}</p>
          ) : (
            filtered.map((o) => {
              const isSel = o.value === selected;
              return (
                <button
                  key={o.value}
                  onClick={() => { onSelect(o.value); onClose(); }}
                  className="flex items-center justify-between w-full px-3 py-3 rounded-[12px] text-start active:opacity-70"
                  style={{ background: isSel ? "rgba(132,204,22,0.08)" : "transparent" }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {o.imageUrl ? (
                      <img src={o.imageUrl} alt="" className="size-9 rounded-full object-cover shrink-0" />
                    ) : null}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate"
                        style={{ color: isSel ? "var(--brand-dark)" : "var(--text-primary)" }}>{o.label}</p>
                      {o.sub && <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{o.sub}</p>}
                    </div>
                  </div>
                  {isSel && <Check size={16} style={{ color: "var(--brand-dark)" }} className="shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
