import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useT } from "@/lib/i18n";
import usePresence from "@/hooks/usePresence";

/** Matches --dur-3, the sheet duration token. */
const SHEET_MS = 280;

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Optional single trailing icon action, as on the reference board. */
  actionIcon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
  maxHeight?: string;
}

/**
 * The reference's modal sheet: grabber, centered bold title, a circular close
 * on the leading side and one circular icon action on the trailing side.
 *
 * Deviation from the board, deliberate: the reference presents this as a
 * near-full-height modal card inset from the top, because it is a whole screen
 * of a desktop-sized phone app. Here it is anchored to the bottom and capped in
 * height, which is the reachable pattern one-handed on a phone with a keyboard
 * open — the anatomy (grabber, centred title, leading close, trailing action,
 * 40pt top corners, tone backdrop) is unchanged.
 *
 * `fixed inset-0 z-50` is required: index.css locks background scroll via
 * `body:has(.fixed.inset-0.z-50)`.
 */
export default function Sheet({
  open,
  title,
  onClose,
  actionIcon: ActionIcon,
  actionLabel,
  onAction,
  children,
  maxHeight = "85vh",
}: SheetProps) {
  const t = useT();
  const { mounted, leaving, finishExit } = usePresence(open, SHEET_MS);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col justify-end ds-backdrop ${
        leaving ? "ds-anim-backdrop-out ds-anim-leaving" : "ds-anim-backdrop-in"
      }`}
      onClick={leaving ? undefined : onClose}
    >
      <div
        className={`ds-sheet w-full max-w-[480px] mx-auto flex flex-col ${
          leaving ? "ds-anim-sheet-out" : "ds-anim-sheet-in"
        }`}
        style={{ maxHeight }}
        onAnimationEnd={finishExit}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ds-grabber" />

        <div className="relative flex items-center justify-center px-16 pt-3 pb-2">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="ds-iconbtn absolute start-4"
          >
            <X size={18} />
          </button>
          <p className="ds-title-sheet text-center">{title}</p>
          {ActionIcon && (
            <button
              type="button"
              onClick={onAction}
              aria-label={actionLabel}
              className="ds-iconbtn absolute end-4"
            >
              <ActionIcon size={18} />
            </button>
          )}
        </div>

        <div className="overflow-y-auto pb-6">{children}</div>
      </div>
    </div>
  );
}
