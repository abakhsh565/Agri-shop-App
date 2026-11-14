import { beforeEach, describe, expect, it } from "vitest";
import { useCartStore } from "@/stores/cartStore";
import type { CartItem, Customer } from "@/types";

/**
 * The bug this protects: an Owner filled a cart, an Employee signed in on the same phone, and
 * the Owner's rows were still on screen for the same customer. The cart belongs to the account
 * that started it, and signing out drops only that account's saved slot.
 */
const item: CartItem = {
  productId: "product-1",
  productName: "Urea",
  variantId: "variant-1",
  variantName: "50 kg",
  qty: 1,
  unitPrice: 500,
  unitSize: 1,
  baseUnit: "bag",
  lineTotal: 500,
  maxQty: 10,
  qtyStep: 1,
};

const customer = { id: "customer-1", name: "Same Customer" } as Customer;

describe("cart account scope", () => {
  beforeEach(() => {
    useCartStore.setState({ scopeKey: null, carts: {}, customer: null, items: [] });
  });

  it("keeps two accounts' carts apart even for the same customer", () => {
    const store = useCartStore.getState();

    store.setScope("tenant-1:owner-1");
    useCartStore.getState().setCustomer(customer);
    useCartStore.getState().addItem(item);

    useCartStore.getState().setScope("tenant-1:employee-1");
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().customer).toBeNull();

    useCartStore.getState().addItem({ ...item, variantId: "variant-2" });
    expect(useCartStore.getState().items.map((row) => row.variantId)).toEqual(["variant-2"]);

    useCartStore.getState().setScope("tenant-1:owner-1");
    expect(useCartStore.getState().items.map((row) => row.variantId)).toEqual(["variant-1"]);
    expect(useCartStore.getState().customer?.id).toBe("customer-1");
  });

  it("drops the signed-out account's half-finished sale from the device", () => {
    useCartStore.getState().setScope("tenant-1:owner-1");
    useCartStore.getState().addItem(item);

    useCartStore.getState().setScope(null);
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().carts["tenant-1:owner-1"]).toBeUndefined();

    useCartStore.getState().setScope("tenant-1:owner-1");
    expect(useCartStore.getState().items).toEqual([]);
  });
});
