import { useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { isDashboardPath, navigateBack } from "@/lib/navContext";
import { WORKSPACE_BOARDS } from "@/lib/navigation";
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
 * - On a signed-out step: walk to the explicit parent route, never decrement unguarded history
 * - On other screens: the same module-aware hierarchy as the header Back arrow
 */
export default function BackButtonHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const lastBackPress = useRef(0);
  const { addToast } = useUIStore();
  const locationRef = useRef({ pathname: location.pathname, search: location.search });
  locationRef.current = { pathname: location.pathname, search: location.search };

  const handleBack = useCallback(async () => {
    const current = locationRef.current;
    const path = current.pathname;

    if (isDashboardPath(path) || FRONT_DOOR_PATHS.has(path)) {
      const now = Date.now();
      if (now - lastBackPress.current < 2500) {
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
      navigateBack(current, navigate, path.startsWith("/register") ? "/register" : "/login");
      return;
    }

    // Signed in: retrace the module's child screens. At its root, the shared handler uses
    // history -1 when possible (returning to More); a cold entry falls back to the board.
    if (!navigateBack(current, navigate)) {
      const board = path.startsWith("/admin")
        ? WORKSPACE_BOARDS.admin
        : path.startsWith("/co-owner")
          ? WORKSPACE_BOARDS["co-owner"]
          : WORKSPACE_BOARDS.employee;
      navigate(board, { replace: true });
    }
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
