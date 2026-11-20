import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import {
  syncPendingOperations,
  getPendingCount,
} from "@/lib/offlineQueue";

interface OfflineState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncAt: string | null;
  /** Number of queued write operations (sales, customers, etc.) */
  pendingOpsCount: number;
  setOnline: (online: boolean) => void;
  setSyncing: (v: boolean) => void;
  /** How many queued writes reached the server, so the toast can say "7 changes synced". */
  syncQueue: () => Promise<{ synced: number; failed: number } | null>;
}

/**
 * One sync at a time, one answer for every caller.
 *
 * `setOnline(true)` starts a sync on its own, and the connectivity toast then asks for the
 * result; two separate runs would either block the second (the old `isSyncing` guard returned
 * `undefined`) or drain the queue twice. Callers that arrive while a drain is running wait for
 * the same drain and read the same count.
 */
let inflightSync: Promise<{ synced: number; failed: number } | null> | null = null;

export const useOfflineStore = create<OfflineState>()((set, get) => ({
  isOnline: navigator.onLine,
  isSyncing: false,
  lastSyncAt: null,
  pendingOpsCount: getPendingCount(),

  setOnline: (isOnline) => {
    const wasOffline = !get().isOnline;
    set({ isOnline });

    // When coming back online, sync all pending operations
    if (isOnline && wasOffline) {
      get().syncQueue();
    }
  },

  setSyncing: (isSyncing) => set({ isSyncing }),

  syncQueue: () => {
    if (inflightSync) return inflightSync;
    if (!navigator.onLine) return Promise.resolve(null);
    set({ isSyncing: true });

    inflightSync = (async () => {
    try {
      // Sync all pending write operations (sales, customers, notifications, etc.)
      const result = await syncPendingOperations(supabase);

      if (result.synced > 0) {
        // Refresh local caches after successful sync using dynamic imports
        const { useProductsStore } = await import("@/stores/productsStore");
        const { useCustomersStore } = await import("@/stores/customersStore");
        const { useSalesStore } = await import("@/stores/salesStore");
        const { useNotificationStore } = await import("@/stores/notificationStore");

        await Promise.allSettled([
          useProductsStore.getState().load(),
          useCustomersStore.getState().load(),
          useSalesStore.getState().load(),
          useNotificationStore.getState().load(),
        ]);
      }

      set({
        lastSyncAt: new Date().toISOString(),
        pendingOpsCount: getPendingCount(),
      });
      return result;
    } catch {
      // Sync failed — will retry on next online event
      return null;
    } finally {
      set({ isSyncing: false });
    }
    })().finally(() => {
      inflightSync = null;
    });

    return inflightSync;
  },
}));
