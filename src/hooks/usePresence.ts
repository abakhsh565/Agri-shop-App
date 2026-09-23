import { useEffect, useRef, useState } from "react";

/**
 * Keeps a component mounted for the length of its exit animation.
 *
 * The problem this solves: overlays are rendered as `{open ? <Sheet/> : null}`,
 * so "closed" meant "gone in one frame" — no exit, and in a WebView that reads
 * as a flicker rather than as a dismissal.
 *
 * `mounted` stays true through the exit; `leaving` is true only during it, so the
 * caller can play the exit class and drop `pointer-events` (a dying overlay must
 * never swallow the tap that dismissed it, or the next screen's own tap).
 *
 * Two ways out, deliberately: the caller's own `onAnimationEnd` (exact, no timer
 * to drift) and a fallback timeout, because an animation can be skipped entirely
 * — `prefers-reduced-motion` is honoured, and a backgrounded WebView may not run
 * one at all. Without the fallback a skipped animation would leave the overlay
 * mounted forever, blocking the app.
 */
export default function usePresence(open: boolean, durationMs: number) {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setLeaving(false);
      setMounted(true);
      return;
    }
    if (!wasOpen.current) return; // never opened: nothing to animate out
    wasOpen.current = false;
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, durationMs + 60);
    return () => window.clearTimeout(timer);
  }, [open, durationMs]);

  /** Call from the panel's onAnimationEnd to end the exit as soon as it lands. */
  const finishExit = () => {
    if (!leaving) return;
    setMounted(false);
    setLeaving(false);
  };

  return { mounted, leaving, finishExit };
}

/** True when the user has asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Dismiss-then-close for a sheet whose parent unmounts it on close.
 *
 * Those sheets take no `open` prop — the parent renders them conditionally — so
 * they cannot animate themselves out after the parent's state flips. Holding the
 * parent's `onClose` back by exactly one animation buys the exit, and nothing
 * else: use it for the DISMISS paths only (backdrop tap, close button). A
 * confirm/save path must call the caller immediately, so an action is never
 * delayed behind an animation.
 */
export function useDelayedDismiss(onClose: () => void, durationMs: number) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // The guard is a ref, not the `closing` state: two taps in the same task both
  // read the same rendered state, so a state guard would schedule two closes.
  const alreadyDismissing = useRef(false);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const dismiss = () => {
    if (alreadyDismissing.current) return;
    alreadyDismissing.current = true;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(onClose, durationMs);
  };

  return { closing, dismiss };
}
