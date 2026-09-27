import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useRolesStore } from "@/stores/rolesStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useCartStore } from "@/stores/cartStore";
import { getPendingCount, syncPendingOperations } from "@/lib/offlineQueue";
import { clearNav } from "@/lib/navContext";
import type { MembershipRole, MembershipStatus } from "@/types";

/**
 * THE client owner of "which shop am I working in".
 *
 * There is exactly one, and it never invents a value: `load()` takes the answer from
 * `get_my_shops()` — the database decides, because that is what every read and write is
 * already scoped by — and nothing about the active shop is persisted locally. A reload, a
 * reopened tab or a restarted app therefore resolves the shop the server says, never a
 * remembered one. (`authStore.user.tenantId` seeds the first paint: it came from the same
 * server at sign-in.)
 *
 * A switch resets everything the previous shop put in memory before it reads the new one.
 * That order matters: reloading alone would leave the old shop's rows on screen for as long
 * as the fetch takes, and a screen that is only *mostly* re-derived is how Shop A's data
 * ends up under Shop B's name. The cached business rows go with it — the cache is keyed by
 * `tenantId:userId` through `adoptCacheOwner`, so signing the new tenant into the auth store
 * drops them all.
 */

export interface ShopSummary {
  id: string;
  name: string;
  membershipRole: MembershipRole;
  membershipStatus: MembershipStatus;
  isCurrent: boolean;
}

/** What the caller can be told about a failed action, so the screen owns the wording. */
export type ShopErrorCode =
  | "name_required"
  | "pending_sync"
  | "switch_failed"
  | "create_failed"
  /** The server refused because this membership is not an owner/admin of the shop. */
  | "denied";

export interface ShopActionResult {
  ok: boolean;
  code?: ShopErrorCode;
}

interface ShopRow {
  shop_id: string;
  name: string;
  membership_role: MembershipRole;
  membership_status: MembershipStatus;
  is_current: boolean;
}

interface ShopState {
  shops: ShopSummary[];
  /** Which shop every read and write in the app is scoped to. */
  activeShopId: string | null;
  activeShopName: string | null;
  loading: boolean;
  /**
   * True once the server has answered which shops this account is in. The shell needs to know
   * the difference between "we have not asked yet" and "the answer was: none" — without it, a
   * brand-new account was shown an empty app instead of being told it has no shop.
   */
  loaded: boolean;
  /** Whose list `shops` is. A stale answer must never be read as the new account's. */
  ownerId: string | null;
  switching: boolean;
  creating: boolean;
  error: string | null;
  /**
   * Whether the shop selector is showing. It lives here rather than in each screen so the
   * selector has exactly one mount (the shell) and one way in — a page asks the shop owner
   * of the context to open it instead of mounting a second copy of it.
   */
  switcherOpen: boolean;
  openSwitcher: () => void;
  closeSwitcher: () => void;
  /** Confirm the active shop with the server and list the caller's shops. */
  load: () => Promise<void>;
  switchTo: (shopId: string) => Promise<ShopActionResult>;
  create: (name: string) => Promise<ShopActionResult>;
}

/** The products/customers/sales/… of the shop we are leaving must not survive the switch. */
function resetShopScopedStores(): void {
  useProductsStore.getState().reset();
  useCustomersStore.getState().reset();
  useSalesStore.getState().reset();
  useCompaniesStore.getState().reset();
  useEmployeesStore.getState().reset();
  useRolesStore.getState().reset();
  useNotificationStore.getState().reset();
  // A half-filled sale belongs to the shop it was started in.
  useCartStore.getState().clearCart();
  // The back stack pointed at screens of the shop we are leaving.
  clearNav();
}

async function loadPermissions(): Promise<string[]> {
  try {
    const { data } = await supabase.rpc("get_my_permissions");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Adopt a shop as the active context, in one step.
 *
 * The auth store write is not bookkeeping: `tenantId` is what `src/lib/tenantContext.ts`
 * reads, what the cached business rows are owned by, and what the sign-in lookup returns —
 * so it has to move with the shop, and its `adoptCacheOwner` call is what drops the previous
 * shop's cached rows. The permissions are re-read because they are the caller's role in
 * *this* shop.
 */
async function adoptShop(shopId: string, shopName: string, role: MembershipRole): Promise<void> {
  const { user, setUser } = useAuthStore.getState();
  if (user) {
    setUser({
      ...user,
      tenantId: shopId,
      membershipRole: role,
      permissions: await loadPermissions(),
    });
  }
  resetShopScopedStores();
  useShopStore.setState({ activeShopId: shopId, activeShopName: shopName, error: null });
}

export const useShopStore = create<ShopState>((set, get) => ({
  shops: [],
  // Seeded from the membership the server returned at sign-in; confirmed by load().
  activeShopId: useAuthStore.getState().user?.tenantId ?? null,
  activeShopName: null,
  loading: false,
  loaded: false,
  ownerId: null,
  switching: false,
  creating: false,
  error: null,
  switcherOpen: false,

  openSwitcher: () => set({ switcherOpen: true }),
  closeSwitcher: () => set({ switcherOpen: false }),

  /**
   * Ask the database which shop this account is working in, and take its answer.
   *
   * Called when the shell mounts — so a reload, a reopened tab or a restarted app ends up in
   * the shop the server says, not in whatever this device last wrote. The device's remembered
   * shop is only a first-paint guess, and when it disagrees with the server (another device
   * switched, a membership was suspended, an invite was accepted elsewhere) the server wins
   * *through `adoptShop`*, which re-keys the cached rows to the shop that is really active —
   * a plain label update would leave the previous shop's cached rows readable under the
   * previous shop's owner key, which is how the wrong rows reappear after a switch.
   */
  load: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase.rpc("get_my_shops");
    if (error) {
      set({ loading: false, error: "load_failed" });
      return;
    }
    const shops: ShopSummary[] = ((data as ShopRow[]) ?? []).map((r) => ({
      id: r.shop_id,
      name: r.name,
      membershipRole: r.membership_role,
      membershipStatus: r.membership_status,
      isCurrent: r.is_current,
    }));
    // Only a membership the database considers usable can be the shop this session works in.
    // Every read and write requires status = 'active', so adopting a suspended (or still
    // pending) row here would name a shop in the header while each query underneath it was
    // refused — the screen would look empty for no visible reason. When nothing is usable the
    // shell says so instead (ShopAccessNotice), and the list below still shows the row.
    const active = shops.filter((s) => s.membershipStatus === "active");
    const current = active.find((s) => s.isCurrent) ?? active[0] ?? null;

    if (current && useAuthStore.getState().user?.tenantId !== current.id) {
      await adoptShop(current.id, current.name, current.membershipRole);
    }

    set({
      shops,
      loading: false,
      loaded: true,
      ownerId: useAuthStore.getState().user?.id ?? null,
      error: null,
      activeShopId: current?.id ?? null,
      activeShopName: current?.name ?? null,
    });
  },

  switchTo: async (shopId) => {
    if (shopId === get().activeShopId) return { ok: true };

    // Queued offline writes carry no shop of their own: they are replayed with whatever
    // is active when they are sent. Switching while any are pending would land one shop's
    // sale in another, so they must go first.
    if (getPendingCount() > 0) {
      await syncPendingOperations(supabase).catch(() => undefined);
      if (getPendingCount() > 0) return { ok: false, code: "pending_sync" };
    }

    set({ switching: true, error: null });
    const { data, error } = await supabase.rpc("set_active_shop", { p_shop_id: shopId });
    if (error || !data?.success) {
      set({ switching: false, error: "switch_failed" });
      return { ok: false, code: "switch_failed" };
    }

    await adoptShop(shopId, data.shop_name ?? "", data.membership_role ?? "employee");
    set({ switching: false });
    // Reconcile the list with the server (which row is current) without blocking the switch.
    void get().load();
    return { ok: true };
  },

  create: async (name) => {
    const clean = name.trim();
    if (!clean) return { ok: false, code: "name_required" };

    set({ creating: true, error: null });
    const { data, error } = await supabase.rpc("create_shop_for_me", { p_name: clean });
    if (error || !data?.success) {
      // A refusal is not a network problem and must not be reported as one: the role that
      // came back with the membership was stale, and the honest answer is who may create a
      // shop, not "try again".
      const denied = /NOT_AUTHORIZED/i.test(`${error?.message ?? ""}${error?.details ?? ""}`);
      set({ creating: false, error: denied ? "denied" : "create_failed" });
      return { ok: false, code: denied ? "denied" : "create_failed" };
    }

    // The server also makes the new shop active; adopt it here so the app agrees at once.
    await adoptShop(data.shop_id, data.shop_name ?? clean, data.membership_role ?? "owner");
    set({ creating: false });
    void get().load();
    return { ok: true };
  },
}));
