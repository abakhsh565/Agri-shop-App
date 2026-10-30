import { useEffect } from "react";

/**
 * Keep the screen behind an open sheet exactly where the reader left it.
 *
 * WHY THIS IS NOT A CSS RULE ON <body>. The app does not scroll the page: the shell gives every
 * screen one tall panel (`[data-app-scroll]`) and that panel is what the finger moves. Locking
 * `body` — which the stylesheet tried, through `body:has(.fixed.inset-0.z-50)` — therefore changed
 * nothing on a phone, and the list behind the sheet kept sliding under the reader's thumb. It also
 * depended on `:has()`, which older Android WebViews do not have at all.
 *
 * WHAT IT DOES. Watches for any full-screen overlay (every sheet, dialog and the picture cropper
 * mounts as `.fixed.inset-0`) and, while one exists, takes the scroll away from the panel and
 * restores it — with the reader's position — when the last one closes. The observer is how this
 * works for the sheets that are hand-drawn rather than built on `Sheet`, without each screen
 * having to remember to ask.
 */
export default function useOverlayScrollLock() {
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>("[data-app-scroll]");
    if (!scroller) return;

    let locked = false;
    let savedOverflow = "";
    let savedTop = 0;

    const apply = () => {
      const overlayOpen = Boolean(document.querySelector(".fixed.inset-0"));
      if (overlayOpen === locked) return;
      locked = overlayOpen;

      if (locked) {
        savedOverflow = scroller.style.overflow;
        savedTop = scroller.scrollTop;
        scroller.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
        return;
      }

      scroller.style.overflow = savedOverflow;
      document.body.style.overflow = "";
      // A scroll container with `overflow: hidden` can still be clamped by the browser; putting
      // the position back makes the sheet look like it opened over the list, not above it.
      scroller.scrollTop = savedTop;
    };

    const observer = new MutationObserver(apply);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // Overlays appear by mounting, and leave by unmounting. `class` also catches the two that
      // animate out before they are removed.
      attributeFilter: ["class"],
    });
    apply();

    return () => {
      observer.disconnect();
      if (!locked) return;
      scroller.style.overflow = savedOverflow;
      document.body.style.overflow = "";
    };
  }, []);
}
