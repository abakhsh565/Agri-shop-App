import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { pushNav, shouldSkipNext } from "@/lib/navContext";

/**
 * Auto-tracks every route transition into the journey stack.
 *
 * Mount this inside each shell layout (AdminLayout, EmployeeLayout).
 * On every location change, records the transition:
 *   pushNav(newPath, prevPath)
 *
 * Skips push when the transition was triggered by a back-button
 * (NavHeader sets skipNext before navigating).
 */
export default function NavTracker() {
  const location = useLocation();
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    const prev = prevPath.current;
    const curr = location.pathname;
    if (prev !== curr) {
      if (!shouldSkipNext()) {
        pushNav(curr, prev);
      }
      prevPath.current = curr;
    }
  }, [location.pathname]);

  return null;
}
