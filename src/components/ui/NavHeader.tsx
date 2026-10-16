import { ArrowLeft, ArrowRight } from "lucide-react";
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
}

export default function NavHeader({ title, backTo, onBack, right, noBack }: NavHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useThemeStore();
  const isRtl = language === "ur";

  function handleBack() {
    if (onBack) { onBack(); return; }
    if (backTo) { navigate(backTo); return; }

    // On dashboard, back is handled by hardware back button (exit flow)
    if (isDashboardPath(location.pathname)) return;

    // On a top-level screen (tab destination), go to dashboard
    if (isTopLevel(location.pathname)) {
      const role = location.pathname.startsWith("/admin") ? "/admin" : "/employee";
      setSkipNext();
      navigate(role + "/dashboard", { replace: true });
      return;
    }

    // Nested screen: pop from journey stack
    const from = popNav(location.pathname);
    if (from) {
      setSkipNext();
      navigate(from, { replace: true });
    } else {
      // Fallback: go to dashboard of current role
      const role = location.pathname.startsWith("/admin") ? "/admin" : "/employee";
      setSkipNext();
      navigate(role + "/dashboard", { replace: true });
    }
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
          aria-label={tNow("common.back")}
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
          {isRtl ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
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
