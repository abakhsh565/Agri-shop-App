import { useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { pushNav, popNav, clearNav } from "@/lib/navContext";

/**
 * Hook for context-aware back navigation.
 *
 * On mount: records WHERE the user came from (via location.state._navFrom
 * or the referer path) into the journey stack.
 *
 * goBack(): pops the journey stack and navigates to the previous screen.
 *           Falls back to browser history if the stack is empty.
 */
export default function useNavBack(fallback?: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const pushed = useRef(false);

  // Record entry on first render
  if (!pushed.current) {
    pushed.current = true;
    const state = location.state as { _navFrom?: string } | null;
    const from = state?._navFrom;
    if (from && from !== location.pathname) {
      pushNav(location.pathname, from);
    }
  }

  function goBack() {
    const from = popNav(location.pathname);
    if (from && from !== location.pathname) {
      navigate(from, { replace: true });
    } else if (fallback) {
      navigate(fallback, { replace: true });
    } else {
      navigate(-1 as any);
    }
  }

  return goBack;
}

export { clearNav };
