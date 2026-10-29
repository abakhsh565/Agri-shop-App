/**
 * Navigation Context Tracker
 *
 * Maintains a journey stack independent of browser history.
 * The browser's history stack is unreliable because:
 * - Tab bar navigations often use `replace` (no history entry)
 * - Programmatic redirects can corrupt the stack
 * - Multiple rapid navigations can race
 *
 * This tracker records every meaningful navigation so back buttons
 * can return to the exact page the user came from.
 */

interface NavFrame {
  /** Where the user navigated TO */
  path: string;
  /** Where the user navigated FROM (what back should reach) */
  from: string;
}

const MAX_DEPTH = 50;
let stack: NavFrame[] = [];
let lastPushed = "";
let skipNext = false;

/**
 * Set before a back-triggered navigation so NavTracker skips the next push.
 * The back button already pops from the stack; the NavTracker must not
 * push a new entry for the back navigation.
 */
export function setSkipNext() { skipNext = true; }
export function shouldSkipNext() {
  if (skipNext) { skipNext = false; return true; }
  return false;
}

/** How the reader arrived: a fresh step, an overwritten step, or a step back. */
export type NavMove = "push" | "replace" | "back";

/**
 * Record one navigation with the move that caused it.
 *
 * WHY THE MOVE MATTERS. This stack is what the back button walks, so it has to describe the
 * journey the reader can actually retrace. A screen that finishes a form and `replace`s itself
 * with the saved record is ONE step, not two: recording it as a push left the completed form
 * behind the record, and back then re-opened a form the reader had just submitted — one of the
 * ways this button used to go somewhere the reader had never been.
 *
 *   - `push`    — a new step; the screen it came from is behind it.
 *   - `replace` — the reader's current entry is gone; the new screen inherits its place.
 *   - `back`    — the step is being undone; the frame being left is dropped.
 */
export function recordNav(to: string, from: string, move: NavMove) {
  if (move === "back") {
    popNav(from);
    return;
  }
  if (move === "replace") {
    // The new screen takes the place of the one it replaced, so whatever was behind the form
    // is still what is behind the saved record. Only the TOP frame can be replaced: the screen
    // being left is the reader's current step, and a frame with the same path from an earlier
    // visit is not it. Searching the whole stack for `from` was how an old visit's frame got
    // rewritten while the current screen went unrecorded — back from it then had no step of its
    // own and fell through to a parent that belonged to the other visit.
    const top = stack[stack.length - 1];
    if (top && top.path === from) {
      stack[stack.length - 1] = { path: to, from: top.from };
      lastPushed = "";
      return;
    }
  }
  pushNav(to, from);
}

/** Call this when the user navigates to a new page */
export function pushNav(to: string, from: string) {
  // Deduplicate: don't push if we just pushed this exact frame
  const key = `${from}->${to}`;
  if (key === lastPushed) return;
  lastPushed = key;

  stack.push({ path: to, from });
  if (stack.length > MAX_DEPTH) {
    stack = stack.slice(-MAX_DEPTH);
  }
}

/**
 * Pop the current frame and return where back should go.
 * Returns null if the stack is empty (use browser back as fallback).
 *
 * ONLY THE TOP FRAME COUNTS (owner's report, 2026-10-30). The stack used to be searched for a
 * frame whose path matched, anywhere inside it. On a screen the reader had visited before — the
 * settings menu, a hub, a report opened twice — that found the frame of the EARLIER visit and
 * threw away everything after it, so back left the current journey and landed on the screen the
 * previous one had come from. A path is not a step: the reader's place is the last frame, and if
 * that frame is not this screen then this screen was never a step in this journey (a tab root, a
 * redirect, a deep link) and back must use the parent the screen itself names.
 */
export function popNav(currentPath: string): string | null {
  const top = stack[stack.length - 1];
  if (!top || top.path !== currentPath) return null;
  stack = stack.slice(0, -1);
  return top.from;
}

/** Peek at where back would go without popping */
export function peekBack(currentPath: string): string | null {
  const top = stack[stack.length - 1];
  return top && top.path === currentPath ? top.from : null;
}

/** Check if a path is a dashboard/home screen */
export function isDashboardPath(path: string): boolean {
  return path === "/admin/dashboard" || path === "/employee/dashboard";
}

/** Clear the entire stack (e.g. on logout) */
export function clearNav() {
  stack = [];
  lastPushed = "";
}

/** Clear a flow prefix (e.g. clear all /admin/sale entries after sale completion) */
export function clearFlow(prefix: string) {
  stack = stack.filter((f) => !f.path.startsWith(prefix));
  lastPushed = "";
}

/** Get current stack depth (for debugging) */
export function navDepth() {
  return stack.length;
}

/** Get the full stack (for debugging) */
export function debugStack() {
  return [...stack];
}
