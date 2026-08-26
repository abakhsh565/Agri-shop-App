import { RouterProvider } from "react-router-dom";
import { router } from "@/router";
import { useEffect } from "react";
import { useThemeStore, applyTheme } from "@/stores/themeStore";
import { Agentation } from "agentation";

export default function App() {
  const { theme } = useThemeStore();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div
      className="app-shell-bg flex justify-center"
      style={{ background: "var(--surface-3)", minHeight: "100dvh" }}
    >
      <div
        className="app-frame w-full max-w-[480px] relative overflow-hidden shadow-2xl"
        style={{ background: "var(--background)", minHeight: "100dvh" }}
      >
        <RouterProvider router={router} />
      </div>
      <Agentation />
    </div>
  );
}
