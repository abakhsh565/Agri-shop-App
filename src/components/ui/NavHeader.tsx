import { ArrowLeft, ArrowRight } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";
import { useNavigate } from "react-router-dom";
import { type ReactNode } from "react";
import { popNav, setSkipNext, isDashboardPath } from "@/lib/navContext";
import { useLocation } from "react-router-dom";
import { isTopLevel } from "@/lib/navDepth";

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
      className="flex h-11 items-center px-4 relative shrink-0 w-full"
      style={{ background: "var(--background)" }}
    >
      {!noBack && (
        <button
          onClick={handleBack}
          className="flex items-center text-sm font-medium absolute transition-opacity active:opacity-60"
          style={{ color: "var(--text-primary)", [isRtl ? "right" : "left"]: 16 }}
        >
          {isRtl ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}
        </button>
      )}
      <p
        className="text-base font-bold w-full text-center"
        style={{ color: "var(--text-primary)" }}
      >
        {title}
      </p>
      {right && <div className="absolute" style={{ [isRtl ? "left" : "right"]: 16 }}>{right}</div>}
    </div>
  );
}
