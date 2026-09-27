import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types";
import { signOut } from "@/lib/auth";
import { adoptCacheOwner } from "@/lib/localCache";
import { supabase, supabaseUrl } from "@/lib/supabase";

/**
 * The `iss` claim of a JWT, without verifying it — we only need to know which Supabase
 * project minted the session we are holding.
 */
function issuerOf(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    );
    return typeof json.iss === "string" ? json.iss.replace(/\/$/, "") : null;
  } catch {
    return null; // unreadable token: leave the decision to the session check above
  }
}

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

// Who is allowed to read the cached business rows on this device.
const ownerIdFor = (user: User | null) =>
  user ? `${user.tenantId ?? "none"}:${user.id}` : "signed-out";

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
  /** Confirm the device still holds a live server session (see below). */
  verifySession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLocked: false,
      pendingPhone: readPendingPhone(),
      pendingFlow: null,
      isNewDevice: false,
      // Signing in ends the pending flow, so the in-progress phone is dropped.
      setUser: (user) => {
        if (user) writePendingPhone("");
        // Cached business rows must belong to whoever is signed in now.
        adoptCacheOwner(ownerIdFor(user));
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
      // `agri_auth` only remembers that this device signed in once. It is not
      // proof that the server still accepts the credential: when the Supabase
      // session expires (or its refresh token is rotated away), every request
      // comes back "permission denied" while the stored user still satisfies the
      // route guard. The app then keeps painting its last cached rows as though
      // they were live — the shop sees sales and customers the server no longer
      // has. So on launch the stored user is checked against the real session,
      // and a device without one is signed out instead of showing stale data.
      verifySession: async () => {
        if (!get().user) return;
        try {
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            // No session is NOT a reason to sign out any more. A session can be absent simply
            // because the phone has not been online since the token lapsed, and signing out
            // there threw away the stored identity, the cached rows and the PIN's only route
            // back in — the owner's next launch was a fresh sign-in with a code.
            //
            // Re-establishing is attempted by getUserFromSession, which is what the splash
            // screen already calls; the one answer that still means "this account is gone" —
            // the server saying the profile is inactive — is handled there, where it can be
            // told apart from a network failure.
            return;
          }

          // A session issued by a *different* Supabase project can never authenticate
          // against this one: PostgREST refuses the JWT, and because refreshing fails
          // too, supabase-js keeps holding it. Every write made with it then affects zero
          // rows and answers 200, so the app reported success while the database never
          // changed — which is exactly how a saved profile photo reverted to initials on
          // the next launch. Drop the stale session and make the device sign in again.
          const issuer = issuerOf(data.session.access_token);
          if (issuer && issuer !== `${supabaseUrl}/auth/v1`) {
            console.warn("Stored session is from another project; signing out to re-authenticate.");
            get().logout();
            return;
          }


        } catch {
          // A throw here means the auth client could not be reached at all, which
          // is indistinguishable from a flaky connection. Keep the user signed in
          // and let the cached rows serve the offline case.
        }
      },
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
      // Launching with a stored session skips setUser, so re-claim the cache
      // here too — otherwise the guard only holds on an explicit sign-in.
      onRehydrateStorage: () => (state) => {
        if (state?.user) adoptCacheOwner(ownerIdFor(state.user));
      },
    }
  )
);
