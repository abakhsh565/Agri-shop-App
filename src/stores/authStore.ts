import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types";
import { signOut } from "@/lib/auth";

// The phone number a sign-in/registration is in progress for, kept for THIS TAB
// only. Without it a reload on the code screen bounced the owner right back to
// "enter your phone number" and made them start over — and on a slow rural
// connection mid-flow reloads are ordinary. sessionStorage, not localStorage:
// the flow should not outlive the tab, and a new tab should start clean.
const PENDING_PHONE_KEY = "agri_pending_phone";

function readPendingPhone(): string {
  try {
    return sessionStorage.getItem(PENDING_PHONE_KEY) ?? "";
  } catch {
    return ""; // storage blocked (private mode) — the flow still works in-memory
  }
}

function writePendingPhone(phone: string): void {
  try {
    if (phone) sessionStorage.setItem(PENDING_PHONE_KEY, phone);
    else sessionStorage.removeItem(PENDING_PHONE_KEY);
  } catch {
    // storage blocked — nothing to do, the in-memory store is the fallback
  }
}

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
      pendingPhone: readPendingPhone(),
      pendingFlow: null,
      isNewDevice: false,
      // Signing in ends the pending flow, so the in-progress phone is dropped.
      setUser: (user) => {
        if (user) writePendingPhone("");
        set({ user });
      },
      setPendingPhone: (pendingPhone) => {
        writePendingPhone(pendingPhone);
        set({ pendingPhone });
      },
      setPendingFlow: (pendingFlow) => set({ pendingFlow }),
      setIsNewDevice: (isNewDevice) => set({ isNewDevice }),
      lock: () => set({ isLocked: true }),
      unlock: () => set({ isLocked: false }),
      logout: () => {
        // End the Supabase Auth session too (fire-and-forget).
        void signOut();
        writePendingPhone("");
        set({ user: null, isLocked: false, pendingPhone: "", pendingFlow: null });
      },
    }),
    {
      name: "agri_auth",
      partialize: (s) => ({ user: s.user }),
    }
  )
);
