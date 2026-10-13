/**
 * Multi-shop, client half — the switch must leave nothing behind.
 *
 * The running app can be read from the outside (which shop the name says, which rows the list
 * shows), but "every store was emptied" is not visible from a screenshot, and it is the part
 * that quietly rots: a new store added next month would keep the previous shop's rows and
 * nothing on screen would say so until someone noticed another shop's data. So the contract is
 * checked here, against the real stores and the real `switchTo` path, with the database mocked
 * to answer the way `set_active_shop`/`get_my_shops` do.
 *
 * What is asserted:
 *   1. After a switch, every shop-scoped store is empty, the cart (a half-filled sale) is
 *      cleared, the navigation stack is cleared, and the cached business rows are no longer
 *      reachable because the cache owner moved with the shop.
 *   2. The context the rest of the app reads — `authStore.user.tenantId`, the shop name, which
 *      row `get_my_shops` marks current — all come from the server's answer.
 *   3. Work that has not reached the server yet blocks the switch instead of landing in the
 *      wrong shop.
 *   4. `load()` takes the server's answer over the shop this device remembers.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Company, Customer, Product, Role, Sale, User } from "@/types";
import type { AppNotification } from "@/stores/notificationStore";

const env = vi.hoisted(() => ({ offline: false, branch: "branch-main" }));

vi.mock("@/lib/supabase", () => {
  const SHOPS = [
    { shop_id: "shop-a", name: "QA Shop A", membership_role: "owner", membership_status: "active", is_current: false },
    { shop_id: "shop-b", name: "QA Shop B", membership_role: "owner", membership_status: "active", is_current: true },
  ];
  return {
    supabaseUrl: "https://qa.supabase.co",
    supabase: {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        if (env.offline) return { data: null, error: { message: "network is down" } };
        if (name === "set_active_shop") {
          const shop = SHOPS.find((s) => s.shop_id === args?.p_shop_id);
          if (!shop) return { data: { success: false, error: "NOT_AUTHORIZED" }, error: null };
          return {
            data: {
              success: true,
              active_shop_id: shop.shop_id,
              shop_name: shop.name,
              membership_role: shop.membership_role,
              membership_id: `m-${shop.shop_id}`,
            },
            error: null,
          };
        }
        if (name === "get_my_branches") return { data: [
          { branch_id: "branch-main", tenant_id: "shop-a", name: "Main", membership_role: "owner", membership_status: "active", is_current: env.branch === "branch-main", is_main: true },
          { branch_id: "branch-warehouse", tenant_id: "shop-a", name: "Warehouse", membership_role: "owner", membership_status: "active", is_current: env.branch === "branch-warehouse", is_main: false },
        ], error: null };
        if (name === "set_active_branch") {
          if (!["branch-main", "branch-warehouse"].includes(String(args?.p_branch_id))) return { data: null, error: { message: "NOT_AUTHORIZED" } };
          env.branch = String(args?.p_branch_id);
          return { data: { success: true, tenant_id: "shop-a", branch_id: env.branch,
            branch_name: env.branch === "branch-main" ? "Main" : "Warehouse", membership_role: "owner" }, error: null };
        }
        if (name === "get_my_shops") return { data: SHOPS, error: null };
        if (name === "get_my_permissions") return { data: ["products.view", "sales.create"], error: null };
        return { data: null, error: null };
      },
      from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
      channel: () => ({ on: () => ({ subscribe: () => undefined }) }),
      removeChannel: () => undefined,
    },
  };
});

import { useShopStore } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useRolesStore } from "@/stores/rolesStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useCartStore } from "@/stores/cartStore";
import { enqueueOperation, loadQueue, saveQueue } from "@/lib/offlineQueue";
import { navDepth, pushNav } from "@/lib/navContext";
import { getCachedData, setCachedData, confirmCacheBranch, beginScopedWrite } from "@/lib/localCache";

const QA_ADMIN = {
  id: "user-1", name: "QA Admin", phone: "923009999999", role: "admin",
  permissions: [], tenantId: "shop-a", membershipRole: "owner",
} as unknown as User;

/** Every store that holds rows of one shop, each with a row of the shop being left. */
function seedShopScopedState(): void {
  useProductsStore.setState({ products: [{ id: "leftover-product" }] as unknown as Product[], ready: true });
  useCustomersStore.setState({ customers: [{ id: "leftover-customer" }] as unknown as Customer[], ready: true });
  useSalesStore.setState({ sales: [{ id: "leftover-sale" }] as unknown as Sale[], ready: true });
  useCompaniesStore.setState({ companies: [{ id: "leftover-company" }] as unknown as Company[], ready: true });
  useEmployeesStore.setState({ employees: [{ id: "leftover-employee" }] as unknown as User[], ready: true });
  useRolesStore.setState({ roles: [{ id: "leftover-role" }] as unknown as Role[], ready: true });
  useNotificationStore.setState({ items: [{ id: "leftover-notification" }] as unknown as AppNotification[], ready: true });
  // A half-filled sale is the most expensive thing to leave behind: it would be completed in
  // the shop that did not make it.
  useCartStore.setState({
    customer: { id: "leftover-customer" } as unknown as Customer,
    items: [{ variantId: "v-1", name: "Leftover", qty: 2 }] as never,
  });
}

function readShopScopedState() {
  return {
    products: useProductsStore.getState().products.length,
    customers: useCustomersStore.getState().customers.length,
    sales: useSalesStore.getState().sales.length,
    companies: useCompaniesStore.getState().companies.length,
    employees: useEmployeesStore.getState().employees.length,
    roles: useRolesStore.getState().roles.length,
    notifications: useNotificationStore.getState().items.length,
    cartItems: useCartStore.getState().items.length,
    cartCustomer: useCartStore.getState().customer,
    navDepth: navDepth(),
  };
}

describe("switching shop", () => {
  beforeEach(() => {
    env.offline = false;
    env.branch = "branch-main";
    saveQueue([]);
    localStorage.clear();
    useAuthStore.getState().setUser(QA_ADMIN);
    useShopStore.setState({
      shops: [], activeShopId: "shop-a", activeShopName: "QA Shop A",
      activeBranchId: "branch-main", activeBranchName: "Main",
      loading: false, switching: false, creating: false, error: null,
    });
    confirmCacheBranch("shop-a", QA_ADMIN.id, "branch-main");
    seedShopScopedState();
    pushNav("/admin/customers", "/admin/more");
  });

  it("empties every shop-scoped store, the cart and the back stack", async () => {
    // Rows cached under the shop being left must go with it, not wait to be re-shown.
    setCachedData("products", [{ id: "cached-from-shop-a" }]);

    expect(readShopScopedState()).toMatchObject({ products: 1, customers: 1, sales: 1, cartItems: 1, navDepth: 1 });

    const result = await useShopStore.getState().switchTo("shop-b");

    expect(result.ok).toBe(true);
    expect(readShopScopedState()).toEqual({
      products: 0, customers: 0, sales: 0, companies: 0, employees: 0,
      roles: 0, notifications: 0, cartItems: 0, cartCustomer: null, navDepth: 0,
    });
    expect(getCachedData("products")).toBeNull();
  });

  it("moves the context the whole app reads: shop id, name, role, permissions", async () => {
    const result = await useShopStore.getState().switchTo("shop-b");

    expect(result.ok).toBe(true);
    const shop = useShopStore.getState();
    expect(shop.activeShopId).toBe("shop-b");
    expect(shop.activeShopName).toBe("QA Shop B");
    expect(shop.shops.map((s) => [s.name, s.isCurrent])).toEqual([["QA Shop A", false], ["QA Shop B", true]]);

    const user = useAuthStore.getState().user;
    expect(user?.tenantId).toBe("shop-b");
    expect(user?.membershipRole).toBe("owner");
    expect(user?.permissions).toEqual(["products.view", "sales.create"]);
  });

  it("refuses to switch while this device still holds work that has not been sent", async () => {
    env.offline = true;
    enqueueOperation({ type: "create_sale", payload: { id: "queued-sale" } });

    const result = await useShopStore.getState().switchTo("shop-b");

    expect(result).toEqual({ ok: false, code: "pending_sync" });
    expect(loadQueue()).toHaveLength(1);
    expect(useShopStore.getState().activeShopId).toBe("shop-a");
    expect(useAuthStore.getState().user?.tenantId).toBe("shop-a");
  });

  it("same-tenant branch switching clears every store and cache without changing the actor or tenant", async () => {
    setCachedData("sales", [{ id: "cached-main" }]);
    const actor = useAuthStore.getState().user?.id;
    const result = await useShopStore.getState().switchBranch("branch-warehouse");
    expect(result).toEqual({ ok: true });
    expect(useShopStore.getState()).toMatchObject({ activeShopId: "shop-a", activeBranchId: "branch-warehouse", activeBranchName: "Warehouse" });
    expect(useAuthStore.getState().user).toMatchObject({ id: actor, tenantId: "shop-a" });
    expect(readShopScopedState()).toEqual({ products: 0, customers: 0, sales: 0, companies: 0, employees: 0,
      roles: 0, notifications: 0, cartItems: 0, cartCustomer: null, navDepth: 0 });
    expect(getCachedData("sales")).toBeNull();
    await useShopStore.getState().loadBranches();
    expect(useShopStore.getState().activeBranchId).toBe("branch-warehouse");
  });

  it("branch switching refuses a tenant id or a failed server response without changing context", async () => {
    expect(await useShopStore.getState().switchBranch("shop-a")).toEqual({ ok: false, code: "switch_failed" });
    expect(useShopStore.getState().activeBranchId).toBe("branch-main");
    expect(useAuthStore.getState().user?.tenantId).toBe("shop-a");
  });

  it("refuses branch switching until an in-flight financial operation finishes", async () => {
    const finish = beginScopedWrite();
    try {
      expect(await useShopStore.getState().switchBranch("branch-warehouse")).toEqual({ ok: false, code: "pending_sync" });
      expect(useShopStore.getState().activeBranchId).toBe("branch-main");
    } finally { finish(); }
    expect(await useShopStore.getState().switchBranch("branch-warehouse")).toEqual({ ok: true });
  });

  it("takes the server's shop over the one this device remembers", async () => {
    // What the device remembers (shop-a) is what `authStore` was persisted with; the database
    // says this account is working in shop-b — another device switched, or a membership changed.
    expect(useAuthStore.getState().user?.tenantId).toBe("shop-a");

    await useShopStore.getState().load();

    expect(useShopStore.getState().activeShopId).toBe("shop-b");
    expect(useShopStore.getState().activeShopName).toBe("QA Shop B");
    expect(useAuthStore.getState().user?.tenantId).toBe("shop-b");
    // …and the rows of the shop it was told to leave are gone, not merely relabelled.
    expect(readShopScopedState()).toMatchObject({ products: 0, customers: 0, sales: 0, cartItems: 0 });
  });
});
