import { useEffect } from "react";
import { tNow } from "@/lib/i18n";
import { useUIStore } from "@/stores/uiStore";
import { useOfflineStore } from "@/stores/offlineStore";

/**
 * The two moments the shopkeeper has to hear about.
 *
 * Going offline is the one case where the app keeps accepting work it cannot send, so it says so
 * once, plainly, in the language the screen is in. Coming back is the moment that justifies it:
 * the queue drains and the toast says how many changes actually reached the server ("7 changes
 * synced") rather than a vague "back online" that leaves the person wondering whether the sale
 * they typed on the bus exists. The count comes from the drain itself, never from a guess.
 *
 * Both shells call this instead of each keeping its own copy of the same listeners — the employee
 * shell used to show hardcoded English here while the admin shell showed translated copy.
 */
export function useConnectivityToasts(): void {
  const addToast = useUIStore((s) => s.addToast);
  const setOnline = useOfflineStore((s) => s.setOnline);
  const syncQueue = useOfflineStore((s) => s.syncQueue);

  useEffect(() => {
    let alive = true;

    const handleOnline = async () => {
      // `setOnline(true)` starts the drain by itself; `syncQueue` hands back that same run.
      setOnline(true);
      const result = await syncQueue();
      if (!alive) return;
      const synced = result?.synced ?? 0;
      if (synced > 0) addToast(tNow("copy.syncedChanges", { count: String(synced) }), "success");
      else addToast(tNow("copy.backOnline"), "success");
    };

    const handleOffline = () => {
      setOnline(false);
      addToast(tNow("copy.wentOffline"), "warning");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      alive = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [addToast, setOnline, syncQueue]);
}
