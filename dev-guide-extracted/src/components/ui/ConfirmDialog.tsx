import { useEffect } from "react";

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
  open, title, message, confirmLabel, cancelLabel = "Cancel",
  destructive = false, loading = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
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
        <p className="text-base font-bold mb-1.5" style={{ color: "var(--text-primary)" }}>{title}</p>
        <p className="text-[13px] leading-relaxed mb-5" style={{ color: "var(--text-secondary)" }}>{message}</p>
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 h-11 rounded-full text-sm font-bold disabled:opacity-50"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 h-11 rounded-full text-sm font-bold disabled:opacity-50"
            style={{
              background: destructive ? "var(--error)" : "var(--brand)",
              color: destructive ? "#fff" : "#0a0a0a",
            }}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
