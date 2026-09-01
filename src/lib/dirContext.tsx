import { createContext, useContext, useMemo } from "react";
import { useThemeStore } from "@/stores/themeStore";

interface DirContextValue {
  isRtl: boolean;
  dir: "ltr" | "rtl";
  /** Logical start: left in LTR, right in RTL */
  start: "left" | "right";
  /** Logical end: right in LTR, left in RTL */
  end: "right" | "left";
  /** Logical start padding class — use in className strings */
  psClass: string;
  /** Logical end padding class — use in className strings */
  peClass: string;
  /** Logical start margin class — use in className strings */
  msClass: string;
  /** Logical end margin class — use in className strings */
  meClass: string;
}

const DirContext = createContext<DirContextValue>({
  isRtl: false,
  dir: "ltr",
  start: "left",
  end: "right",
  psClass: "ps-4",
  peClass: "pe-4",
  msClass: "ms-4",
  meClass: "me-4",
});

/**
 * <Dir> provider — wraps the app or any subtree.
 * Reads the current language from useThemeStore and provides
 * RTL context to all children via useDir().
 *
 * Usage:
 *   <Dir>
 *     <App />
 *   </Dir>
 */
export function Dir({ children }: { children: React.ReactNode }) {
  const { language } = useThemeStore();
  const isRtl = language === "ur";

  const value = useMemo<DirContextValue>(
    () => ({
      isRtl,
      dir: isRtl ? "rtl" : "ltr",
      start: isRtl ? "right" : "left",
      end: isRtl ? "left" : "right",
      psClass: isRtl ? "pe-4" : "ps-4",
      peClass: isRtl ? "ps-4" : "pe-4",
      msClass: isRtl ? "me-4" : "ms-4",
      meClass: isRtl ? "ms-4" : "me-4",
    }),
    [isRtl]
  );

  return <DirContext.Provider value={value}>{children}</DirContext.Provider>;
}

/**
 * Hook to access RTL context.
 * Returns direction-aware helpers so components don't need
 * to import useThemeStore and check language themselves.
 *
 * Usage:
 *   const { isRtl, start, end } = useDir();
 *   <div className={isRtl ? "me-2" : "ms-2"}>
 */
export function useDir() {
  return useContext(DirContext);
}

/**
 * Hook for inline style direction-awareness.
 * Returns a function that takes a physical LTR style object
 * and returns the RTL-flipped version.
 *
 * Usage:
 *   const { rtlStyle } = useDir();
 *   <div style={rtlStyle({ paddingLeft: 16 })}>
 */
export function useRtlStyle() {
  const { isRtl } = useDir();
  return useMemo(
    () =>
      (ltrStyle: React.CSSProperties): React.CSSProperties => {
        if (!isRtl) return ltrStyle;
        const flipped = { ...ltrStyle };
        if (ltrStyle.paddingLeft !== undefined) {
          flipped.paddingRight = ltrStyle.paddingLeft;
          flipped.paddingLeft = undefined;
        }
        if (ltrStyle.paddingRight !== undefined) {
          flipped.paddingLeft = ltrStyle.paddingRight;
          flipped.paddingRight = undefined;
        }
        if (ltrStyle.marginLeft !== undefined) {
          flipped.marginRight = ltrStyle.marginLeft;
          flipped.marginLeft = undefined;
        }
        if (ltrStyle.marginRight !== undefined) {
          flipped.marginLeft = ltrStyle.marginRight;
          flipped.marginRight = undefined;
        }
        if (ltrStyle.left !== undefined) {
          flipped.right = ltrStyle.left;
          flipped.left = undefined;
        }
        if (ltrStyle.right !== undefined) {
          flipped.left = ltrStyle.right;
          flipped.right = undefined;
        }
        if (ltrStyle.textAlign === "left") flipped.textAlign = "right";
        if (ltrStyle.textAlign === "right") flipped.textAlign = "left";
        if (ltrStyle.borderLeftWidth !== undefined) {
          flipped.borderRightWidth = ltrStyle.borderLeftWidth;
          flipped.borderLeftWidth = undefined;
        }
        if (ltrStyle.borderRightWidth !== undefined) {
          flipped.borderLeftWidth = ltrStyle.borderRightWidth;
          flipped.borderRightWidth = undefined;
        }
        return flipped;
      },
    [isRtl]
  );
}
