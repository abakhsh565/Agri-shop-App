import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { recordNavigation, shouldSkipNext, updateCurrentPath } from "@/lib/navContext";

/**
 * Records every meaningful route transition into the module-scoped journey stack.
 *
 * Query-only changes (filters, search, tabs) update the current step instead of creating a new
 * one, so Back restores the latest list state without adding phantom history steps. A dashboard
 * or module root resets the context, and crossing into another module starts that module's own
 * context — the source module never sits beneath the destination.
 */
export default function NavTracker() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const prevPathname = useRef(location.pathname);
  const prevPath = useRef(`${location.pathname}${location.search}`);

  useEffect(() => {
    const curr = `${location.pathname}${location.search}`;
    const prev = prevPath.current;
    const pathnameChanged = prevPathname.current !== location.pathname;

    if (!pathnameChanged) {
      if (prev !== curr) updateCurrentPath(curr, location.state);
      prevPath.current = curr;
      return;
    }

    const cameFromBack = shouldSkipNext();
    const from = prev;
    prevPathname.current = location.pathname;
    prevPath.current = curr;

    if (cameFromBack) return;

    if (navigationType === "POP") {
      recordNavigation(curr, from, "back", location.state);
    } else if (navigationType === "REPLACE") {
      recordNavigation(curr, from, "replace", location.state);
    } else {
      recordNavigation(curr, from, "push", location.state);
    }
  }, [location.pathname, location.search, location.state, navigationType]);

  return null;
}
