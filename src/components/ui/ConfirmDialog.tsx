import { useEffect } from "react";
import { tNow } from "@/lib/i18n";

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
 */
export default function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel,
  destructive = false, loading = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  // "Cancel" used to be the default, so a caller that did not pass a label showed
  // English to an owner reading Urdu.
  const cancelText = cancelLabel ?? tNow("common.cancel");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={() => !loading && onCancel()}
    >
      <div
        className="w-full max-w-[340px] rounded-[20px] p-5"
        style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[15px] font-bold mb-1" style={{ color: "var(--text-primary)" }}>{title}</p>
        <p className="text-[13px] leading-relaxed mb-5" style={{ color: "var(--text-secondary)" }}>{message}</p>
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 h-[44px] rounded-[12px] text-[13px] font-semibold disabled:opacity-50"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 h-[44px] rounded-[12px] text-[13px] font-semibold disabled:opacity-50"
            style={{
              background: destructive ? "var(--error)" : "#1a1a1a",
              color: destructive ? "#fff" : "#fff",
            }}
          >
            {loading ? tNow("common.working") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
