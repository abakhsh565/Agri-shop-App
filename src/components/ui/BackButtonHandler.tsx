import { useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { isDashboardPath, clearNav } from "@/lib/navContext";
import { tNow } from "@/lib/i18n";
import { useUIStore } from "@/stores/uiStore";

/**
 * Handles the Android hardware back button.
 *
 * - On dashboard: show "Press back again to exit" toast, then exit on second press
 * - On other screens: navigate back within the current flow
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

    if (isDashboardPath(path)) {
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

    // Not on dashboard — navigate to the dashboard (clear flow)
    clearNav();
    const role = path.startsWith("/admin") ? "/admin" : "/employee";
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
