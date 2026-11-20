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
 * THE GESTURE IS THE PART THAT MATTERS ON A PHONE. A drag that starts on the backdrop can chain
 * into the page behind it, so any touchmove whose target is outside the sheet is cancelled while
 * an overlay is up. `touch-action: none` is deliberately NOT used: the sheet is a descendant of
 * the same scroll roots, so disabling touch actions there would also stop a finger from scrolling
 * the sheet's own body. Its `overscroll-behavior: contain` is what stops the gesture at its end.
 *
 * Nothing here is per-sheet. Every sheet, dialog, picker and cropper mounts as `.fixed.inset-0`, so
 * one observer covers the whole app and a screen added tomorrow is locked without doing anything.
 */
export default function useOverlayScrollLock() {
  useEffect(() => {
    let locked = false;
    // Two possible scroll roots. A screen that fits scrolls its panel; a taller one used to make
    // the panel grow and the app frame scroll instead — which is exactly the screen where a sheet
    // opened and the page behind it kept moving. Locking both covers either shape, and `min-h-0`
    // in the layouts makes the panel the normal one.
    let lockedElements: HTMLElement[] = [];
    const saved = { bodyOverflow: "", htmlOverflow: "" };
    const savedById = new Map<HTMLElement, { overflow: string; overscroll: string; scrollTop: number }>();

    const blockTouch = (event: TouchEvent) => {
      if (!locked) return;
      const target = event.target as Node | null;
      const sheet = document.querySelector(".ds-sheet");
      // A finger inside the sheet is scrolling the sheet; everywhere else is the page behind it.
      if (sheet && target && sheet.contains(target)) return;
      if (event.cancelable) event.preventDefault();
    };

    const apply = () => {
      const overlayOpen = Boolean(document.querySelector(".fixed.inset-0"));
      if (overlayOpen === locked) return;

      if (overlayOpen) {
        lockedElements = Array.from(
          document.querySelectorAll<HTMLElement>("[data-app-scroll], .app-frame"),
        );
        if (lockedElements.length === 0) return;
        locked = true;

        savedById.clear();
        for (const element of lockedElements) {
          savedById.set(element, {
            overflow: element.style.overflow,
            overscroll: element.style.overscrollBehavior,
            scrollTop: element.scrollTop,
          });
          element.style.overflow = "hidden";
          element.style.overscrollBehavior = "contain";
        }
        saved.bodyOverflow = document.body.style.overflow;
        saved.htmlOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = "hidden";
        document.documentElement.style.overflow = "hidden";
        document.addEventListener("touchmove", blockTouch, { passive: false });
        return;
      }

      locked = false;
      document.removeEventListener("touchmove", blockTouch);
      for (const element of lockedElements) {
        const previous = savedById.get(element);
        if (!previous) continue;
        element.style.overflow = previous.overflow;
        element.style.overscrollBehavior = previous.overscroll;
        // Putting the position back makes the sheet look like it opened over the list, not above it.
        element.scrollTop = previous.scrollTop;
      }
      lockedElements = [];
      savedById.clear();
      document.body.style.overflow = saved.bodyOverflow;
      document.documentElement.style.overflow = saved.htmlOverflow;
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
      document.removeEventListener("touchmove", blockTouch);
      if (!locked) return;
      for (const element of lockedElements) {
        const previous = savedById.get(element);
        if (!previous) continue;
        element.style.overflow = previous.overflow;
        element.style.overscrollBehavior = previous.overscroll;
      }
      document.body.style.overflow = saved.bodyOverflow;
      document.documentElement.style.overflow = saved.htmlOverflow;
    };
  }, []);
}
