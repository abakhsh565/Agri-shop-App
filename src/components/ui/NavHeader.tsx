import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { type ReactNode } from "react";
import { popNav, setSkipNext } from "@/lib/navContext";
import { useLocation } from "react-router-dom";

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

  function handleBack() {
    if (onBack) { onBack(); return; }
    if (backTo) { navigate(backTo); return; }
    // Pop from our journey stack instead of browser history
    const from = popNav(location.pathname);
    if (from) {
      setSkipNext();
      navigate(from, { replace: true });
    } else {
      setSkipNext();
      navigate(-1 as any);
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
          className="flex items-center text-sm font-medium absolute left-4 transition-opacity active:opacity-60"
          style={{ color: "var(--text-primary)" }}
        >
          <ArrowLeft size={18} />
        </button>
      )}
      <p
        className="text-base font-bold w-full text-center"
        style={{ color: "var(--text-primary)" }}
      >
        {title}
      </p>
      {right && <div className="absolute right-4">{right}</div>}
    </div>
  );
}
