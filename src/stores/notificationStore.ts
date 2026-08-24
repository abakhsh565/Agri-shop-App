import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";

// One shared Realtime channel across all subscribers (see `subscribe` below).
let sharedChannel: RealtimeChannel | null = null;
let subscriberCount = 0;

// Kinds an employee is allowed to see. Kept in sync with the persona-aware
// `notifications_read` RLS policy (migration 0006) as defense-in-depth: the DB
// already filters both the initial query and the Realtime stream, but we also
// guard client-side so an employee's bell never surfaces an admin-only event.
const EMPLOYEE_KINDS = new Set(["sale", "payment", "return", "stock_adjust", "low_stock"]);

// Kinds that are trivial / noise — admin doesn't need to see these.
const TRIVIAL_KINDS = new Set(["profile_update", "app_update", "settings_change"]);

function visibleToCurrentUser(row: AppNotification): boolean {
  const state = useAuthStore.getState();
  const role = state.user?.role;
  const userId = state.user?.id;

  // Admin: sees everything except trivial / private notifications
  if (role === "admin" || role === "co_admin") {
    // Admin should NOT see profile_update, settings_change, app_update from OTHER employees
    // (private activity stays private). They DO see business-impacting events from everyone.
    if (row.kind === "profile_update" || row.kind === "settings_change") {
      // Only show if admin acted (own profile) or it's their own notification
      return row.actor_id === userId;
    }
    if (row.kind === "app_update") return false; // system noise
    return true; // sale, payment, return, purchase, stock_adjust, low_stock → always visible to admin
  }

  // Employee: sees only own notifications + system-wide business alerts
  if (!EMPLOYEE_KINDS.has(row.kind)) return false;

  // System-wide notifications (low_stock, stock_adjust) are visible to all employees
  if (row.kind === "low_stock" || row.kind === "stock_adjust") return true;

  // For personal business events (sale, payment, return): only show if the employee is the actor
  if (row.actor_id && userId) {
    return row.actor_id === userId;
  }
  // Fallback: if no actor_id, show nothing for employees (safety)
  return false;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  entity_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  read: boolean;
  created_at: string;
}

interface NotificationState {
  items: AppNotification[];
  loading: boolean;
  ready: boolean;            // false until the backend table exists / first load done
  error: string | null;
  unread: () => number;
  load: () => Promise<void>;
  subscribe: () => () => void;
  markAllRead: () => Promise<void>;
}

/**
 * Live feed of shop events (new sales, payments, etc.) for admins/owners.
 * Backed by the Supabase `notifications` table with a Realtime subscription so
 * a sale made on one device shows on the admin's device instantly. Degrades
 * gracefully (empty, no crash) if the table hasn't been created yet.
 */
export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  loading: false,
  ready: false,
  error: null,

  unread: () => get().items.filter((n) => !n.read).length,

  load: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      // Most likely the migration hasn't been run yet — show empty, not broken.
      set({ loading: false, ready: true, error: error.message, items: [] });
      return;
    }
    const all = (data as AppNotification[]) ?? [];
    set({ items: all.filter(visibleToCurrentUser), loading: false, ready: true });
  },

  // Ref-counted singleton Realtime subscription. Multiple components (the admin
  // notifications page AND the employee dashboard bell) subscribe to the same
  // feed; a Supabase channel can only be `.subscribe()`d once, so we share one
  // channel and only tear it down when the last subscriber unmounts. This also
  // survives React's dev-mode double-mount without throwing "cannot add
  // postgres_changes callbacks ... after subscribe()".
  subscribe: () => {
    subscriberCount += 1;

    if (!sharedChannel) {
      sharedChannel = supabase
        .channel("notifications-feed")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications" },
          (payload) => {
            const row = payload.new as AppNotification;
            if (!visibleToCurrentUser(row)) return;
            set((s) => ({ items: [row, ...s.items] }));
          },
        )
        .subscribe();
    }

    return () => {
      subscriberCount -= 1;
      if (subscriberCount <= 0 && sharedChannel) {
        supabase.removeChannel(sharedChannel);
        sharedChannel = null;
        subscriberCount = 0;
      }
    };
  },

  markAllRead: async () => {
    const unreadIds = get().items.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })) }));
    await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
  },
}));
