import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Capacitor } from "@capacitor/core";

export type Theme = "light" | "dark";
export type Language = "en" | "ur";

interface ThemeState {
  theme: Theme;
  language: Language;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setLanguage: (l: Language) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "light",
      language: "en",
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      toggleTheme: () => {
        const next = get().theme === "light" ? "dark" : "light";
        set({ theme: next });
        applyTheme(next);
      },
      setLanguage: (language) => set({ language }),
    }),
    { name: "agrishop-theme" }
  )
);

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  syncStatusBar(theme);
}

/**
 * Keep the OS status-bar icons and the web/PWA chrome legible against the
 * current theme. On a real device (Capacitor) the icon *content* colour is set
 * so it always contrasts the app background: light theme → dark icons, dark
 * theme → light icons. On the web the `theme-color` meta is matched to the
 * in-app theme (the static metas in index.html only follow the OS scheme).
 */
function syncStatusBar(theme: Theme) {
  // Native: drive the status-bar content colour from the theme.
  if (Capacitor.isNativePlatform()) {
    void (async () => {
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        // Capacitor naming is inverted: Style.Light = dark icons (for a light
        // background); Style.Dark = light/white icons (for a dark background).
        await StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light });
      } catch {
        // status-bar plugin unavailable — safe to ignore
      }
    })();
  }

  // Web/PWA: match the browser chrome to the in-app theme.
  if (typeof document !== "undefined") {
    const color = theme === "dark" ? "#0a0a0a" : "#ffffff";
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((m) => m.setAttribute("content", color));
  }
}
