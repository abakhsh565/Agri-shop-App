import { useEffect, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import LogoTile from "@/components/ui/LogoTile";
import { useT } from "@/lib/i18n";

export interface SelectorOption {
  value: string;
  label: string;
  /** Grey inline qualifier after the name (reference: "Interactive"). */
  qualifier?: string;
  /** Small tertiary line under the name. */
  meta?: string;
  description?: string;
  logoSrc?: string | null;
}

interface SelectorFieldProps {
  value: string;
  options: SelectorOption[];
  /** Shown in the field while nothing is chosen. */
  placeholder: string;
  /** Sheet title. */
  title: string;
  onChange: (value: string) => void;
  searchable?: boolean;
  emptyLabel?: string;
  /**
   * The way out of an empty picker, matching SelectSheet. Without it, a selector on a
   * screen whose save is blocked by the missing record is a dead end: the user is
   * told what is missing and given nowhere to go.
   */
  emptyAction?: { label: string; onClick: () => void };
  disabled?: boolean;
  /**
   * Whether rows carry a leading logo tile. True for records that have a mark
   * (a supplier, a company); false for plain choices like "Before the due date"
   * or "Days", where an initials tile would invent an identity that isn't there.
   */
  showTile?: boolean;
}

/**
 * The reference's selector, in our own style.
 *
 * Closed: one fully-rounded tone field showing the chosen entity's logo tile +
 * name (+ its qualifier), with a chevron — so the choice is identifiable by its
 * mark, not by a line of text.
 * Open: our own sheet (grabber, centred title, leading close) with the same
 * grouped-list grammar as the reference's picker rows, a check on the current
 * choice, and an optional search field.
 *
 * Replaces the native <select>, whose popup is drawn by the OS/browser and can
 * never match our design language.
 */
export default function SelectorField({
  value,
  options,
  placeholder,
  title,
  onChange,
  searchable = false,
  emptyLabel,
  emptyAction,
  disabled = false,
  showTile = true,
}: SelectorFieldProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? options.filter((o) =>
        [o.label, o.qualifier, o.meta].filter(Boolean).join(" ").toLowerCase().includes(needle),
      )
    : options;

  return (
    <>
      <button
        type="button"
        className="ds-field"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {selected ? (
          <>
            {showTile && <LogoTile name={selected.label} src={selected.logoSrc} size={28} />}
            <span className="ds-row-label flex-1 truncate">
              {selected.label}
              {selected.qualifier && <span className="ds-row-qualifier"> {selected.qualifier}</span>}
            </span>
          </>
        ) : (
          <span className="flex-1 truncate" style={{ color: "var(--text-tertiary)" }}>
            {placeholder}
          </span>
        )}
        <ChevronDown size={18} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
      </button>

      {/* A field picker resolves in one tap, so it has no close button. */}
      <Sheet open={open} title={title} onClose={() => setOpen(false)} closeButton={false}>
        {searchable && (
          <div className="px-4 pb-3">
            <div className="ds-field" style={{ minHeight: 48 }}>
              <Search size={18} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("common.searchPlaceholder")}
                className="h-full flex-1 bg-transparent outline-none ds-body"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
          </div>
        )}

        <div className="px-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 px-4 text-center">
              <p className="ds-meta">{emptyLabel ?? t("common.nothingToChoose")}</p>
              {emptyAction && (
                <button
                  type="button"
                  onClick={emptyAction.onClick}
                  className="ds-meta font-semibold underline underline-offset-2"
                  style={{ color: "var(--brand-dark)" }}
                >
                  {emptyAction.label}
                </button>
              )}
            </div>
          ) : (
            <ListCard>
              {filtered.map((o) => (
                <ListRow
                  key={o.value}
                  tile={showTile ? <LogoTile name={o.label} src={o.logoSrc} size={44} /> : undefined}
                  title={o.label}
                  qualifier={o.qualifier}
                  meta={o.meta}
                  emphasis
                  selected={o.value === value}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  trailing={
                    o.value === value ? (
                      <Check size={20} style={{ color: "var(--brand-dark)" }} className="shrink-0" />
                    ) : undefined
                  }
                />
              ))}
            </ListCard>
          )}
        </div>
      </Sheet>
    </>
  );
}
