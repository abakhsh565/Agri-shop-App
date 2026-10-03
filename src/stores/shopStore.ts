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
import { setShopRolesByShop } from "@/lib/shopRoles";
import type { PickedPlace } from "@/lib/geo";
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

/**
 * One branch, as the Branches screen needs it.
 *
 * A branch carries the same id as the shop it is — that is not an accident of naming: the
 * tenant IS the branch in this product, and one membership row is both "which shop" and
 * "which branch". This type is the same fact with the counts the screen has to state out
 * loud (how many employees lose access, whether anything has ever been sold here), read in
 * one call so the screen never adds up numbers of its own.
 */
export interface BranchSummary {
  id: string;
  name: string;
  membershipRole: MembershipRole;
  membershipStatus: MembershipStatus;
  isCurrent: boolean;
  /**
   * The branch this account registered with. It can be renamed, never deleted — there
   * would be nowhere left for the account to live.
   */
  isMain: boolean;
  createdAt: string | null;
  employeeCount: number;
  productCount: number;
  customerCount: number;
  salesCount: number;
  salesTotal: number;
  /**
   * Where this branch is, as a point on a map — or `null` when it has never been pinned.
   *
   * It arrives with the rest of the branch rather than from a second read, and that is a rule and
   * not an optimisation: `shops` may only be read for the shop the account is currently working
   * in (its SELECT policy is `id = current_shop_id()`), so any screen that asked `shops` about
   * another branch would be told the row does not exist and would show "no location" for a branch
   * that has one. `get_my_branches()` is the read that may see every branch the account is a
   * member of, so it is the read that carries the place.
   */
  place: PickedPlace | null;
  /**
   * Whether this branch offers its listed products to the farmer marketplace.
   *
   * It travels with the branch for the same reason the place does: `shops` may only be read
   * for the branch the account is working in, so reading it anywhere else would come back
   * empty — not failed — and the sheet would show "not listed" about a branch that is. This is
   * the branch's own answer to a question the sheet has to show before it can change it.
   *
   * There is no distance here on purpose: how far a farmer searches is the farmer's choice, and
   * the owner's only contribution is the place above.
   */
  marketplaceEnabled: boolean;
}

/** What the caller can be told about a failed action, so the screen owns the wording. */
export type ShopErrorCode =
  | "name_required"
  | "pending_sync"
  | "switch_failed"
  | "create_failed"
  /** The server refused because this membership is not an owner/admin of the shop. */
  | "denied";

/**
 * The ways renaming or deleting a branch can be refused, named so the sheet can say the
 * right sentence. The database decides; these are its answers in the screen's vocabulary.
 */
export type BranchErrorCode =
  | "name_required"
  | "name_taken"
  | "name_too_long"
  | "not_found"
  /** A marketplace listing was asked for on a branch that has no pinned location. */
  | "no_location"
  | "denied"
  | "main_branch"
  | "last_branch"
  | "not_authenticated"
  | "save_failed"
  | "delete_failed";

export interface ShopActionResult {
  ok: boolean;
  code?: ShopErrorCode;
}

/** What a branch action returns, including what the database actually erased. */
export interface BranchActionResult {
  ok: boolean;
  code?: BranchErrorCode;
  /** Only on a successful delete: what went, and where the account lands afterwards. */
  deleted?: {
    name: string;
    /** The name of the branch the account is working in now. */
    fallbackName: string;
    employeesKept: number;
    employeesRemoved: number;
    erased: { products: number; customers: number; sales: number; salesTotal: number };
  };
}

interface ShopRow {
  shop_id: string;
  name: string;
  membership_role: MembershipRole;
  membership_status: MembershipStatus;
  is_current: boolean;
}

interface BranchRow {
  shop_id: string;
  name: string;
  membership_role: MembershipRole;
  membership_status: MembershipStatus;
  is_current: boolean;
  is_main: boolean;
  created_at: string | null;
  employee_count: number | null;
  product_count: number | null;
  customer_count: number | null;
  sales_count: number | null;
  sales_total: number | string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  location_label: string | null;
  location_source: string | null;
  marketplace_enabled: boolean | null;
}

/**
 * The stored place of one branch, in the shape the picker speaks.
 *
 * The coordinates are the test, not the label: a row with neither has never been located, and a
 * branch that was never located must not render as one standing somewhere. `label` falls back to
 * the branch's own name because the short name the map service gave is optional on rows written
 * before the picker existed.
 */
function branchPlaceFrom(row: BranchRow): PickedPlace | null {
  if (row.latitude == null || row.longitude == null) return null;
  return {
    lat: row.latitude,
    lng: row.longitude,
    label: row.location_label ?? row.name,
    address: row.address,
    source: row.location_source ?? "openstreetmap",
    countryCode: "pk",
  };
}

/**
 * Read a refusal out of whatever the database said.
 *
 * The RPCs raise `NOT_AUTHORIZED: …`, `MAIN_BRANCH: …`, `LAST_BRANCH: …` and `VALIDATION: …`
 * as their own first word, so the screen can answer in the right sentence instead of
 * showing a database error. Anything unrecognised is a genuine failure, not a refusal.
 */
function branchCodeFrom(message: string, fallback: BranchErrorCode): BranchErrorCode {
  const text = message ?? "";
  if (/MAIN_BRANCH/i.test(text)) return "main_branch";
  if (/LAST_BRANCH/i.test(text)) return "last_branch";
  if (/BRANCH_NOT_FOUND/i.test(text)) return "not_found";
  if (/no location/i.test(text)) return "no_location";
  if (/NOT_AUTHENTICATED/i.test(text)) return "not_authenticated";
  if (/NOT_AUTHORIZED/i.test(text)) return "denied";
  if (/a branch name is required/i.test(text)) return "name_required";
  if (/120 characters/i.test(text)) return "name_too_long";
  return fallback;
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
  /**
   * Why the selector was opened. `create` means the person asked for a NEW branch, so the
   * sheet opens straight on the name step rather than making them find the link again.
   * Read and cleared by the sheet, so it cannot leak into the next open.
   */
  switcherIntent: "list" | "create";
  openSwitcher: (intent?: "list" | "create") => void;
  closeSwitcher: () => void;

  /** Every branch on this account, main first, with the counts the screen states. */
  branches: BranchSummary[];
  branchesLoading: boolean;
  branchesLoaded: boolean;
  branchesError: "load_failed" | null;
  loadBranches: () => Promise<void>;
  /** Rename one branch. The name the database accepts is the one returned. */
  renameBranch: (shopId: string, name: string) => Promise<BranchActionResult>;
  /**
   * Record the pin this device has just saved — or that it just cleared.
   *
   * `set_place` answers about the row it wrote, not the branch object the screen holds, so without
   * this the list would keep the place it read before the save and reopening the sheet would show
   * the old pin — the same lie as reading the wrong table, one step later. `null` is the same
   * sentence in the other direction: the row no longer has a place, and the list must not keep
   * showing one.
   */
  setBranchPlace: (shopId: string, place: PickedPlace | null) => void;
  /**
   * Turn one branch's farmer-marketplace listing on or off.
   *
   * The database decides: it refuses to list a branch that has no pinned location (nothing could
   * be measured against a farmer's search from a place that was never picked), and it checks that
   * the caller is an owner or admin of THAT branch rather than of some other one. This forwards
   * and reads the answer back into the list, so reopening the sheet shows the state that was
   * actually saved.
   */
  setMarketplaceSettings: (shopId: string, enabled: boolean) => Promise<BranchActionResult>;
  /**
   * Delete one branch, completely.
   *
   * The database does the erasing in one transaction, and it is where every refusal lives
   * — a client cannot delete the main branch or its only branch by calling this. On
   * success the account has already been moved to another branch by the server, so the
   * caller only has to reload and adopt the answer.
   */
  deleteBranch: (shopId: string, reason?: string, feedback?: string) => Promise<BranchActionResult>;
  /** Confirm the active shop with the server and list the caller's shops. */
  load: () => Promise<void>;
  switchTo: (shopId: string) => Promise<ShopActionResult>;
  /**
   * Provision a shop.
   *
   * `roleIds` is which of the caller's current roles the new shop starts with — the answer the
   * setup flow collects in its second step. `undefined` keeps the server's default (every
   * system template), which is what any caller that has no such step wants.
   */
  create: (name: string, roleIds?: string[]) => Promise<ShopActionResult>;
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
  switcherIntent: "list",

  openSwitcher: (intent = "list") => set({ switcherOpen: true, switcherIntent: intent }),
  closeSwitcher: () => set({ switcherOpen: false }),

  branches: [],
  branchesLoading: false,
  branchesLoaded: false,
  branchesError: null,

  /**
   * Read every branch on this account.
   *
   * One call (`get_my_branches`) rather than a shop list plus a count per row: the counts
   * are what the delete step says out loud ("3 employees lose access", "47 sales will be
   * deleted"), and reading them one by one would let the screen show a number that was
   * true a moment before the transaction that removes it.
   */
  loadBranches: async () => {
    set({ branchesLoading: true, branchesError: null });
    const { data, error } = await supabase.rpc("get_my_branches");
    if (error) {
      set({ branchesLoading: false, branchesError: "load_failed" });
      return;
    }
    const rows = (data as BranchRow[]) ?? [];
    // What this read also settles: which role the account holds where. Notification
    // visibility needs that per branch (an owner of one branch is not an owner of another),
    // and this is the one read that knows it.
    setShopRolesByShop(Object.fromEntries(rows.map((r) => [r.shop_id, r.membership_role])));
    // If no membership is flagged as the account's home, the first row is the main one:
    // the server already orders it there, and the screen must not lose the label.
    const hasMain = rows.some((r) => r.is_main);
    set({
      branches: rows.map((r, i) => ({
        id: r.shop_id,
        name: r.name,
        membershipRole: r.membership_role,
        membershipStatus: r.membership_status,
        isCurrent: r.is_current,
        isMain: r.is_main || (!hasMain && i === 0),
        createdAt: r.created_at,
        employeeCount: Number(r.employee_count ?? 0),
        productCount: Number(r.product_count ?? 0),
        customerCount: Number(r.customer_count ?? 0),
        salesCount: Number(r.sales_count ?? 0),
        salesTotal: Number(r.sales_total ?? 0),
        place: branchPlaceFrom(r),
        marketplaceEnabled: r.marketplace_enabled === true,
      })),
      branchesLoading: false,
      branchesLoaded: true,
    });
  },

  renameBranch: async (shopId, name) => {
    const clean = name.trim();
    // Two accounts may legitimately use the same branch name, so the database cannot be
    // the one to refuse a repeat — this check is about THIS account's own list, and it is
    // the only place that question can be answered.
    const taken = get().branches.some(
      (b) => b.id !== shopId && b.name.trim().toLowerCase() === clean.toLowerCase(),
    );
    if (!clean) return { ok: false, code: "name_required" };
    if (clean.length > 120) return { ok: false, code: "name_too_long" };
    if (taken) return { ok: false, code: "name_taken" };

    const { error } = await supabase.rpc("rename_branch", { p_shop_id: shopId, p_name: clean });
    if (error) {
      return { ok: false, code: branchCodeFrom(error.message, "save_failed") };
    }

    // The header reads `activeShopName`; a rename of the branch being worked in must land
    // there too, or the screen keeps naming the old one until the next reload.
    if (get().activeShopId === shopId) set({ activeShopName: clean });
    set({
      branches: get().branches.map((b) => (b.id === shopId ? { ...b, name: clean } : b)),
      shops: get().shops.map((s) => (s.id === shopId ? { ...s, name: clean } : s)),
    });
    return { ok: true };
  },

  setBranchPlace: (shopId, place) => {
    set({
      branches: get().branches.map((b) => (b.id === shopId ? { ...b, place } : b)),
    });
  },

  setMarketplaceSettings: async (shopId, enabled) => {
    // Exactly the switch — there is no distance in this call, because there is no distance the
    // owner decides. `undefined` would be the only other thing to send, and the server's answer
    // is what the list is updated from either way.
    const { data, error } = await supabase.rpc("set_marketplace_settings", {
      p_shop_id: shopId,
      p_enabled: enabled,
    });
    if (error || !data?.success) {
      return { ok: false, code: branchCodeFrom(error?.message ?? "", "save_failed") };
    }
    set({
      branches: get().branches.map((b) =>
        b.id === shopId ? { ...b, marketplaceEnabled: data.marketplace_enabled === true } : b,
      ),
    });
    return { ok: true };
  },

  deleteBranch: async (shopId, reason, feedback) => {
    const target = get().branches.find((b) => b.id === shopId);

    const { data, error } = await supabase.rpc("delete_branch", {
      p_shop_id: shopId,
      p_reason: reason ?? null,
      p_feedback: feedback ?? null,
    });
    if (error || !data?.success) {
      return { ok: false, code: branchCodeFrom(error?.message ?? "", "delete_failed") };
    }

    const fallbackId: string | null = data.fallback_shop_id ?? null;
    const fallbackName =
      get().shops.find((s) => s.id === fallbackId)?.name
      ?? get().branches.find((b) => b.id === fallbackId)?.name
      ?? "";

    // The server has already moved this account into another branch, and the shop this
    // device was reading no longer exists. Reload first, so the app is looking at a shop
    // that is really there before any screen redraws over the deleted one's rows — and
    // `load` adopts the answer, which is what drops the removed branch's cached rows.
    await get().load();
    await get().loadBranches();

    return {
      ok: true,
      deleted: {
        name: target?.name ?? data.name ?? "",
        fallbackName,
        employeesKept: Number(data.employees_kept ?? 0),
        employeesRemoved: Number(data.employees_removed ?? 0),
        erased: {
          products: Number(data.erased?.products ?? 0),
          customers: Number(data.erased?.customers ?? 0),
          sales: Number(data.erased?.sales ?? 0),
          salesTotal: Number(data.erased?.sales_total ?? 0),
        },
      },
    };
  },

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

  create: async (name, roleIds) => {
    const clean = name.trim();
    if (!clean) return { ok: false, code: "name_required" };

    set({ creating: true, error: null });
    // Sent explicitly, including as an empty array: `null` would mean "no opinion, copy every
    // template", which is the opposite of an owner who unticked everything. Omitted entirely
    // when the caller has no selection to offer, so the server default applies.
    const { data, error } = await supabase.rpc("create_shop_for_me", {
      p_name: clean,
      ...(roleIds ? { p_role_ids: roleIds } : {}),
    });
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
