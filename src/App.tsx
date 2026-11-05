import { RouterProvider } from "react-router-dom";
import { router } from "@/router";
import { useEffect } from "react";
import { useThemeStore, applyTheme, applyDirection } from "@/stores/themeStore";
import { Dir } from "@/lib/dirContext";

import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { Capacitor } from "@capacitor/core";
import { parseInviteLink, inviteSearchParams } from "@/lib/deepLink";
import { logEnvironmentInfo } from "@/lib/envGuard";
import { useAuthStore } from "@/stores/authStore";

const isNative = Capacitor.isNativePlatform();

// Log environment on startup — never hides which project we're connected to
logEnvironmentInfo();

export default function App() {
  const { theme, language } = useThemeStore();

  useEffect(() => {
    applyTheme(theme);
    applyDirection(language);
  }, [theme, language]);

  // A stored user is a hint, not a session. If the server no longer accepts this
  // device's credential, sign out on launch rather than rendering cached rows as
  // if they were current.
  useEffect(() => {
    void useAuthStore.getState().verifySession();
    // The stored user also carries the permissions it was signed in with. An owner who
    // changed an employee's access since then is a fact the server has and this device does
    // not, so ask again on launch — otherwise the employee's screen keeps offering work the
    // server has stopped accepting (and hides what was just granted) until a full relaunch.
    void useAuthStore.getState().refreshPermissions();
  }, []);

  // Coming back to the app is the other moment the answer can have changed: a shop phone
  // stays open on the counter all day, so launch alone would never notice a permission the
  // owner granted (or took away) mid-shift.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void useAuthStore.getState().refreshPermissions();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  /**
   * An invitation arriving as a link.
   *
   * Native only: on the web the link IS the app's own URL, so the browser has already routed
   * it and there is nothing to intercept. Both delivery paths are handled — `appUrlOpen` for
   * a link tapped while the app is running, and `getLaunchUrl` for one that cold-starts it.
   * Handling only the first would leave the commoner case (app not open yet) doing nothing at
   * all: the app would open on the splash, fall through to sign-in, and show an empty form.
   *
   * The plugin is imported dynamically so it stays out of the web bundle, where nothing can
   * ever fire it.
   *
   * NOTE: this only fires once the manifest declares the incoming link — the app scheme and,
   * for https, the App Link filter that requires a verified domain.
   */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let removeListener: (() => void) | undefined;

    const openTarget = (rawUrl: string) => {
      const target = parseInviteLink(rawUrl);
      if (!target) return;
      const query = inviteSearchParams(target);
      void router.navigate(query ? `${target.path}?${query}` : target.path);
    };

    void (async () => {
      const { App } = await import("@capacitor/app");
      const launch = await App.getLaunchUrl();
      if (!cancelled && launch?.url) openTarget(launch.url);

      const handle = await App.addListener("appUrlOpen", (event) => openTarget(event.url));
      if (cancelled) void handle.remove();
      else removeListener = () => void handle.remove();
    })();

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, []);

  return (
    <div
      className="app-shell-bg flex justify-center"
      style={{ background: "var(--surface-3)", minHeight: "100dvh" }}
    >
      {/*
        The frame is the viewport, not a box that grows past it.
        It used to be `min-height: 100dvh` with `overflow-hidden`, so a screen whose content
        was a few pixels over the viewport — or a browser reporting a slightly larger `dvh` —
        pushed the page itself taller and the whole app scrolled, with empty space below it.
        Now the frame is exactly `100dvh` and scrolls inside itself only when a screen genuinely
        has more content than the window; every scrolling app shell (Admin, Employee) already
        keeps its own scroll area, so nothing changes for them.
      */}
      <div
        className="app-frame w-full max-w-[480px] relative overflow-y-auto overflow-x-hidden shadow-2xl"
        style={{ background: "var(--background)", height: "100dvh" }}
      >
        <ErrorBoundary><Dir><RouterProvider router={router} /></Dir></ErrorBoundary>
      </div>
      {/*
        NOTE: an agent-annotation overlay (`agentation`) used to mount here, guarded only by
        `!isNative`. That guard hid it on the phone but not in a browser, so real users saw a
        "v3.0.2" badge, a floating control cluster and its own unlabelled inputs on every
        screen — and because the import was static it was bundled into the production build
        and the APK assets as well.

        It is developer tooling, not a product feature, so it is out of the app's runtime
        graph entirely. The package is still installed as a devDependency: to use it while
        working, import it from a local scratch file or re-add a DEV-guarded mount here.
      */}
    </div>
  );
}
