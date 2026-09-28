import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { shopRoleOf } from "@/lib/shopRoles";

// One shared Realtime channel across all subscribers (see `subscribe` below).
let sharedChannel: RealtimeChannel | null = null;
let subscriberCount = 0;
let pollingInterval: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Kinds an employee is allowed to see. Kept in step with the persona-aware rules: the
 * database already scopes rows to the shops the account belongs to, and this narrows an
 * employee's view inside their own shop, so a bell never surfaces an owner-only event.
 */
const EMPLOYEE_KINDS = new Set(["sale", "payment", "return", "stock_adjust", "low_stock"]);

/** Kinds that are an employee's own activity rather than the shop's business. */
const PERSONAL_KINDS = new Set(["sale", "payment", "return"]);

/**
 * Kinds that are an account's own private activity. An owner sees their own and never
 * another person's — "your profile was updated" is nobody else's business.
 */
const PRIVATE_KINDS = new Set(["profile_update", "settings_change"]);

/**
 * System noise. Nobody is shown these, owner or not, and the actor does not matter: an
 * "app was updated" row in a shop's feed is a message about the software, on a screen the
 * owner opened to find out about their BUSINESS.
 */
const SYSTEM_KINDS = new Set(["app_update"]);

/**
 * Should this row be shown to the account signed in?
 *
 * Which ROWS exist is the database's answer (migration 0168 scopes both the read and the
 * Realtime stream to the shops the account is an active member of). This is the second
 * half of the rule, and it is about *who within a shop* hears what:
 *
 *   • an owner/admin hears every business event in every branch they belong to;
 *   • an employee hears the shop-wide alerts (stock levels) and their OWN business
 *     events — not a colleague's sale, and not the owner's settings changes.
 *
 * `actor_id` is what makes the employee half real. The row it compares against has
 * existed since 0168; before that the column was missing, every employee row looked
 * anonymous, and the fallback below silenced all of them.
 *
 * @param roleByShop the highest role this account holds in each shop, when known. Used
 *   so an account that is an employee in one branch and an owner in another is judged by
 *   the role it holds in the row's own branch. Defaults to the map the branch list last
 *   reported (`lib/shopRoles`), and only then to the account-level role.
 */
export function visibleToCurrentUser(
  row: AppNotification,
  roleByShop?: Record<string, string | undefined>,
): boolean {
  const state = useAuthStore.getState();
  const accountRole = state.user?.role;
  const userId = state.user?.id;

  // The role that matters is the one held where the event happened. "An owner somewhere"
  // is not the same permission as "an owner here", and reading the account's single role
  // would hand an owner of one branch the owner's view of a branch they only work in.
  const roleHere = (row.shop_id
    ? roleByShop?.[row.shop_id] ?? shopRoleOf(row.shop_id)
    : undefined
  ) ?? accountRole;
  const isOwnerHere = roleHere === "admin" || roleHere === "owner";

  if (!isOwnerHere) {
    if (!EMPLOYEE_KINDS.has(row.kind)) return false;
    // A shop-wide alert is everyone's business; a personal event is not.
    if (!PERSONAL_KINDS.has(row.kind)) return true;
    if (row.actor_id && userId) return row.actor_id === userId;
    // No actor recorded: this is not provably the caller's own action, so it is not
    // shown. Silence is the safe answer; showing a colleague's sale is not.
    return false;
  }

  if (SYSTEM_KINDS.has(row.kind)) return false;

  // Owner of this branch: their own activity always shows, another person's private
  // activity never does.
  if (PRIVATE_KINDS.has(row.kind)) return row.actor_id === userId;
  return true;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  /** Which branch (shop) this happened in. Stamped by the database, not the caller. */
  shop_id: string | null;
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
  /** Unread count, optionally for one branch only. */
  unread: (shopId?: string | null) => number;
  /** The rows of one branch, newest first. `null` means every branch. */
  forShop: (shopId: string | null) => AppNotification[];
  load: () => Promise<void>;
  subscribe: () => () => void;
  markAllRead: () => Promise<void>;
  /**
   * Mark a named set read. "Mark all read" on a screen that is showing ONE branch must
   * mean that branch's rows — marking every branch from a filtered view would clear a
   * badge the owner never looked at, which is losing work rather than doing any.
   */
  markManyRead: (ids: string[]) => Promise<void>;
  markOneRead: (id: string) => Promise<void>;
  /** Drop every row: the app is about to read a different shop. */
  reset: () => void;
}

/**
 * Live feed of shop events (new sales, payments, etc.) for owners and employees.
 *
 * Two facts about the shape of this data, both learned the hard way and both encoded
 * here so a screen cannot get it wrong:
 *
 *   1. **A row belongs to one branch.** `shop_id` is stamped by the database when the
 *      row is written (`notifications_stamp`, 0168), so Home can show exactly its own
 *      branch's events and the Notifications screen can group by branch without any
 *      client-side guess about where something happened.
 *   2. **Which rows arrive at all is the database's answer.** RLS (0168) returns only
 *      the shops this account is an active member of — an owner gets every branch they
 *      run, an employee gets their own shop and nothing else.
 *
 * The store itself keeps every row it is given: Home filters to one branch, the
 * Notifications screen reads all of them. Filtering here instead would mean switching
 * branches to see another branch's events, which is the opposite of what a single device
 * with several branches needs.
 */
export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  loading: false,
  ready: false,
  error: null,

  // The active shop changed: another shop's events are not this shop's.
  reset: () => set({ items: [], loading: false, ready: false, error: null }),

  unread: (shopId) =>
    get().items.filter((n) => !n.read && (!shopId || n.shop_id === shopId)).length,

  forShop: (shopId) =>
    shopId ? get().items.filter((n) => n.shop_id === shopId) : get().items,

  load: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      // Most likely the read was refused, or the table is not there yet — show empty,
      // not broken. The reason is kept so a screen can say something truthful.
      set({ loading: false, ready: true, error: error.message, items: [] });
      return;
    }
    const all = (data as AppNotification[]) ?? [];
    set({ items: all.filter((row) => visibleToCurrentUser(row)), loading: false, ready: true });
  },

  // Ref-counted singleton Realtime subscription. Multiple components (the owner's
  // notifications page AND the Home bell) subscribe to the same feed; a Supabase channel
  // can only be `.subscribe()`d once, so we share one channel and only tear it down when
  // the last subscriber unmounts. This also survives React's dev-mode double-mount
  // without throwing "cannot add postgres_changes callbacks ... after subscribe()".
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
            // A Realtime payload is delivered on every device watching the table; the
            // same row can also arrive from the poll below, so an id already in the
            // list is replaced rather than duplicated.
            set((s) => ({ items: [row, ...s.items.filter((n) => n.id !== row.id)] }));
          },
        )
        .subscribe();
    }

    // Polling fallback: Realtime may not be enabled on all Supabase projects.
    // Poll every 30s to catch any missed INSERT events.
    if (!pollingInterval) {
      pollingInterval = setInterval(() => {
        get().load();
      }, POLL_INTERVAL_MS);
    }

    return () => {
      subscriberCount -= 1;
      if (subscriberCount <= 0) {
        if (sharedChannel) {
          supabase.removeChannel(sharedChannel);
          sharedChannel = null;
        }
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
        subscriberCount = 0;
      }
    };
  },

  markAllRead: async () => {
    await get().markManyRead(get().items.filter((n) => !n.read).map((n) => n.id));
  },

  markManyRead: async (ids) => {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    set((s) => ({ items: s.items.map((n) => (wanted.has(n.id) ? { ...n, read: true } : n)) }));
    await supabase.from("notifications").update({ read: true }).in("id", ids);
  },

  markOneRead: async (id: string) => {
    const item = get().items.find((n) => n.id === id);
    if (!item || item.read) return;
    set((s) => ({ items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  },
}));
