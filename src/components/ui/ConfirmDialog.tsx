import { useEffect } from "react";
import { tNow } from "@/lib/i18n";
import usePresence from "@/hooks/usePresence";

/** Matches --dur-2, the dialog duration token. */
const DIALOG_MS = 200;

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Centered modal for confirming an irreversible or important action
 * (e.g. deleting a product). Backdrop tap or Cancel dismisses; Escape too.
 *
 * Styled in the design language: the same large radius as a sheet (it is the
 * same family of popup), centered type from the scale, and two pill actions —
 * the confirm one carrying the semantic colour, since that is the only place
 * colour still means something.
 */
export default function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel,
  destructive = false, loading = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  // "Cancel" used to be the default, so a caller that did not pass a label showed
  // English to an owner reading Urdu.
  const cancelText = cancelLabel ?? tNow("common.cancel");
  const { mounted, leaving, finishExit } = usePresence(open, DIALOG_MS);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-6 ds-backdrop ${
        leaving ? "ds-anim-backdrop-out ds-anim-leaving" : "ds-anim-backdrop-in"
      }`}
      onClick={() => !loading && !leaving && onCancel()}
    >
      <div
        className={`w-full max-w-[340px] p-5 ${leaving ? "ds-anim-dialog-out" : "ds-anim-dialog-in"}`}
        style={{ background: "var(--tone-page)", borderRadius: "var(--radius-sheet)" }}
        onAnimationEnd={finishExit}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="ds-title-sheet mb-1">{title}</p>
        <p className="ds-body mb-5" style={{ color: "var(--text-secondary)", lineHeight: 1.45 }}>{message}</p>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 font-semibold disabled:opacity-50"
            style={{
              height: 48,
              borderRadius: "var(--radius-field)",
              background: "var(--tone-card)",
              color: "var(--text-primary)",
              fontSize: "var(--text-meta)",
              fontWeight: "var(--weight-strong)",
            }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 disabled:opacity-50"
            style={{
              height: 48,
              borderRadius: "var(--radius-field)",
              background: destructive ? "var(--error)" : "var(--text-primary)",
              color: destructive ? "#ffffff" : "var(--tone-page)",
              fontSize: "var(--text-meta)",
              fontWeight: "var(--weight-strong)",
            }}
          >
            {loading ? tNow("common.working") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
