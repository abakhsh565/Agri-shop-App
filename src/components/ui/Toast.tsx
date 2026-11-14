import { useEffect, useRef, useState } from "react";
import { X, Check, AlertTriangle, Info, XCircle } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { tNow } from "@/lib/i18n";

/** Matches --dur-2, the toast duration token. */
const TOAST_MS = 200;

/**
 * Toasts in our own style: a rounded card on the language's radii and type
 * scale. The semantic colours (error red, warning amber) stay — they carry
 * meaning — while success/info use the inverted primary surface, which is the
 * board's one "solid dark pill" treatment.
 *
 * Motion: a toast that only fades IN still reads as a pop-in; the exit is what
 * makes it feel like something the app put down deliberately. The store removes
 * a toast from the array the instant it expires, so the exit is played here by
 * holding a copy of the last state of anything that disappeared — otherwise the
 * component unmounts and there is nothing left to animate.
 */
export default function ToastContainer() {
  const { toasts, removeToast } = useUIStore();
  const [exiting, setExiting] = useState<typeof toasts>([]);
  const previous = useRef<typeof toasts>([]);

  useEffect(() => {
    const gone = previous.current.filter((p) => !toasts.some((t) => t.id === p.id));
    previous.current = toasts;
    if (!gone.length) return;
    setExiting((current) => {
      const ids = new Set(current.map((t) => t.id));
      return [...current, ...gone.filter((t) => !ids.has(t.id))];
    });
    const timer = window.setTimeout(() => {
      setExiting((current) => current.filter((t) => !gone.some((g) => g.id === t.id)));
    }, TOAST_MS + 40);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const shown = [...toasts, ...exiting];
  if (!shown.length) return null;

  return (
    <div
      className="fixed start-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[calc(100%-32px)] max-w-sm"
      style={{ bottom: "calc(var(--tabbar-height, 72px) + 16px)" }}
      aria-live="polite"
    >
      {shown.map((toast) => {
        const inverted = toast.type === "success" || toast.type === "info";
        const isLeaving = !!exiting.find((t) => t.id === toast.id);
        const style = inverted
          ? { background: "var(--text-primary)", color: "var(--tone-page)" }
          : toast.type === "error"
            ? { background: "var(--error)", color: "#ffffff" }
            : { background: "var(--warning)", color: "#0a0a0a" };
        const Icon =
          toast.type === "success"
            ? Check
            : toast.type === "error"
              ? XCircle
              : toast.type === "warning"
                ? AlertTriangle
                : Info;
        const action = toast.action;

        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 ${
              isLeaving ? "ds-anim-toast-out ds-anim-leaving" : "ds-anim-toast-in"
            }`}
            style={{
              ...style,
              borderRadius: "var(--radius-card)",
              // The one place in the app that earns a shadow: a toast floats over
              // whatever is behind it, so tone alone cannot separate it.
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
            }}
          >
            <Icon size={18} className="shrink-0 mt-0.5" aria-hidden />
            <span className="ds-body flex-1" style={{ color: "inherit" }}>
              {toast.message}
            </span>
            {action && (
              <button
                type="button"
                onClick={() => {
                  removeToast(toast.id);
                  action.onClick();
                }}
                className="shrink-0 text-12 font-bold underline underline-offset-2 ds-pressable"
                style={{ color: "inherit" }}
              >
                {action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label={tNow("common.close")}
              className="shrink-0 mt-0.5 ds-pressable"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
