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
import { clearAllCachedData, suspendCachedData, confirmCacheBranch, hasScopedWriteInFlight } from "@/lib/localCache";
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
 * The branch id identifies an operating unit; tenantId identifies its business.
 * Neither is an alias for the other. Counts come from authorized branch records,
 * not tenant-wide aggregates relabeled as branch data.
 */
export interface BranchSummary {
  id: string;
  tenantId: string;
  name: string;
  membershipRole: MembershipRole;
  membershipStatus: MembershipStatus;
  /**
   * The role this person holds IN THIS BRANCH.
   *
   * Not a copy of `membershipRole`: one membership can be a cashier in one branch and a manager
   * in another (migration 0233), and this is the field that tells them apart. `null` means the
   * branch has no explicit row and the membership's default role applies.
   */
  roleId: string | null;
  roleName: string | null;
  isCurrent: boolean;
  /**
   * The branch this account registered with. It can be renamed, never deleted — there
   * would be nowhere left for the account to live.
   */
  isMain: boolean;
  createdAt: string | null;
  employeeCount: number | null;
  productCount: number | null;
  customerCount: number | null;
  salesCount: number | null;
  salesTotal: number | null;
  /**
   * What this branch's own stock is worth, at today's cost.
   *
   * Its own, not the business's: the value of what this branch received and has not sold,
   * derived from the branch-stamped movement ledger (migration 0234). The main branch also
   * carries whatever the ledger cannot attribute, so the branches always add up to the
   * business total. `null` means the caller may not see inventory, never that it is zero.
   */
  inventoryValue: number | null;
  /**
   * Some of this branch's stock has no cost recorded, so `inventoryValue` is a floor (`≥`)
   * rather than a smaller — wrong — number.
   */
  inventoryCostIncomplete: boolean;
  /**
   * What this branch billed and has not collected at this branch.
   *
   * Never negative: a collection taken here against another branch's bill cannot pull this
   * figure below zero — the main branch reconciles the difference, so the branches still add
   * up to the business total. `null` means the caller may not see customers.
   */
  creditOutstanding: number | null;
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
  | "location_required"
  | "name_taken"
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
  /** This branch already has a responsible person; the way to change it is transfer. */
  | "already_assigned"
  /** Nobody is responsible right now, so there is nothing to hand over or revoke. */
  | "no_one_responsible"
  /** The chosen person is not an active member of this business. */
  | "not_a_person"
  | "save_failed"
  | "delete_failed"
  | "has_staff";

export interface ShopActionResult {
  ok: boolean;
  code?: ShopErrorCode;
}

/** What a branch action returns, including what the database actually did. */
export interface BranchActionResult {
  ok: boolean;
  code?: BranchErrorCode;
  /**
   * Only on a successful archive: which branch closed, and where the account works now.
   *
   * This replaced an `erased: { products, customers, sales, salesTotal }` payload that only the
   * revoked tenant-purge RPC ever returned. Nothing is erased by archiving — the branches, rows
   * and history all stay, and `archive_operating_branch` answers with `history_preserved: true` —
   * so a result shape offering counts of erased records would describe something that cannot
   * happen. `name` is captured before the reload, because after it the archived branch is
   * correctly absent from the list.
   */
  archived?: {
    name: string;
    /** The name of the branch the account is working in now. */
    fallbackName: string;
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
  branch_id: string;
  tenant_id: string;
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
  role_id: string | null;
  role_name: string | null;
  /** This branch's own stock value (0234). NULL when the caller may not see inventory. */
  inventory_value: number | string | null;
  /** True when some of this branch's stock has no cost recorded, so its value is a floor. */
  inventory_cost_incomplete: boolean | null;
  /** What this branch billed and has not collected there (0234). NULL without customers.view. */
  credit_outstanding: number | string | null;
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
  if (/BRANCH_HAS_STAFF/i.test(text)) return "has_staff";
  if (/BRANCH_NAME_TAKEN/i.test(text)) return "name_taken";
  if (/MAIN_BRANCH/i.test(text)) return "main_branch";
  if (/LAST_BRANCH/i.test(text)) return "last_branch";
  if (/BRANCH_NOT_FOUND/i.test(text)) return "not_found";
  if (/no location/i.test(text)) return "no_location";
  if (/NOT_AUTHENTICATED/i.test(text)) return "not_authenticated";
  if (/NOT_AUTHORIZED/i.test(text)) return "denied";
  if (/BRANCH_ALREADY_ASSIGNED/i.test(text)) return "already_assigned";
  if (/nobody is currently responsible/i.test(text)) return "no_one_responsible";
  if (/EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED/i.test(text)) return "not_a_person";
  if (/a branch name is required/i.test(text)) return "name_required";
  if (/120 characters/i.test(text)) return "name_too_long";
  return fallback;
}

interface ShopState {
  shops: ShopSummary[];
  /** Which shop every read and write in the app is scoped to. */
  /** Business identity only; never a value for branch_scope. */
  activeShopId: string | null;
  activeShopName: string | null;
  activeBranchId: string | null;
  activeBranchName: string | null;
  switchBranch: (branchId: string) => Promise<ShopActionResult>;
  /**
   * Hand a branch to a responsible person.
   *
   * This is operational control of one branch, never ownership of the business: the database
   * refuses it to anyone but the owner, gives the person the branch and nothing else, and keeps
   * the owner as the owner. A refusal is therefore a real answer about authority, not a network
   * problem, and the screen must say which.
   */
  assignBranchResponsibility: (
    branchId: string,
    userId: string,
    roleId?: string | null,
  ) => Promise<BranchActionResult>;
  /** End a designation. The person keeps their access — see the RPC for why. */
  revokeBranchResponsibility: (branchId: string, reason: string) => Promise<BranchActionResult>;
  /** Move responsibility between two people in one transaction, so the branch is never ownerless. */
  transferBranchResponsibility: (
    branchId: string,
    userId: string,
    roleId?: string | null,
    reason?: string,
  ) => Promise<BranchActionResult>;
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

  /**
   * What the owner has entered on step 1 of the setup flow and not yet turned into a shop.
   *
   * In the store, not in the sheet, and that is the whole point: the location picker is a page
   * OUTSIDE the shell, so opening it unmounts the sheet that asked for it. A draft held in the
   * sheet's own state dies with it, and the owner comes back from choosing a place to an empty
   * name field. Here it survives the round trip, which is what makes "pick a location" a step in
   * the form rather than an exit from it.
   */
  setupDraft: { name: string; place: PickedPlace | null; requestId: string | null };
  setSetupDraft: (patch: Partial<{ name: string; place: PickedPlace | null; requestId: string | null }>) => void;

  /**
   * The branch whose edit sheet is open, by id — the same survival rule as `setupDraft`, for the
   * Settings screen's own branch sheet. The id is stored rather than the row so the sheet always
   * shows what the server currently says, and the row itself is read back off `branches`.
   */
  editingBranchId: string | null;
  setEditingBranch: (id: string | null) => void;

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
  create: (name: string, place: PickedPlace, requestId: string) => Promise<ShopActionResult>;
  archiveBranch: (branchId: string, reason: string) => Promise<BranchActionResult>;
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
  activeBranchId: null,
  activeBranchName: null,
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

  setupDraft: { name: "", place: null, requestId: null },
  setSetupDraft: (patch) => set((s) => ({ setupDraft: { ...s.setupDraft, ...patch } })),

  editingBranchId: null,
  setEditingBranch: (id) => set({ editingBranchId: id }),

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
    const actorId = useAuthStore.getState().user?.id;
    const tenantId = get().activeShopId;
    set({ branchesLoading: true, branchesError: null });
    const { data, error } = await supabase.rpc("get_my_branches");
    if (actorId !== useAuthStore.getState().user?.id || tenantId !== get().activeShopId || get().switching) return;
    if (error) {
      suspendCachedData();
      resetShopScopedStores();
      set({ branchesLoading: false, branchesError: "load_failed" });
      return;
    }
    const rows = ((data as BranchRow[]) ?? []).filter((row) => row.tenant_id === get().activeShopId);
    const selected = rows.find((r) => r.is_current);
    const actor = useAuthStore.getState().user;
    if (selected && actor) {
      if (get().activeBranchId !== selected.branch_id) resetShopScopedStores();
      confirmCacheBranch(selected.tenant_id, actor.id, selected.branch_id);
    } else {
      suspendCachedData();
      resetShopScopedStores();
    }
    // What this read also settles: which role the account holds where. Notification
    // visibility needs that per branch (an owner of one branch is not an owner of another),
    // and this is the one read that knows it.
    setShopRolesByShop(Object.fromEntries(rows.map((r) => [r.tenant_id, r.membership_role])));
    // If no membership is flagged as the account's home, the first row is the main one:
    // the server already orders it there, and the screen must not lose the label.
    set({
      branches: rows.map((r) => ({
        id: r.branch_id,
        tenantId: r.tenant_id,
        name: r.name,
        membershipRole: r.membership_role,
        membershipStatus: r.membership_status,
        roleId: r.role_id ?? null,
        roleName: r.role_name ?? null,
        isCurrent: r.is_current,
        isMain: r.is_main,
        createdAt: r.created_at,
        employeeCount: r.employee_count != null ? Number(r.employee_count) : null,
        productCount: r.product_count != null ? Number(r.product_count) : null,
        customerCount: r.customer_count != null ? Number(r.customer_count) : null,
        salesCount: r.sales_count != null ? Number(r.sales_count) : null,
        salesTotal: r.sales_total != null ? Number(r.sales_total) : null,
        place: branchPlaceFrom(r),
        marketplaceEnabled: r.marketplace_enabled === true,
        inventoryValue: r.inventory_value != null ? Number(r.inventory_value) : null,
        inventoryCostIncomplete: r.inventory_cost_incomplete === true,
        creditOutstanding: r.credit_outstanding != null ? Number(r.credit_outstanding) : null,
      })),
      branchesLoading: false,
      branchesLoaded: true,
      activeBranchId: rows.find((r) => r.is_current)?.branch_id ?? null,
      activeBranchName: rows.find((r) => r.is_current)?.name ?? null,
    });
  },

  switchBranch: async (branchId) => {
    if (branchId === get().activeBranchId) return { ok: true };
    if (get().switching) return { ok: false, code: "switch_failed" };
    if (hasScopedWriteInFlight()) return { ok: false, code: "pending_sync" };
    if (getPendingCount() > 0) {
      await syncPendingOperations(supabase).catch(() => undefined);
      if (getPendingCount() > 0) return { ok: false, code: "pending_sync" };
    }
    set({ switching: true });
    suspendCachedData();
    resetShopScopedStores();
    const { data, error } = await supabase.rpc("set_active_branch", { p_branch_id: branchId });
    if (error || !data?.success) {
      set({ switching: false });
      await get().loadBranches();
      return { ok: false, code: "switch_failed" };
    }
    // Clear before adopting/rendering the next context, including same-tenant
    // switches. A previous branch's instant-cache paint is never valid here.
    clearAllCachedData();
    await adoptShop(data.tenant_id, get().shops.find((s) => s.id === data.tenant_id)?.name ?? "", data.membership_role);
    const actor = useAuthStore.getState().user;
    if (actor) confirmCacheBranch(data.tenant_id, actor.id, data.branch_id);
    set({ activeBranchId: data.branch_id, activeBranchName: data.branch_name, switching: false });
    await get().loadBranches();
    return { ok: true };
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
    if (get().activeBranchId === shopId) set({ activeBranchName: clean });
    set({
      branches: get().branches.map((b) => (b.id === shopId ? { ...b, name: clean } : b)),
    });
    return { ok: true };
  },

  setBranchPlace: (shopId, place) => {
    set({
      branches: get().branches.map((b) => (b.id === shopId ? { ...b, place } : b)),
    });
  },

  setMarketplaceSettings: async (shopId, enabled) => {
    // The marketplace listing is a tenant-level setting: the database stores one `shops`
    // row per business, and `set_marketplace_settings` is the one RPC that owns that row.
    // The UI presents it alongside one branch because that branch is where a farmer would
    // meet the shop, but it is not per-branch state and must not be stored as if it were.
    const branch = get().branches.find((b) => b.id === shopId);
    const { data, error } = await supabase.rpc("set_marketplace_settings", {
      p_shop_id: branch?.tenantId ?? shopId,
      p_enabled: enabled,
    });
    if (error || !data?.success) {
      return { ok: false, code: branchCodeFrom(error?.message ?? "", "save_failed") };
    }
    // The marketplace listing is a tenant-level setting. Only the branch the caller is
    // editing should reflect the new value here; the other branch summaries for the same
    // business share the underlying tenant value, but we do not blanket-update them because
    // that would pretend the switch changed every branch row when it changed one tenant row.
    set({
      branches: get().branches.map((b) =>
        b.id === shopId ? { ...b, marketplaceEnabled: data.marketplace_enabled === true } : b,
      ),
    });
    return { ok: true };
  },



  archiveBranch: async (branchId, reason) => {
    if (getPendingCount() > 0 || hasScopedWriteInFlight() || get().switching) return { ok: false, code: "denied" };
    // Read before the reload: `load()` replaces the branch list, and a branch that has just been
    // archived is correctly absent from it — but the person still has to be told which branch they
    // just closed, so the name is captured while it is still there.
    const archivedName = get().branches.find((b) => b.id === branchId)?.name ?? "";
    const { data, error } = await supabase.rpc("archive_operating_branch", {
      p_branch_id: branchId, p_reason: reason.trim(),
    });
    if (error || !data?.success) return { ok: false, code: branchCodeFrom(error?.message ?? "", "save_failed") };
    clearAllCachedData();
    resetShopScopedStores();
    await get().load();
    // The RPC answers with `fallback_branch_id` — the branch the account was moved into — not with
    // a name. Resolved here, from the freshly loaded list, so no screen has to derive it: the
    // fallback is a sibling branch of the same tenant, so it is in the list or in the shop list.
    const fallbackId: string | null = data.fallback_branch_id ?? null;
    const fallbackName =
      get().branches.find((b) => b.id === fallbackId)?.name
      ?? get().shops.find((s) => s.id === fallbackId)?.name
      ?? "";
    return { ok: true, archived: { name: archivedName, fallbackName } };
  },

  // Backward-compatible refusal for legacy consumers. Never call a tenant purge.
  deleteBranch: async () => ({ ok: false, code: "denied" }),

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
    await get().loadBranches();
  },

  switchTo: async (shopId) => {
    if (shopId === get().activeShopId) return { ok: true };
    if (get().switching || hasScopedWriteInFlight()) return { ok: false, code: "pending_sync" };

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

  create: async (name, place, requestId) => {
    const clean = name.trim();
    if (!clean) return { ok: false, code: "name_required" };

    if (!place) return { ok: false, code: "location_required" };
    if (get().creating || get().switching) return { ok: false, code: "create_failed" };
    if (getPendingCount() > 0 || hasScopedWriteInFlight()) return { ok: false, code: "pending_sync" };
    set({ creating: true, error: null });
    const { data, error } = await supabase.rpc("create_operating_branch", {
      p_branch_id: requestId, p_name: clean,
      p_latitude: place.lat, p_longitude: place.lng,
      p_label: place.label, p_address: place.address, p_source: place.source,
    });
    if (error || !data?.success) {
      // A refusal is not a network problem and must not be reported as one: the role that
      // came back with the membership was stale, and the honest answer is who may create a
      // shop, not "try again".
      const denied = /NOT_AUTHORIZED/i.test(`${error?.message ?? ""}${error?.details ?? ""}`);
      const code = denied ? "denied" : /BRANCH_NAME_TAKEN/i.test(error?.message ?? "") ? "name_taken" : "create_failed";
      set({ creating: false, error: code });
      return { ok: false, code };
    }

    set({ creating: false });
    await get().loadBranches();
    // Enter only through the existing context-switch boundary. Roles and people
    // are not copied: they remain reusable business-owned templates/accounts.
    return get().switchBranch(data.branch_id);
  },

  assignBranchResponsibility: async (branchId, userId, roleId = null) => {
    if (!branchId || !userId) return { ok: false, code: "not_a_person" };
    const { data, error } = await supabase.rpc("grant_branch_responsibility", {
      p_branch_id: branchId, p_user_id: userId, p_role_id: roleId,
    });
    if (error || !data?.success) {
      const code = branchCodeFrom(`${error?.message ?? ""}${error?.details ?? ""}`, "denied");
      set({ error: code });
      return { ok: false, code };
    }
    return { ok: true };
  },

  revokeBranchResponsibility: async (branchId, reason) => {
    if (!branchId) return { ok: false, code: "not_found" };
    if (!reason.trim()) return { ok: false, code: "name_required" };
    const { data, error } = await supabase.rpc("revoke_branch_responsibility", {
      p_branch_id: branchId, p_reason: reason.trim(),
    });
    if (error || !data?.success) {
      const code = branchCodeFrom(`${error?.message ?? ""}${error?.details ?? ""}`, "denied");
      set({ error: code });
      return { ok: false, code };
    }
    return { ok: true };
  },

  transferBranchResponsibility: async (branchId, userId, roleId = null, reason = "") => {
    if (!branchId || !userId) return { ok: false, code: "not_a_person" };
    const { data, error } = await supabase.rpc("transfer_branch_responsibility", {
      p_branch_id: branchId, p_to_user_id: userId, p_role_id: roleId,
      p_reason: reason.trim() || null,
    });
    if (error || !data?.success) {
      const code = branchCodeFrom(`${error?.message ?? ""}${error?.details ?? ""}`, "denied");
      set({ error: code });
      return { ok: false, code };
    }
    return { ok: true };
  },
}));
