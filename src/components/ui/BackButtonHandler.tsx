import { useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { isDashboardPath, clearNav, popNav, setSkipNext } from "@/lib/navContext";
import { tNow } from "@/lib/i18n";
import { useUIStore } from "@/stores/uiStore";

/**
 * Screens with nothing behind them: the app's own front doors. Pressing back here can only
 * mean "leave the app", and leaving takes two presses in a row — the same rule as the
 * dashboard, so the one action that cannot be undone cannot happen from a slip either.
 *
 * `/login/pin` is included because splash lands there directly; it is the returning user's
 * front door, not a step behind which a half-finished flow is waiting.
 */
const FRONT_DOOR_PATHS = new Set(["/", "/welcome", "/login", "/login/pin", "/register"]);

/** Any signed-out screen — sign-in, its sub-steps, sign-up and the introduction. */
function isSignedOutPath(path: string): boolean {
  return (
    path.startsWith("/login") || path.startsWith("/register") || path.startsWith("/welcome")
  );
}

/**
 * Handles the Android hardware back button.
 *
 * - On dashboard or a front door: show "Press back again to exit" toast, then exit on second press
 * - On a signed-out step (code screen, forgotten PIN, sign-up form): go back a step, never close
 *   the app mid-flow and never drop what was typed
 * - On other screens: navigate back within the current flow
 *
 * Without a listener registered, Android's own behaviour applies and the app closes on the
 * first press — which is what used to happen on every signed-out screen, because this handler
 * was only mounted inside the two signed-in shells.
 */
export default function BackButtonHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const lastBackPress = useRef(0);
  const { addToast } = useUIStore();
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  const handleBack = useCallback(async () => {
    const path = locationRef.current;

    if (isDashboardPath(path) || FRONT_DOOR_PATHS.has(path)) {
      const now = Date.now();
      if (now - lastBackPress.current < 2500) {
        // Second press within 2.5s — exit the app
        try {
          await App.exitApp();
        } catch {
          // Not native — ignore
        }
      } else {
        lastBackPress.current = now;
        addToast(tNow("copy.pressBackAgain"), "info");
      }
      return;
    }

    if (isSignedOutPath(path)) {
      // A step inside sign-in or sign-up: back walks out of it instead of closing the app.
      // The stack is the browser's, so a deep link (nothing behind it) falls back to the
      // first screen of the flow it belongs to rather than doing nothing at all.
      if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate(path.startsWith("/register") ? "/register" : "/login", { replace: true });
      }
      return;
    }

    // Signed in and inside the app: the hardware back retraces the reader's own path, one
    // step at a time — the same rule the header's arrow follows (owner's instruction,
    // 2026-10-29). Jumping straight to the dashboard threw away every step in between and
    // dropped the reader out of whatever sub-screen they were working in.
    const from = popNav(path);
    if (from && from !== path) {
      setSkipNext();
      navigate(from, { replace: true });
      return;
    }

    // Nothing behind this screen (a deep link or a cold start): the dashboard is the floor.
    clearNav();
    const role = path.startsWith("/admin")
      ? "/admin"
      : path.startsWith("/co-owner")
        ? "/co-owner"
        : "/employee";
    navigate(role + "/dashboard", { replace: true });
  }, [navigate, addToast]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const listener = App.addListener("backButton", handleBack);
    return () => {
      listener.then((l) => l.remove());
    };
  }, [handleBack]);

  return null;
}
