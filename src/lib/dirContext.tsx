import { createContext, useContext, useMemo } from "react";
import { useThemeStore } from "@/stores/themeStore";

/**
 * Direction, as a single boolean.
 *
 * This context used to expose `start`/`end`, `psClass`/`peClass`/`msClass`/`meClass` and an
 * `rtlStyle()` that flipped physical inline styles at runtime — a JavaScript copy of the
 * `!important` compatibility layer that lived in `index.css`. Both were the same mistake in
 * two places: direction decided by whoever remembered to ask for it, instead of by the box's
 * own inline axis.
 *
 * They were also dead — nothing imported them. Everything positional in the app is now written
 * logically (`start-*`/`end-*`, `ps-*`/`pe-*`, `insetInlineStart`), so a component needs to
 * know the direction for exactly two things: choosing a mirror-image icon, and mirroring a
 * rotation. That is what this context is for now, and `importantShimGuard` fails the build on
 * a physical utility or a physical inline style reappearing anywhere in `src/`.
 */
interface DirContextValue {
  isRtl: boolean;
  dir: "ltr" | "rtl";
}

const DirContext = createContext<DirContextValue>({ isRtl: false, dir: "ltr" });

/**
 * <Dir> provider — wraps the app or any subtree.
 * Reads the current language from useThemeStore and provides direction to its children.
 */
export function Dir({ children }: { children: React.ReactNode }) {
  const { language } = useThemeStore();
  const isRtl = language === "ur";

  const value = useMemo<DirContextValue>(
    () => ({ isRtl, dir: isRtl ? "rtl" : "ltr" }),
    [isRtl],
  );

  return <DirContext.Provider value={value}>{children}</DirContext.Provider>;
}

/**
 * Direction for the rare component that must branch on it.
 *
 * Usage:
 *   const { isRtl } = useDir();
 *   <ChevronRight style={{ transform: isRtl ? "rotate(180deg)" : undefined }} />
 *
 * Do NOT use it to choose between `left`/`right` or `pl`/`pr` — write the logical property
 * and let the inline axis do the work.
 */
export function useDir() {
  return useContext(DirContext);
}
