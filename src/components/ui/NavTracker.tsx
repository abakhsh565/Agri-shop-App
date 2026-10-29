import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { recordNav, shouldSkipNext, isDashboardPath, clearNav } from "@/lib/navContext";
import { isTopLevel } from "@/lib/navDepth";

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

    // Consumed FIRST, whatever the branch below does with it. The flag is one navigation wide,
    // and a dashboard or top-level arrival used to return before reading it — leaving it set, so
    // the reader's NEXT forward step was recorded as a back step and left no frame behind it.
    // That missing frame is what made back fall through to a parent from another flow.
    const cameFromBack = shouldSkipNext();

    // A dashboard or a tab root starts a new journey — the frames of the one before it are not
    // behind this screen. Only the dashboard used to clear, so a reader who tapped Settings after
    // finishing something in Sales carried Sales' steps underneath Settings, and back from a
    // Settings sub-screen could walk into a flow they had already left (owner's report,
    // 2026-10-30). A top-level path is a root by definition (`lib/navDepth`).
    if (isDashboardPath(curr) || isTopLevel(curr)) {
      clearNav();
    } else if (cameFromBack || navigationType === "POP") {
      recordNav(curr, prev, "back");
    } else if (navigationType === "REPLACE") {
      recordNav(curr, prev, "replace");
    } else {
      recordNav(curr, prev, "push");
    }

    prevPath.current = curr;
  }, [location.pathname, navigationType]);

  return null;
}
