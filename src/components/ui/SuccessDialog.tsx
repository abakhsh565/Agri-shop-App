import { useEffect } from "react";
import { Check } from "lucide-react";
import usePresence from "@/hooks/usePresence";

/** Matches --dur-2, the dialog duration token — the same as ConfirmDialog. */
const DIALOG_MS = 200;

/**
 * A finished job, confirmed — one mark, one sentence, one way on.
 *
 * It is deliberately NOT `ConfirmDialog`: that asks a question and needs two answers, and its
 * two equal buttons are the whole point of it. Here there is nothing to decide, so there is no
 * cancel, no destructive colour and no second button — a success that also offers "Cancel"
 * invites the owner to undo something that has already happened. The shell (tone, radius,
 * centred type, backdrop, exit animation, Escape) is the same, because it is the same family of
 * popup and it should not read as a different app.
 *
 * Dismissing is a tap anywhere, Escape, or the button — all three do the same single thing.
 */
export default function SuccessDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const { mounted, leaving, finishExit } = usePresence(open, DIALOG_MS);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onConfirm]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center px-6 ds-backdrop ${
        leaving ? "ds-anim-backdrop-out ds-anim-leaving" : "ds-anim-backdrop-in"
      }`}
      /* One dismissal, stated once: the scrim and the button are the same action, so there is
         no gesture here that means something different from the button. */
      onClick={() => !leaving && onConfirm()}
    >
      <div
        className={`w-full max-w-[340px] p-5 flex flex-col items-center text-center ${
          leaving ? "ds-anim-dialog-out" : "ds-anim-dialog-in"
        }`}
        style={{ background: "var(--tone-sheet)", borderRadius: "var(--radius-sheet)" }}
        onAnimationEnd={finishExit}
        onClick={(e) => e.stopPropagation()}
        data-testid="success-dialog"
      >
        {/* The mark carries the news before the words do. Brand-filled, in both themes, so it
            cannot read as a warning or an error — the semantic colours are reserved for those. */}
        <span
          className="size-12 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
          aria-hidden="true"
        >
          <Check size={24} strokeWidth={3} />
        </span>

        <p className="ds-title-sheet mt-3" data-testid="success-dialog-title">{title}</p>
        <p
          className="ds-body mt-1"
          style={{ color: "var(--text-secondary)", lineHeight: 1.45 }}
          data-testid="success-dialog-message"
        >
          {message}
        </p>

        <button
          type="button"
          data-testid="success-dialog-confirm"
          onClick={onConfirm}
          className="w-full mt-5 ds-pressable"
          style={{
            height: 48,
            borderRadius: "var(--radius-field)",
            background: "var(--brand)",
            color: "#0a0a0a",
            fontSize: "var(--text-meta)",
            fontWeight: "var(--weight-strong)",
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
