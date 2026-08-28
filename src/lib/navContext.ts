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
 */
export function popNav(currentPath: string): string | null {
  // Find and remove the frame for the current path
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].path === currentPath) {
      const frame = stack[i];
      stack = stack.slice(0, i);
      return frame.from;
    }
  }
  return null;
}

/** Peek at where back would go without popping */
export function peekBack(currentPath: string): string | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].path === currentPath) {
      return stack[i].from;
    }
  }
  return null;
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
