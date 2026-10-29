import { useEffect, useState } from "react";
import Sheet from "@/components/ui/Sheet";
import { useT } from "@/lib/i18n";

/**
 * Pick a hand-entered window: From and To, no future dates, no backwards range.
 *
 * It is a sheet rather than two fields sitting on the screen, because a range is a decision the
 * reader makes occasionally, not a control that should occupy the page every day. The draft lives
 * here, so a half-typed range is discarded on close instead of quietly re-filtering the screen.
 *
 * `max` is today, and it is enforced twice: the native picker refuses later days, and the change
 * handler drops a typed one. The ledger has no rows in the future, so a later To could only make
 * the figures look like they cover more than they do.
 */
interface DateRangeSheetProps {
  open: boolean;
  from: string;
  to: string;
  /** YYYY-MM-DD in the shop's timezone — the newest day the range may end on. */
  max: string;
  onClose: () => void;
  onApply: (from: string, to: string) => void;
  onClear: () => void;
}

export default function DateRangeSheet({ open, from, to, max, onClose, onApply, onClear }: DateRangeSheetProps) {
  const t = useT();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  // Reopening starts from what the screen is actually showing, not from the last abandoned draft.
  useEffect(() => {
    if (open) {
      setDraftFrom(from);
      setDraftTo(to);
    }
  }, [open, from, to]);

  const fieldStyle = { background: "var(--field-bg)" };

  // This sheet collects two values, so it keeps the visible close: the scrim and Escape dismiss
  // it, but neither is a thing the reader can see.
  return (
    <Sheet open={open} title={t("admin.selectDateRange")} onClose={onClose}>
      <div className="px-5 flex flex-col gap-4">
        <div className="flex gap-3">
          <label className="flex-1 min-w-0">
            <span className="ds-section-label block mb-1">{t("admin.from")}</span>
            <input
              type="date"
              value={draftFrom}
              max={draftTo || max}
              onChange={(e) => {
                const next = e.target.value;
                if (next > max) return;
                setDraftFrom(next);
                if (next && draftTo && next > draftTo) setDraftTo(next);
              }}
              data-testid="range-from"
              className="w-full outline-none"
              style={fieldStyle}
            />
          </label>
          <label className="flex-1 min-w-0">
            <span className="ds-section-label block mb-1">{t("admin.to")}</span>
            <input
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              max={max}
              onChange={(e) => {
                const next = e.target.value;
                if (next > max) return;
                setDraftTo(next);
              }}
              data-testid="range-to"
              className="w-full outline-none"
              style={fieldStyle}
            />
          </label>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClear}
            data-testid="range-clear"
            className="flex-1 h-11 rounded-full text-13 font-semibold ds-pressable"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            {t("reports.clear")}
          </button>
          <button
            type="button"
            onClick={() => onApply(draftFrom, draftTo)}
            disabled={!draftFrom || !draftTo}
            data-testid="range-apply"
            className="flex-1 h-11 rounded-full text-13 font-bold ds-pressable disabled:opacity-45"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {t("reports.apply")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
