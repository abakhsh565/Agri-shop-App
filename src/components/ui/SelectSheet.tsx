import { useEffect, useState } from "react";
import { Search, Check } from "lucide-react";
import { useT } from "@/lib/i18n";
import usePresence from "@/hooks/usePresence";

/** Matches --dur-3, the sheet duration token. */
const SHEET_MS = 280;

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
  /**
   * The way out of an empty picker. A picker with nothing in it is a dead end for
   * the task that opened it, so the sheet offers the action that creates the missing
   * record instead of only naming it. Tertiary by intent: it lives inside someone
   * else's workflow, so it is a modest text action, not a primary button.
   */
  emptyAction?: { label: string; onClick: () => void };
  onSelect: (value: string) => void;
  onClose: () => void;
}

/**
 * In-app bottom-sheet picker used in place of native <select> dialogs so
 * selection UI matches the app's design. Slides up from the bottom, dims the
 * backdrop, and (optionally) filters a long list.
 *
 * **No close button, by design.** This sheet has exactly one outcome — the row you tap — and
 * that tap dismisses it, so a cross would be a second control saying what the list already
 * says. Tapping the dimmed backdrop, pressing Escape, or the Android back button all dismiss it
 * unchanged. It keeps the grabber so the sheet still reads as something laid over the screen
 * rather than a page of its own.
 */
export default function SelectSheet({
  open, title, options, selected, searchable = false,
  emptyLabel, emptyAction, onSelect, onClose,
}: SelectSheetProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const { mounted, leaving, finishExit } = usePresence(open, SHEET_MS);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col justify-end ds-backdrop ${
        leaving ? "ds-anim-backdrop-out ds-anim-leaving" : "ds-anim-backdrop-in"
      }`}
      onClick={leaving ? undefined : onClose}
    >
      <div
        className={`ds-sheet w-full max-w-[480px] mx-auto max-h-[75vh] flex flex-col ${
          leaving ? "ds-anim-sheet-out" : "ds-anim-sheet-in"
        }`}
        onAnimationEnd={finishExit}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ds-grabber" />
        <div className="flex items-center px-5 pt-3 pb-3">
          <p className="text-15 font-bold" style={{ color: "var(--text-primary)" }}>{title}</p>
        </div>

        {searchable && (
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2 h-[40px] rounded-[var(--radius-tile)] px-3"
              style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}>
              <Search size={14} style={{ color: "var(--text-secondary)" }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("common.searchPlaceholder")}
                className="h-full flex-1 bg-transparent text-13 outline-none"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
          </div>
        )}

        <div className="overflow-y-auto px-3 pb-6 pt-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 px-4 text-center">
              <p className="text-13" style={{ color: "var(--text-secondary)" }}>{emptyLabel ?? t("common.nothingToChoose")}</p>
              {emptyAction && (
                <button
                  type="button"
                  onClick={emptyAction.onClick}
                  className="text-13 font-semibold underline underline-offset-2"
                  style={{ color: "var(--brand-dark)" }}
                >
                  {emptyAction.label}
                </button>
              )}
            </div>
          ) : (
            filtered.map((o) => {
              const isSel = o.value === selected;
              return (
                <button
                  key={o.value}
                  onClick={() => { onSelect(o.value); onClose(); }}
                  className="flex items-center justify-between w-full px-3 py-3 rounded-[var(--radius-tile)] text-start active:opacity-70"
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
