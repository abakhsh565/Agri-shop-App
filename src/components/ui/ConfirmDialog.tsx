import { useEffect, useState, type ReactNode } from "react";
import { tNow } from "@/lib/i18n";
import usePresence from "@/hooks/usePresence";
import Input from "@/components/ui/Input";

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
  confirmDisabled?: boolean;
  children?: ReactNode;
  /**
   * An optional third, quietest answer, for the three-answer alerts this platform uses —
   * save / discard / cancel on unsaved work, where two buttons force one of the three into a
   * guess. Rendered below the pair in the error tone, because the only third answers worth
   * offering are the ones that throw something away.
   *
   * Deliberately optional: every two-answer dialog in the app is unchanged by its arrival.
   */
  tertiaryLabel?: string;
  onTertiary?: () => void;
  /**
   * When set, the action stays disabled until the user types this text exactly
   * (trimmed). Used where a single tap is too easy to make by accident — deleting
   * the account, where the name is the one thing the owner certainly knows.
   * The text itself is shown above the field, so it is a deliberate gate rather
   * than a test.
   */
  requireTypedText?: string;
  /** Label above the typed field; only rendered when requireTypedText is set. */
  typedPrompt?: string;
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
  destructive = false, loading = false, confirmDisabled = false, children,
  tertiaryLabel, onTertiary,
  requireTypedText, typedPrompt,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  // "Cancel" used to be the default, so a caller that did not pass a label showed
  // English to an owner reading Urdu.
  const cancelText = cancelLabel ?? tNow("common.cancel");
  const { mounted, leaving, finishExit } = usePresence(open, DIALOG_MS);

  // The typed confirmation is per-opening: a re-opened dialog must not inherit what
  // the previous attempt typed, or the gate would already be satisfied.
  const [typed, setTyped] = useState("");
  useEffect(() => { if (open) setTyped(""); }, [open]);

  const expected = (requireTypedText ?? "").trim();
  const typedOk = !expected || typed.trim() === expected;

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
        style={{ background: "var(--tone-sheet)", borderRadius: "var(--radius-sheet)" }}
        onAnimationEnd={finishExit}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="ds-title-sheet mb-1">{title}</p>
        <p className="ds-body" style={{ color: "var(--text-secondary)", lineHeight: 1.45, marginBottom: expected ? 16 : 20 }}>{message}</p>

        {expected && (
          <div className="mb-5">
            <p className="text-13 mb-1" style={{ color: "var(--text-secondary)" }}>
              {typedPrompt}
            </p>
            {/* The exact text is printed, not described: the owner reads it and copies
                it, which is the whole point of typing it. */}
            <p
              className="text-16 font-bold mb-2.5"
              data-testid="confirm-typed-name"
              style={{ color: "var(--text-primary)" }}
            >
              {expected}
            </p>
            <Input
              autoFocus
              data-testid="confirm-typed-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && typedOk && !loading && !confirmDisabled) onConfirm(); }}
              placeholder={expected}
            />
          </div>
        )}

        {children && <div className="mb-5">{children}</div>}
        <div className="flex gap-2.5">
          <button
            type="button"
            data-testid="confirm-cancel"
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
            data-testid="confirm-submit"
            onClick={onConfirm}
            disabled={loading || confirmDisabled || !typedOk}
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

        {tertiaryLabel && onTertiary && (
          <button
            type="button"
            data-testid="confirm-tertiary"
            onClick={onTertiary}
            disabled={loading}
            className="w-full mt-2.5 font-semibold disabled:opacity-50"
            style={{
              height: 44,
              color: "var(--error)",
              fontSize: "var(--text-meta)",
              fontWeight: "var(--weight-strong)",
            }}
          >
            {tertiaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
