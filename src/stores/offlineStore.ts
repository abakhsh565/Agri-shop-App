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
  syncQueue: () => Promise<void>;
}

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

  syncQueue: async () => {
    if (get().isSyncing || !navigator.onLine) return;
    set({ isSyncing: true });

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
    } catch {
      // Sync failed — will retry on next online event
    } finally {
      set({ isSyncing: false });
    }
  },
}));
