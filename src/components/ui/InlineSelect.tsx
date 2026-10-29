import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * One choice, opened in place.
 *
 * The category and payment method on the record-money form used to be sheets: a tap raised a full
 * overlay to answer a question whose answer is three words, then that overlay had to be dismissed
 * before the form could be finished. This opens a panel under the field itself, so the choice
 * happens where the reader is looking and the form never leaves the screen.
 *
 * It matters twice over inside another sheet (a reminder). A second `fixed inset-0` overlay stacked
 * on a sheet is a fight between two scrims and two Escape handlers; a panel inside the sheet is
 * not. That is why this is a shared component rather than a local one: the shape is now part of
 * the design language instead of a trick on one screen.
 *
 * The panel is `start-0`/`end-0`, so it aligns with the field in either reading direction.
 */
export interface InlineSelectOption {
  value: string;
  label: string;
}

export default function InlineSelect({
  value,
  options,
  onChange,
  label,
  testId,
  disabled = false,
}: {
  value: string;
  options: InlineSelectOption[];
  onChange: (value: string) => void;
  label: string;
  testId: string;
  disabled?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="relative">
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        data-testid={testId}
        disabled={disabled}
        onClick={() => setOpen((next) => !next)}
        className="ds-field w-full text-start ds-pressable disabled:opacity-50"
      >
        <span className="flex-1 text-13 truncate" style={{ color: "var(--text-primary)" }}>
          {selected?.label ?? ""}
        </span>
        <ChevronDown
          size={16}
          className="shrink-0"
          style={{
            color: "var(--text-secondary)",
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 180ms ease",
          }}
        />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
            style={{ background: "transparent" }}
          />
          <div
            role="listbox"
            aria-label={label}
            className="absolute start-0 end-0 top-full mt-2 z-50 rounded-[var(--radius-card)] py-1 overflow-y-auto"
            style={{
              maxHeight: 260,
              background: "var(--tone-sheet)",
              border: "1px solid var(--divider)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
            }}
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-testid={`${testId}-option-${option.value}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-start text-13 ds-pressable"
                  style={{ color: active ? "var(--brand-dark)" : "var(--text-primary)" }}
                >
                  <span className="flex-1 truncate">{option.label}</span>
                  {active && <Check size={15} className="shrink-0" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
