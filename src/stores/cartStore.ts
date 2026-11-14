import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartItem, Customer } from "@/types";

interface CartSnapshot {
  customer: Customer | null;
  items: CartItem[];
}

interface CartState extends CartSnapshot {
  /** `${tenantId}:${userId}` for the session that owns the cart on screen. */
  scopeKey: string | null;
  /** One persisted cart per account. The active pair above is a projection of this map. */
  carts: Record<string, CartSnapshot>;
  /** Switch the visible cart when the account changes. Never carries rows across accounts. */
  setScope: (scopeKey: string | null) => void;
  setCustomer: (customer: Customer | null) => void;
  addItem: (item: CartItem) => void;
  updateQty: (variantId: string, qty: number) => void;
  removeItem: (variantId: string) => void;
  clearCart: () => void;
  subtotal: () => number;
}

const EMPTY: CartSnapshot = { customer: null, items: [] };

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => {
      /**
       * Every mutation writes both the visible pair and that account's slot. Persisting only
       * the visible pair was the leak: the next account to sign in inherited it. Persisting
       * only the map would lose the sale on refresh before the scope effect ran.
       */
      const commit = (next: CartSnapshot) => {
        const scope = get().scopeKey;
        set({
          ...next,
          ...(scope ? { carts: { ...get().carts, [scope]: next } } : {}),
        });
      };

      return {
        ...EMPTY,
        scopeKey: null,
        carts: {},
        setScope: (scopeKey) => {
          const previous = get().scopeKey;
          if (scopeKey === previous) return;

          let carts = get().carts;
          if (previous && scopeKey === null) {
            // Signing out drops this account's half-finished sale from the device. Signing
            // another account in must not inherit it, and the signed-out device has no owner.
            const { [previous]: _discarded, ...rest } = carts;
            carts = rest;
          } else if (previous) {
            carts = {
              ...carts,
              [previous]: { customer: get().customer, items: get().items },
            };
          }

          const next = scopeKey ? carts[scopeKey] ?? EMPTY : EMPTY;
          set({ scopeKey, carts, customer: next.customer, items: next.items });
        },
        setCustomer: (customer) => commit({ customer, items: get().items }),
        addItem: (item) => {
          const existing = get().items.find((i) => i.variantId === item.variantId);
          if (existing) {
            commit({
              customer: get().customer,
              items: get().items.map((i) =>
                i.variantId === item.variantId
                  ? {
                      ...i,
                      qty: Math.min(i.qty + item.qty, i.maxQty),
                      lineTotal: Math.min(i.qty + item.qty, i.maxQty) * i.unitPrice,
                    }
                  : i,
              ),
            });
          } else {
            commit({ customer: get().customer, items: [...get().items, item] });
          }
        },
        updateQty: (variantId, qty) => {
          if (qty <= 0) {
            get().removeItem(variantId);
            return;
          }
          commit({
            customer: get().customer,
            items: get().items.map((i) =>
              i.variantId === variantId
                ? {
                    ...i,
                    qty: Math.min(qty, i.maxQty),
                    lineTotal: Math.min(qty, i.maxQty) * i.unitPrice,
                  }
                : i,
            ),
          });
        },
        removeItem: (variantId) =>
          commit({
            customer: get().customer,
            items: get().items.filter((i) => i.variantId !== variantId),
          }),
        clearCart: () => {
          const scope = get().scopeKey;
          if (scope) {
            const { [scope]: _discarded, ...rest } = get().carts;
            set({ scopeKey: scope, carts: rest, ...EMPTY });
          } else {
            set(EMPTY);
          }
        },
        subtotal: () => get().items.reduce((sum, item) => sum + item.lineTotal, 0),
      };
    },
    {
      name: "agrishop-cart",
      // The account key is deliberately not restored: the shell names the account after the
      // stored session is checked, so a previous account's rows can never render first.
      partialize: (state) => ({ carts: state.carts }),
      merge: (persisted, current) => ({
        ...current,
        carts: (persisted as { carts?: Record<string, CartSnapshot> } | undefined)?.carts ?? {},
        customer: null,
        items: [],
        scopeKey: null,
      }),
    },
  ),
);
