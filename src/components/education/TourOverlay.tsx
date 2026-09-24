import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useAuthStore } from "@/stores/authStore";
import { useEducationStore } from "@/stores/educationStore";
import { currentEduRole, visibleTourSteps, type TourStep } from "@/education/model";

/**
 * The guided tour: a coachmark attached to the **real** UI.
 *
 * Anatomy: the app dims, one real element is cut out of the dim with a brand
 * ring, and a card sits above or below it with the step's words, the count, and
 * Next / Back / Skip / X. Nothing is drawn from coordinates in a stylesheet or
 * from a screenshot — the rectangle comes from `getBoundingClientRect()` of the
 * element carrying the step's `data-tour` anchor, so it is the actual button.
 *
 * The rules this component exists to keep:
 *
 *  - **It navigates nowhere on exit.** Closing sets a flag and unmounts. The user
 *    stays exactly where the tour was teaching, on a screen they were already
 *    allowed to be on.
 *  - **It writes nothing but the flag.** No business row, no setup-completion
 *    state; see `educationStore`.
 *  - **A missing target is skipped, not pointed at.** Each step waits briefly for
 *    its anchor and then passes silently to the next, so a permission-restricted
 *    or not-yet-rendered block can never produce a tooltip floating over nothing.
 *  - **It cannot trap anyone.** X, Skip and Escape all leave; the overlay is
 *    `aria-modal` with the card focused, and focus returns to where it was.
 */

/** How long a step waits for its anchor before giving up on it (~0.8s). */
const SEEK_FRAMES = 48;

export default function TourOverlay() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const { tourOpen, closeTour } = useEducationStore();

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  // The steps this person can actually be taught: role first, then permission.
  // `visibleTourSteps` reads the live permission store, so a role edited mid-session
  // narrows the tour on its next open rather than teaching an unavailable screen. The
  // `user` subscription above is what re-renders this component when that changes; the
  // role itself is spelled in one place (`currentEduRole`) so the guide cannot disagree.
  const role = user ? currentEduRole() : undefined;
  const steps: TourStep[] = visibleTourSteps(role);
  const total = steps.length;
  const step: TourStep | undefined = steps[Math.min(index, Math.max(total - 1, 0))];

  // A fresh tour always starts at the first stop, and gives focus back on exit.
  useEffect(() => {
    if (!tourOpen) return;
    setIndex(0);
    restoreFocusRef.current = document.activeElement;
    return () => {
      const el = restoreFocusRef.current;
      if (el instanceof HTMLElement && document.contains(el)) el.focus();
      setRect(null);
    };
  }, [tourOpen]);

  /** Move on; past the last step the tour simply ends (no navigation). */
  const advance = useCallback(
    (delta: number) => {
      setIndex((current) => {
        const next = current + delta;
        if (next < 0) return current;
        if (next >= total) {
          closeTour();
          return current;
        }
        setRect(null);
        return next;
      });
    },
    [total, closeTour]
  );

  // Seek the step's real element. Steps on another screen move there first — that
  // is the tour showing where things are, and it is the only navigation it does.
  useEffect(() => {
    if (!tourOpen || !step) return;
    const wanted = `${base}${step.route}`;
    if (pathname !== wanted) {
      navigate(wanted);
    }
    let cancelled = false;
    let frames = 0;
    const seek = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (el) {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        setRect(el.getBoundingClientRect());
        return;
      }
      if (++frames > SEEK_FRAMES) {
        // Target genuinely not there for this person: skip it, never point at nothing.
        advance(1);
        return;
      }
      requestAnimationFrame(seek);
    };
    seek();
    return () => {
      cancelled = true;
    };
  }, [tourOpen, step?.id, step?.anchor, step?.route, base, pathname, navigate, advance, step]);

  // Keep the ring on the element while the page moves under it.
  useEffect(() => {
    if (!tourOpen || !step) return;
    const remeasure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [tourOpen, step?.id, step?.anchor, step]);

  // Keyboard: Escape leaves, and the card holds focus so Tab stays inside it.
  useEffect(() => {
    if (!tourOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeTour();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tourOpen, closeTour]);

  useEffect(() => {
    if (tourOpen && rect) cardRef.current?.focus();
  }, [tourOpen, rect, index]);

  if (!tourOpen || !step || total === 0 || !rect) return null;

  const below = rect.bottom < window.innerHeight * 0.62;
  const isLast = index >= total - 1;

  return (
    <>
      {/* Clicks land here, not on the app: a tour must not trigger the button it
          is describing. The overlay is transparent to the eye, not to the finger. */}
      <div className="fixed inset-0 z-[70]" onClick={(e) => e.stopPropagation()} aria-hidden="true" />

      {/* The cut-out: the real element's rectangle, with the whole screen dimmed
          around it by one enormous shadow. */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: rect.left - 4,
          top: rect.top - 4,
          width: rect.width + 8,
          height: rect.height + 8,
          borderRadius: "var(--radius-tile)",
          outline: "2px solid var(--brand)",
          outlineOffset: "2px",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          pointerEvents: "none",
          zIndex: 71,
        }}
      />

      <div
        className="fixed inset-x-0 z-[72] flex justify-center px-3"
        style={below ? { top: rect.bottom + 14 } : { bottom: window.innerHeight - rect.top + 14 }}
      >
        <div
          ref={cardRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={t("edu.guide.title")}
          className="ds-card w-full max-w-[340px] p-4 outline-none ds-anim-dialog-in"
          data-testid="tour-card"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-11 font-semibold" style={{ color: "var(--text-tertiary)" }} data-testid="tour-progress">
              {t("edu.tour.progress", { current: String(index + 1), total: String(total) })}
            </p>
            <button
              type="button"
              onClick={closeTour}
              aria-label={t("edu.tour.close")}
              className="ds-iconbtn shrink-0"
              data-testid="tour-close"
            >
              <X size={16} />
            </button>
          </div>

          <p className="text-16 font-bold mt-1" style={{ color: "var(--text-primary)" }} data-testid="tour-title">
            {t(step.titleKey)}
          </p>
          <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }} data-testid="tour-body">
            {t(step.bodyKey)}
          </p>

          <div className="flex items-center justify-between gap-2 mt-4">
            <button
              type="button"
              onClick={closeTour}
              className="text-13 font-semibold ds-pressable"
              style={{ color: "var(--text-tertiary)" }}
              data-testid="tour-skip"
            >
              {t("edu.tour.skip")}
            </button>
            <div className="flex items-center gap-2">
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => advance(-1)}
                  className="ds-btn-secondary h-9 px-4 text-13 font-semibold"
                  data-testid="tour-back"
                >
                  {t("edu.tour.back")}
                </button>
              )}
              <button
                type="button"
                onClick={() => advance(1)}
                className="ds-btn-brand h-9 px-4 text-13 font-bold"
                data-testid="tour-next"
              >
                {isLast ? t("edu.tour.done") : t("edu.tour.next")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
