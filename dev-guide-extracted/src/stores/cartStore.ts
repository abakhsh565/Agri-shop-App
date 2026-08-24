import { create } from "zustand";
import type { CartItem, Customer } from "@/types";

interface CartState {
  customer: Customer | null;
  items: CartItem[];
  setCustomer: (customer: Customer | null) => void;
  addItem: (item: CartItem) => void;
  updateQty: (variantId: string, qty: number) => void;
  removeItem: (variantId: string) => void;
  clearCart: () => void;
  subtotal: () => number;
}

export const useCartStore = create<CartState>()((set, get) => ({
  customer: null,
  items: [],
  setCustomer: (customer) => set({ customer }),
  addItem: (item) => {
    const existing = get().items.find((i) => i.variantId === item.variantId);
    if (existing) {
      set({
        items: get().items.map((i) =>
          i.variantId === item.variantId
            ? { ...i, qty: Math.min(i.qty + item.qty, i.maxQty), lineTotal: Math.min(i.qty + item.qty, i.maxQty) * i.unitPrice }
            : i
        ),
      });
    } else {
      set({ items: [...get().items, item] });
    }
  },
  updateQty: (variantId, qty) => {
    if (qty <= 0) {
      get().removeItem(variantId);
      return;
    }
    set({
      items: get().items.map((i) =>
        i.variantId === variantId
          ? { ...i, qty: Math.min(qty, i.maxQty), lineTotal: Math.min(qty, i.maxQty) * i.unitPrice }
          : i
      ),
    });
  },
  removeItem: (variantId) => set({ items: get().items.filter((i) => i.variantId !== variantId) }),
  clearCart: () => set({ customer: null, items: [] }),
  subtotal: () => get().items.reduce((s, i) => s + i.lineTotal, 0),
}));
