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
          className="flex items-center text-sm font-medium absolute transition-opacity active:opacity-60"
          // A logical inset, not a JS toggle between `left` and `right`: the box's inline
          // start IS the leading edge in both directions, so there is nothing to decide.
          style={{ color: "var(--text-primary)", insetInlineStart: 16 }}
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
