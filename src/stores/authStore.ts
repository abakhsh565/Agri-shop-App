import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types";
import { signOut } from "@/lib/auth";

interface AuthState {
  user: User | null;
  isLocked: boolean;
  pendingPhone: string;
  pendingFlow: "login" | "register" | "forgot_pin" | null;
  isNewDevice: boolean;
  setUser: (user: User | null) => void;
  setPendingPhone: (phone: string) => void;
  setPendingFlow: (flow: "login" | "register" | "forgot_pin" | null) => void;
  setIsNewDevice: (v: boolean) => void;
  lock: () => void;
  unlock: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isLocked: false,
      pendingPhone: "",
      pendingFlow: null,
      isNewDevice: false,
      setUser: (user) => set({ user }),
      setPendingPhone: (pendingPhone) => set({ pendingPhone }),
      setPendingFlow: (pendingFlow) => set({ pendingFlow }),
      setIsNewDevice: (isNewDevice) => set({ isNewDevice }),
      lock: () => set({ isLocked: true }),
      unlock: () => set({ isLocked: false }),
      logout: () => {
        // End the Supabase Auth session too (fire-and-forget).
        void signOut();
        set({ user: null, isLocked: false, pendingPhone: "", pendingFlow: null });
      },
    }),
    {
      name: "agri_auth",
      partialize: (s) => ({ user: s.user }),
    }
  )
);
