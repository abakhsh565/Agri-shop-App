import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { recordNav, shouldSkipNext, isDashboardPath, clearNav } from "@/lib/navContext";

/**
 * Auto-tracks every route transition into the journey stack.
 *
 * Mount this inside each shell layout (AdminLayout, EmployeeLayout). On every location change it
 * records HOW the reader arrived, because the back arrow walks this stack:
 *
 *   push    → a new step, with the screen it came from behind it
 *   replace → the reader's entry was overwritten (a saved form), so the new screen inherits its
 *             place and back does not reopen the form
 *   back    → the step is being undone, so its frame is dropped
 *
 * The back button sets `skipNext` before it navigates, which is the one signal the router cannot
 * give us: a back that uses `replace` looks like any other replace from here.
 */
export default function NavTracker() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    const prev = prevPath.current;
    const curr = location.pathname;
    if (prev === curr) return;

    // Reaching a dashboard starts a new journey — old frames are not behind it any more.
    if (isDashboardPath(curr)) {
      clearNav();
    } else if (shouldSkipNext()) {
      recordNav(curr, prev, "back");
    } else if (navigationType === "REPLACE") {
      recordNav(curr, prev, "replace");
    } else if (navigationType === "POP") {
      recordNav(curr, prev, "back");
    } else {
      recordNav(curr, prev, "push");
    }

    prevPath.current = curr;
  }, [location.pathname, navigationType]);

  return null;
}
