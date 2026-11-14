/**
 * Module-aware journey tracker.
 *
 * Browser history is not the source of truth here: tabs use replace, redirects race, and a
 * contextual cross-module link must not leave the source module behind the Back arrow. This
 * stack records the reader's meaningful in-module steps, scoped by workspace + module.
 */

import {
  WORKSPACE_BOARDS,
  normalizePath,
  resolveRouteMeta,
  stripSearch,
  type RouteNavigationMeta,
} from "@/lib/navigation";

interface NavFrame {
  /** Route including its query string, so filters and tabs survive the step back. */
  path: string;
  moduleKey: string;
  state?: unknown;
}

const MAX_DEPTH = 50;
let stack: NavFrame[] = [];
let skipNext = false;

/** Set before a back-triggered navigation so NavTracker does not re-record it as forward. */
export function setSkipNext() { skipNext = true; }
export function shouldSkipNext() {
  if (skipNext) { skipNext = false; return true; }
  return false;
}

export type NavMove = "push" | "replace" | "back";

function frameFor(path: string, state?: unknown): NavFrame {
  return { path, moduleKey: resolveRouteMeta(path).moduleKey, state };
}

function samePathname(a: string, b: string) {
  return normalizePath(a) === normalizePath(b);
}

function lastIndexWhere(frames: NavFrame[], predicate: (frame: NavFrame) => boolean): number {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    if (predicate(frames[i])) return i;
  }
  return -1;
}

/**
 * Whether this tab has an in-app page behind the current one.
 *
 * React Router keeps its history index in `window.history.state.idx`. A cold deep link starts at
 * 0 (or without the field), where going back would leave the app; that case still falls back to
 * the workspace board. A module opened from More has an index above 0, which is the page the
 * reader expects the arrow to return to.
 */
function canStepBackInBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" && idx > 0;
}

/**
 * Whether this tab has an in-app page behind the current one. Screens that sit inside a visited
 * path use this to prefer a real history step over replacing themselves with a canonical parent.
 */
export function hasInAppHistory(): boolean {
  return canStepBackInBrowser();
}

/**
 * Record one route transition.
 *
 * push    — a new in-module step.
 * replace — the current step was overwritten (e.g. a saved form became its record).
 * back    — a step was undone (hardware/browser back), so the frame is dropped or trimmed.
 *
 * A board or module root resets the in-module context. Back at a module root with browser history
 * uses history -1, so a hub opened from More returns to More; a cold entry still falls back to the
 * workspace board.
 */
export function recordNavigation(to: string, from: string, move: NavMove, state?: unknown) {
  const toMeta = resolveRouteMeta(to);
  if (toMeta.workspaceId === "auth" || toMeta.workspaceId === "public") return;

  const toFrame = frameFor(to, state);
  if (toMeta.isBoard || toMeta.entryType === "module-root") {
    stack = [toFrame];
    return;
  }

  const fromMeta = resolveRouteMeta(from);
  const sameModule =
    fromMeta.workspaceId === toMeta.workspaceId && fromMeta.moduleId === toMeta.moduleId;

  if (move === "back") {
    const index = lastIndexWhere(
      stack,
      (frame) => frame.moduleKey === toMeta.moduleKey && samePathname(frame.path, to),
    );
    if (index >= 0) {
      stack = stack.slice(0, index + 1);
      stack[index] = toFrame;
      return;
    }
    stack = [toFrame];
    return;
  }

  if (move === "replace") {
    const top = stack[stack.length - 1];
    if (top && (samePathname(top.path, from) || samePathname(top.path, to)) && top.moduleKey === toMeta.moduleKey) {
      stack[stack.length - 1] = toFrame;
      return;
    }
    stack = [toFrame];
    return;
  }

  // A different module — including a contextual record/link into a module child — starts a new
  // context. The source module is never left beneath the destination's first frame.
  if (!sameModule) {
    stack = [toFrame];
    return;
  }

  const top = stack[stack.length - 1];
  if (!top) {
    stack = [toFrame];
    return;
  }

  if (samePathname(top.path, from)) {
    stack.push(toFrame);
  } else if (samePathname(top.path, to)) {
    stack[stack.length - 1] = toFrame;
  } else {
    stack = [toFrame];
  }

  if (stack.length > MAX_DEPTH) stack = stack.slice(-MAX_DEPTH);
}

/** Compatibility wrapper for code that only has paths. */
export function recordNav(to: string, from: string, move: NavMove, state?: unknown) {
  recordNavigation(to, from, move, state);
}

/** Compatibility wrapper for explicit forward steps. */
export function pushNav(to: string, from: string) {
  recordNavigation(to, from, "push");
}

/** A filter/search change updates the current step without creating another history step. */
export function updateCurrentPath(path: string, state?: unknown) {
  const meta = resolveRouteMeta(path);
  if (meta.workspaceId === "auth" || meta.workspaceId === "public") return;
  const top = stack[stack.length - 1];
  if (!top || top.moduleKey !== meta.moduleKey || !samePathname(top.path, path)) return;
  top.path = path;
  top.state = state;
}

/**
 * Where Back should go from the current screen.
 *
 * Inside a module: the previous in-module frame.
 * Module root: the authorized workspace board.
 * Deep link: the configured canonical parent, then module root, then board.
 */
export function backTarget(currentPath: string): string | null {
  const meta = resolveRouteMeta(currentPath);
  if (meta.workspaceId === "auth" || meta.workspaceId === "public" || meta.isBoard) return null;

  const top = stack[stack.length - 1];
  if (top && top.moduleKey === meta.moduleKey && samePathname(top.path, currentPath)) {
    const previous = stack[stack.length - 2];
    if (previous && previous.moduleKey === meta.moduleKey) return previous.path;
  }

  if (meta.parentRoute) return meta.parentRoute;
  const board = WORKSPACE_BOARDS[meta.workspaceId as keyof typeof WORKSPACE_BOARDS];
  return board && normalizePath(board) !== normalizePath(currentPath) ? board : null;
}

/**
 * Walk the header/hardware Back arrow one step up the hierarchy.
 *
 * At a module root, history -1 is preferred so the screen that opened it (usually More) is kept.
 * A cold deep link has no in-app entry behind it and falls back to the canonical parent/board.
 * Returns false only when there is nowhere left to go (a workspace board).
 */
export function navigateBack(
  location: { pathname: string; search: string },
  navigate: (to: string, options?: { replace?: boolean; state?: unknown }) => void,
  fallback?: string,
  canStepBack = canStepBackInBrowser(),
): boolean {
  const current = `${location.pathname}${location.search}`;
  const meta = resolveRouteMeta(current);

  if (meta.workspaceId === "auth" || meta.workspaceId === "public") {
    if (fallback && !samePathname(fallback, current)) {
      navigate(fallback, { replace: true });
      return true;
    }
    return false;
  }

  if (meta.isBoard) return false;

  // BACK IS WHERE THE READER CAME FROM, at every depth (owner, 2026-11-12).
  //
  // The hierarchy below knows the canonical parent of a screen, which is right for a cold open —
  // a deep link, a refresh, a new tab — but wrong for a reader who is *in* a journey: a supplier
  // opened from a sale, a branch's Co-Owner opened from the branch, a flow opened from a record.
  // Those screens are reached across modules and through `replace`, and no parent map can say
  // where the person was standing. The tab's own history can, because it is the only record of
  // what they actually visited. Stepping back with `-1` is also what keeps the browser and
  // hardware back buttons agreeing with the arrow instead of walking a second, different path.
  //
  // The in-app stack is not abandoned: `setSkipNext` keeps the pop from being re-recorded as a
  // forward move, so the trail after the step is still the trail the reader walked. And when
  // there is no in-app page behind this one (`canStepBack` false), the canonical parent/board is
  // exactly the right answer, so the hierarchy below still runs.
  if (canStepBack) {
    // The step back is not recorded as a forward move, and the frame being left is dropped from
    // the trail here so a later cold fallback cannot point at the screen we just left.
    setSkipNext();
    popNav(current);
    (navigate as unknown as (delta: number) => void)(-1);
    return true;
  }

  const target = backTarget(current) ?? fallback ?? null;
  if (!target || samePathname(target, current)) return false;

  const targetFrame = prepareBack(current, target, meta);
  setSkipNext();
  navigate(targetFrame.path, { replace: true, state: targetFrame.state });
  return true;
}

function prepareBack(current: string, target: string, currentMeta: RouteNavigationMeta): NavFrame {
  const targetMeta = resolveRouteMeta(target);
  const targetFrame = frameFor(target);

  if (targetMeta.isBoard) {
    stack = [targetFrame];
    return targetFrame;
  }

  if (targetMeta.entryType === "module-root") {
    const index = lastIndexWhere(
      stack,
      (frame) => frame.moduleKey === targetMeta.moduleKey && samePathname(frame.path, target),
    );
    if (index >= 0 && currentMeta.moduleKey === targetMeta.moduleKey) {
      stack = stack.slice(0, index + 1);
      return stack[index];
    }
    stack = [targetFrame];
    return targetFrame;
  }

  const top = stack[stack.length - 1];
  const previous = stack[stack.length - 2];
  if (
    top &&
    previous &&
    top.moduleKey === currentMeta.moduleKey &&
    samePathname(top.path, current) &&
    previous.moduleKey === targetMeta.moduleKey &&
    samePathname(previous.path, target)
  ) {
    stack.pop();
    return previous;
  }

  const index = lastIndexWhere(
    stack,
    (frame) => frame.moduleKey === targetMeta.moduleKey && samePathname(frame.path, target),
  );
  if (index >= 0) {
    stack = stack.slice(0, index + 1);
    return stack[index];
  }

  stack = [targetFrame];
  return targetFrame;
}

/**
 * Pop the current frame and return the previous in-module route.
 * Returns null when the reader is at a module boundary or arrived by deep link.
 */
export function popNav(currentPath: string): string | null {
  const meta = resolveRouteMeta(currentPath);
  const top = stack[stack.length - 1];
  if (!top || !samePathname(top.path, currentPath)) return null;
  const previous = stack[stack.length - 2];
  if (!previous || previous.moduleKey !== meta.moduleKey) return null;
  stack.pop();
  return previous.path;
}

/** Peek at the previous in-module frame without popping. */
export function peekBack(currentPath: string): string | null {
  const meta = resolveRouteMeta(currentPath);
  const top = stack[stack.length - 1];
  if (!top || !samePathname(top.path, currentPath)) return null;
  const previous = stack[stack.length - 2];
  return previous && previous.moduleKey === meta.moduleKey ? previous.path : null;
}

export function isDashboardPath(path: string): boolean {
  return Object.values(WORKSPACE_BOARDS).includes(normalizePath(path));
}

export function clearNav() {
  stack = [];
  skipNext = false;
}

export function clearFlow(prefix: string) {
  stack = stack.filter((frame) => !stripSearch(frame.path).startsWith(prefix));
}

export function navDepth() {
  return stack.length;
}

export function debugStack() {
  return stack.map(({ path, moduleKey }) => ({ path, moduleKey }));
}
