import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Remember where the reader was standing, per screen, and put them back there.
 *
 * The owner's report (2026-11-12): scroll down a long screen, tap an option, the next screen
 * opens — then Back returns to the *top* of the screen they left, so the option they were
 * looking at is off-screen again and they have to hunt for it.
 *
 * The scroller is not always the same element: in the app shell the page list scrolls inside
 * `[data-app-scroll]`, while in the browser/dev frame the phone-width `.app-frame` is the panel
 * that visibly scrolls. Guessing one of them is how the first version of this silently did
 * nothing. So the element is *learned* from the first real scroll event (capture phase, which
 * sees scrolls from any element), and the same element is reused for the restore.
 *
 * Restoration waits for content: lists arrive after the first paint, and setting `scrollTop` on
 * a panel that is still short silently clamps to 0 — exactly the bug being fixed. The offset is
 * re-applied for a short window until the panel is tall enough or the reader takes over.
 */
const positions = new Map<string, number>();
const MAX_TRACKED = 120;
let scroller: HTMLElement | null = null;

function isScrollable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const overflow = getComputedStyle(el).overflowY;
  return (overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight + 4;
}

/** The panel that actually scrolls on this screen, learned from scrolls and remembered. */
function activeScroller(): HTMLElement | null {
  if (scroller && scroller.isConnected) return scroller;
  const known = document.querySelector<HTMLElement>("[data-app-scroll]");
  if (known && isScrollable(known)) return (scroller = known);
  const frame = document.querySelector<HTMLElement>(".app-frame");
  if (frame && isScrollable(frame)) return (scroller = frame);
  return known ?? frame ?? null;
}

function remember(key: string, top: number): void {
  if (top <= 0) {
    positions.delete(key);
    return;
  }
  positions.set(key, top);
  if (positions.size > MAX_TRACKED) {
    const oldest = positions.keys().next().value;
    if (oldest !== undefined) positions.delete(oldest);
  }
}

export function useScrollMemory(): void {
  const location = useLocation();
  const key = `${location.pathname}${location.search}`;
  const keyRef = useRef(key);
  keyRef.current = key;

  // Learn the scroller and record the offset while the reader moves. One write per animation
  // frame, so a long flick costs a map assignment per frame rather than one per event.
  useEffect(() => {
    let frame = 0;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!isScrollable(target)) return;
      scroller = target;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        remember(keyRef.current, target.scrollTop);
      });
    };
    // Capture, because scroll events do not bubble: this sees the panel wherever it lives.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
    };
  }, []);

  // Put the reader back on the screen they return to.
  useEffect(() => {
    const panel = activeScroller();
    if (!panel) return;
    const target = positions.get(key) ?? 0;

    if (target === 0) {
      panel.scrollTop = 0;
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    const cancel = () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      panel.removeEventListener("wheel", cancel);
      panel.removeEventListener("touchstart", cancel);
      panel.removeEventListener("keydown", cancel);
    };
    const apply = () => {
      if (cancelled) return;
      const tallEnough = panel.scrollHeight - panel.clientHeight >= target;
      if (tallEnough) panel.scrollTop = target;
    };

    // First try on the next frame (the route's content has been committed by then), then a few
    // short retries while async lists fill the screen.
    window.requestAnimationFrame(apply);
    [60, 160, 320, 600].forEach((delay) => {
      timers.push(window.setTimeout(apply, delay));
    });

    // Any real input means the reader has taken over: stop moving their viewport.
    panel.addEventListener("wheel", cancel, { passive: true });
    panel.addEventListener("touchstart", cancel, { passive: true });
    panel.addEventListener("keydown", cancel);

    return cancel;
  }, [key]);

  // Deliberately no "write the offset on unmount" step: a cleanup runs *after* the next screen
  // has taken over the panel, so it would read that screen's fresh top (0) and erase the very
  // position it was meant to keep. Scroll events have already recorded where the reader was.
}
