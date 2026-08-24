import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Sale } from "@/types";

export interface PendingSale {
  id: string;
  sale: Sale;
  queuedAt: string;
  retries: number;
}

interface OfflineState {
  isOnline: boolean;
  pendingQueue: PendingSale[];
  isSyncing: boolean;
  lastSyncAt: string | null;
  setOnline: (online: boolean) => void;
  enqueue: (sale: Sale) => void;
  dequeue: (id: string) => void;
  setSyncing: (v: boolean) => void;
  syncQueue: () => Promise<void>;
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      isOnline: navigator.onLine,
      pendingQueue: [],
      isSyncing: false,
      lastSyncAt: null,

      setOnline: (isOnline) => {
        set({ isOnline });
        if (isOnline && get().pendingQueue.length > 0) {
          get().syncQueue();
        }
      },

      enqueue: (sale) => {
        const item: PendingSale = {
          id: "pending-" + Date.now(),
          sale,
          queuedAt: new Date().toISOString(),
          retries: 0,
        };
        set({ pendingQueue: [...get().pendingQueue, item] });
      },

      dequeue: (id) =>
        set({ pendingQueue: get().pendingQueue.filter((p) => p.id !== id) }),

      setSyncing: (isSyncing) => set({ isSyncing }),

      syncQueue: async () => {
        const { pendingQueue, dequeue, setSyncing } = get();
        if (pendingQueue.length === 0 || !navigator.onLine) return;
        setSyncing(true);
        // TODO: replace with Supabase batch insert
        for (const item of pendingQueue) {
          await new Promise((r) => setTimeout(r, 200)); // simulate network
          dequeue(item.id);
        }
        set({ lastSyncAt: new Date().toISOString() });
        setSyncing(false);
      },
    }),
    {
      name: "agrishop-offline-queue",
      partialize: (s) => ({ pendingQueue: s.pendingQueue, lastSyncAt: s.lastSyncAt }),
    }
  )
);
