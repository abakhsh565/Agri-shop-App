import { RouterProvider } from "react-router-dom";
import { router } from "@/router";
import { useEffect } from "react";
import { useThemeStore, applyTheme, applyDirection } from "@/stores/themeStore";
import { Dir } from "@/lib/dirContext";
import { Agentation } from "agentation";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { Capacitor } from "@capacitor/core";
import { logEnvironmentInfo } from "@/lib/envGuard";

const isNative = Capacitor.isNativePlatform();

// Log environment on startup — never hides which project we're connected to
logEnvironmentInfo();

export default function App() {
  const { theme, language } = useThemeStore();

  useEffect(() => {
    applyTheme(theme);
    applyDirection(language);
  }, [theme, language]);

  return (
    <div
      className="app-shell-bg flex justify-center"
      style={{ background: "var(--surface-3)", minHeight: "100dvh" }}
    >
      <div
        className="app-frame w-full max-w-[480px] relative overflow-hidden shadow-2xl"
        style={{ background: "var(--background)", minHeight: "100dvh" }}
      >
        <ErrorBoundary><Dir><RouterProvider router={router} /></Dir></ErrorBoundary>
      </div>
      {!isNative && <Agentation />}
    </div>
  );
}
