import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useLocation, useNavigate } from "react-router-dom";
import { type ReactNode } from "react";
import { hasInAppHistory, navigateBack } from "@/lib/navContext";
import { tNow } from "@/lib/i18n";

interface NavHeaderProps {
  title: string;
  /** Fallback only: used for explicit auth/public flows and routes outside a workspace shell. */
  backTo?: string;
  /**
   * Retrace the visits in this tab with a real history step, keeping `backTo` for a cold open.
   * A module book uses this so its arrow returns to the screen the reader came from instead of
   * replacing the entry with the canonical parent, which leaves the arrow pointing at itself.
   */
  historyBack?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  noBack?: boolean;
  /**
   * What the leading control looks like. A screen opened as a panel over another one closes, so
   * it wears a cross; a step in a journey goes back, so it keeps the arrow. The behaviour is the
   * same either way — this only changes the glyph and the name a screen reader announces.
   */
  backIcon?: "arrow" | "close";
}

export default function NavHeader({ title, backTo, historyBack, onBack, right, noBack, backIcon = "arrow" }: NavHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useThemeStore();
  const isRtl = language === "ur";

  function handleBack() {
    // Genuine local step-backs (wizard steps, closing a panel) still own their behaviour.
    if (onBack) { onBack(); return; }

    // Screens inside a visited path step back through the tab's real history. The canonical
    // parent is only for a cold open: replacing the entry there would leave the arrow pointing
    // at the screen it just left, so the next tap would not move.
    if (historyBack && hasInAppHistory()) {
      navigate(-1);
      return;
    }

    // Everything else uses the module-aware hierarchy. At a module root the shared handler
    // prefers history -1 (so More remains the parent); a cold deep link falls back to the board.
    navigateBack(location, navigate, backTo);
  }

  return (
    <div
      className="flex h-[48px] items-center px-5 relative shrink-0 w-full"
      style={{ background: "var(--background)" }}
    >
      {!noBack && (
        <button
          onClick={handleBack}
          // Icon-only, and it is on every sub-screen: without a name a screen reader
          // announces nothing at all here.
          aria-label={backIcon === "close" ? tNow("common.close") : tNow("common.back")}
          data-testid="nav-back"
          // 44px of TARGET around an 18px arrow. The box was the icon's own size, so the tappable
          // area was 18×18 — under the touch floor, on every sub-screen in the app, and invisible
          // to the accessibility lane until the location picker (the first route it audits with
          // this header) put it in front of a measurement. `justify-start` is the load-bearing
          // part: the arrow must stay pinned to the 16px inset rather than drifting to the centre
          // of a wider box, which is exactly what centring it would have done.
          className="flex items-center justify-start w-11 h-11 text-sm font-medium absolute transition-opacity active:opacity-60"
          // The arrow mirrors with the reading direction — in Urdu the leading edge is the right
          // one, so back belongs there, with the mirrored glyph. A logical inset does the rest:
          // the box's inline start IS the leading edge in both directions, so there is nothing to
          // decide and the code stays the same size in both languages. This matches the trailing
          // action and the px-4 content below; 20px read 4px inward on those screens.
          style={{ color: "var(--text-primary)", insetInlineStart: 16 }}
        >
          {backIcon === "close"
            ? <X size={18} />
            : isRtl ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
        </button>
      )}
      <p
        className="text-15 font-bold w-full text-center"
        style={{ color: "var(--text-primary)" }}
      >
        {title}
      </p>
      {right && <div className="absolute" style={{ insetInlineEnd: 16 }}>{right}</div>}
    </div>
  );
}
