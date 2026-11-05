import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useNavigate } from "react-router-dom";
import { type ReactNode } from "react";
import { popNav, setSkipNext, isDashboardPath } from "@/lib/navContext";
import { useLocation } from "react-router-dom";
import { isTopLevel } from "@/lib/navDepth";
import { tNow } from "@/lib/i18n";

interface NavHeaderProps {
  title: string;
  backTo?: string;
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

export default function NavHeader({ title, backTo, onBack, right, noBack, backIcon = "arrow" }: NavHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useThemeStore();
  const isRtl = language === "ur";

  function handleBack() {
    if (onBack) { onBack(); return; }

    // Where the reader actually came from wins over the parent a screen assumes for itself.
    // The same screen is opened from several places (the Finance hub, the overview, a report),
    // and `backTo` can only name one of them — the journey stack knows which one they used. It
    // is also right about replaced screens: a form that saved itself with `replace` is not
    // behind the screen it opened, so back cannot reopen a form the reader already completed.
    const from = popNav(location.pathname);
    if (from && from !== location.pathname) {
      // The tracker must not record this back step as a new forward frame.
      setSkipNext();
      navigate(from, { replace: true });
      return;
    }

    // Nothing behind this screen (a deep link, a cold start, or a tab root): use the parent it
    // names. It REPLACES the current entry rather than pushing a new one (owner's report,
    // 2026-10-30): pushing left the screen behind, so the next back returned to it and the reader
    // bounced between the two — five presses of "back" that never left the pair. A replace is a
    // step up the tree, and the arrow keeps moving up from the parent's own parent.
    if (backTo) {
      setSkipNext();
      navigate(backTo, { replace: true });
      return;
    }

    // On dashboard, back is handled by the hardware back button (the exit flow).
    if (isDashboardPath(location.pathname)) return;

    // Nothing behind it and no parent named: the dashboard is the floor for this shell.
    const role = location.pathname.startsWith("/admin")
      ? "/admin"
      : location.pathname.startsWith("/co-owner")
        ? "/co-owner"
        : "/employee";
    setSkipNext();
    navigate(role + "/dashboard", { replace: true });
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
          // part: the arrow must stay pinned to the 20px inset rather than drifting to the centre
          // of a wider box, which is exactly what centring it would have done.
          className="flex items-center justify-start w-11 h-11 text-sm font-medium absolute transition-opacity active:opacity-60"
          // The arrow mirrors with the reading direction — in Urdu the leading edge is the right
          // one, so back belongs there, with the mirrored glyph. A logical inset does the rest:
          // the box's inline start IS the leading edge in both directions, so there is nothing to
          // decide and the code stays the same size in both languages. The inset is 20px because
          // that is this row's own gutter (`px-5`): the arrow used to sit at 16 and read a few
          // pixels inward of the header it belongs to, and of the language switch above it.
          style={{ color: "var(--text-primary)", insetInlineStart: 20 }}
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
