import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartItem, Customer } from "@/types";

/**
 * One unfinished sale.
 *
 * A shop with two counters, or one counter serving three people at once, does not have "a cart" —
 * it has a few. The owner asked for exactly that (2026-11-17): five items for Ahmad, seven for
 * Faraz, and a walk-in, all in progress, told apart by the person they belong to. So each draft
 * carries the customer it is for, and the cart icon on Home opens the list when there is more than
 * one rather than guessing which sale the tap meant.
 */
interface CartDraft {
  id: string;
  customer: Customer | null;
  items: CartItem[];
  /** Money taken off the whole sale, in rupees. Lines are already net of their own discount. */
  discount: number;
  startedAt: string;
}

interface CartSnapshot {
  customer: Customer | null;
  items: CartItem[];
  discount: number;
}

interface ScopeCarts {
  drafts: CartDraft[];
  activeId: string | null;
}

interface CartState extends CartSnapshot {
  /** `${tenantId}:${userId}` for the session that owns the cart on screen. */
  scopeKey: string | null;
  /** The draft on screen, and every other draft this account has open. */
  draftId: string | null;
  drafts: CartDraft[];
  /** One persisted set of drafts per account. The fields above are a projection of this. */
  carts: Record<string, ScopeCarts>;
  setScope: (scopeKey: string | null) => void;
  setCustomer: (customer: Customer | null) => void;
  addItem: (item: CartItem) => void;
  updateQty: (variantId: string, qty: number) => void;
  removeItem: (variantId: string) => void;
  /** Take money off one line. The amount is capped at what the line is worth. */
  setLineDiscount: (variantId: string, amount: number) => void;
  /** Take money off the whole sale. Capped at what the lines are worth together. */
  setDiscount: (amount: number) => void;
  /**
   * Open a sale for this customer without losing the one already on screen. An empty draft is
   * reused rather than leaving a trail of empty cards, and picking the same customer again
   * returns to their draft instead of starting a second one for them.
   */
  startSale: (customer: Customer | null) => void;
  /** Put another draft on screen. */
  switchDraft: (id: string) => void;
  /** Throw a draft away — a sale the shopkeeper started and then abandoned. */
  removeDraft: (id: string) => void;
  /** Finish the sale on screen: its draft goes, and the next one (if any) takes its place. */
  clearCart: () => void;
  /** Drop every draft: a different account is about to use this device. */
  clearAll: () => void;
  /** What the lines add up to, after each line's own discount. */
  subtotal: () => number;
  /** What the customer pays: the subtotal less the bill's discount. */
  total: () => number;
}

const EMPTY_ITEMS: CartItem[] = [];

function newId(): string {
  // `crypto.randomUUID` is present in every browser this app ships to; the fallback is for
  // environments (older embedded webviews, tests) where it is not.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function draftFor(customer: Customer | null): CartDraft {
  return { id: newId(), customer, items: [], discount: 0, startedAt: new Date().toISOString() };
}

/** A line is never worth less than nothing, whatever amount is typed into it. */
function lineNet(qty: number, unitPrice: number, discount: number | undefined): number {
  return Math.max(0, Math.round((qty * unitPrice - (discount ?? 0)) * 100) / 100);
}

/** What the screen shows: the active draft's three fields, or nothing. */
function projection(state: CartState, carts: Record<string, ScopeCarts>, scope: string | null) {
  const entry = scope ? carts[scope] : undefined;
  const active = entry?.drafts.find((d) => d.id === entry.activeId) ?? entry?.drafts[0] ?? null;
  return {
    cartDrafts: entry?.drafts ?? [],
    draftId: active?.id ?? null,
    customer: active?.customer ?? null,
    items: active?.items ?? EMPTY_ITEMS,
    discount: active?.discount ?? 0,
  };
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => {
      /**
       * Every mutation writes the active draft into the account's slot and re-projects it onto the
       * fields the screens read. One writer, so the visible cart and the stored one cannot drift.
       */
      const writeDrafts = (drafts: CartDraft[], activeId: string | null) => {
        const scope = get().scopeKey;
        const carts = scope ? { ...get().carts, [scope]: { drafts, activeId } } : get().carts;
        const active = drafts.find((d) => d.id === activeId) ?? null;
        set({
          carts,
          drafts,
          draftId: active?.id ?? null,
          customer: active?.customer ?? null,
          items: active?.items ?? EMPTY_ITEMS,
          discount: active?.discount ?? 0,
        });
      };

      /** Edit the active draft; a sale with no draft yet starts one. */
      const edit = (patch: (draft: CartDraft) => Partial<CartDraft>) => {
        const drafts = get().drafts;
        const activeId = get().draftId;
        if (!activeId) {
          const seed = draftFor(get().customer);
          const fresh = { ...seed, ...patch(seed) };
          writeDrafts([...drafts, fresh], fresh.id);
          return;
        }
        writeDrafts(
          drafts.map((d) => (d.id === activeId ? { ...d, ...patch(d) } : d)),
          activeId,
        );
      };

      return {
        scopeKey: null,
        draftId: null,
        drafts: [],
        customer: null,
        items: EMPTY_ITEMS,
        discount: 0,
        carts: {},
        setScope: (scopeKey) => {
          const previous = get().scopeKey;
          if (scopeKey === previous) return;

          let carts = get().carts;
          if (previous && scopeKey === null) {
            // Signing out drops this account's half-finished sales from the device. Signing
            // another account in must not inherit them, and the signed-out device has no owner.
            const { [previous]: _discarded, ...rest } = carts;
            carts = rest;
          } else if (previous) {
            carts = {
              ...carts,
              [previous]: { drafts: get().drafts, activeId: get().draftId },
            };
          }

          const entry = scopeKey ? carts[scopeKey] : undefined;
          const active = entry?.drafts.find((d) => d.id === entry.activeId) ?? entry?.drafts[0] ?? null;
          set({
            scopeKey,
            carts,
            drafts: entry?.drafts ?? [],
            draftId: active?.id ?? null,
            customer: active?.customer ?? null,
            items: active?.items ?? EMPTY_ITEMS,
            discount: active?.discount ?? 0,
          });
        },
        setCustomer: (customer) => edit(() => ({ customer })),
        addItem: (item) => {
          const items = get().items;
          const existing = items.find((i) => i.variantId === item.variantId);
          if (!existing) {
            edit((d) => ({ items: [...d.items, item] }));
            return;
          }
          edit((d) => ({
            items: d.items.map((i) => {
              if (i.variantId !== item.variantId) return i;
              const qty = Math.min(i.qty + item.qty, i.maxQty);
              // The line's own discount survives a quantity change; it is money off this line,
              // not a rate that has to be worked out again.
              return { ...i, qty, lineTotal: lineNet(qty, i.unitPrice, i.discount) };
            }),
          }));
        },
        updateQty: (variantId, qty) => {
          if (qty <= 0) {
            get().removeItem(variantId);
            return;
          }
          edit((d) => ({
            items: d.items.map((i) => {
              if (i.variantId !== variantId) return i;
              const capped = Math.min(qty, i.maxQty);
              return { ...i, qty: capped, lineTotal: lineNet(capped, i.unitPrice, i.discount) };
            }),
          }));
        },
        removeItem: (variantId) =>
          edit((d) => ({ items: d.items.filter((i) => i.variantId !== variantId) })),
        setLineDiscount: (variantId, amount) =>
          edit((d) => ({
            items: d.items.map((i) => {
              if (i.variantId !== variantId) return i;
              const gross = i.qty * i.unitPrice;
              const discount = Math.min(Math.max(amount, 0), gross);
              return { ...i, discount, lineTotal: lineNet(i.qty, i.unitPrice, discount) };
            }),
          })),
        setDiscount: (amount) => {
          const cap = get().subtotal();
          edit(() => ({ discount: Math.min(Math.max(amount, 0), cap) }));
        },
        startSale: (customer) => {
          const { drafts, draftId } = get();
          const current = drafts.find((d) => d.id === draftId) ?? null;
          // The same customer's sale is the same sale: go back to it rather than splitting the
          // goods across two cards for one buyer.
          const sameCustomer = customer
            ? drafts.find((d) => d.customer?.id === customer.id)
            : null;
          if (sameCustomer) {
            writeDrafts(drafts, sameCustomer.id);
            return;
          }
          // An empty sale is not worth keeping: it becomes the new sale instead.
          if (current && current.items.length === 0 && drafts.length === 1) {
            edit(() => ({ customer, discount: 0 }));
            return;
          }
          const fresh = draftFor(customer);
          writeDrafts([...drafts, fresh], fresh.id);
        },
        switchDraft: (id) => {
          if (!get().drafts.some((d) => d.id === id)) return;
          writeDrafts(get().drafts, id);
        },
        removeDraft: (id) => {
          const drafts = get().drafts.filter((d) => d.id !== id);
          const nextActive =
            get().draftId === id ? drafts[drafts.length - 1]?.id ?? null : get().draftId;
          writeDrafts(drafts, nextActive);
        },
        clearCart: () => {
          const remaining = get().drafts.filter((d) => d.id !== get().draftId);
          writeDrafts(remaining, remaining[remaining.length - 1]?.id ?? null);
        },
        clearAll: () => writeDrafts([], null),
        subtotal: () => get().items.reduce((sum, item) => sum + item.lineTotal, 0),
        total: () => Math.max(0, get().subtotal() - get().discount),
      };
    },
    {
      name: "agrishop-cart",
      // The account key is deliberately not restored: the shell names the account after the
      // stored session is checked, so a previous account's rows can never render first.
      partialize: (state) => ({ carts: state.carts }),
      /**
       * Old devices hold one cart per account in the shape this store used before drafts. It is
       * folded into a single draft rather than thrown away: a half-finished sale is the shop's
       * work, not the app's storage detail.
       */
      merge: (persisted, current) => {
        const raw = (persisted as { carts?: Record<string, unknown> } | undefined)?.carts ?? {};
        const carts: Record<string, ScopeCarts> = {};
        for (const [scope, value] of Object.entries(raw)) {
          const v = value as Partial<ScopeCarts> & Partial<CartSnapshot>;
          if (Array.isArray(v.drafts)) {
            carts[scope] = {
              drafts: v.drafts as CartDraft[],
              activeId: (v.activeId as string | null) ?? (v.drafts as CartDraft[])[0]?.id ?? null,
            };
          } else if (Array.isArray(v.items)) {
            const draft: CartDraft = {
              id: newId(),
              customer: v.customer ?? null,
              items: v.items,
              discount: v.discount ?? 0,
              startedAt: new Date().toISOString(),
            };
            carts[scope] = { drafts: [draft], activeId: draft.id };
          }
        }
        return {
          ...current,
          carts,
          drafts: [],
          draftId: null,
          customer: null,
          items: [],
          discount: 0,
          scopeKey: null,
        };
      },
    },
  ),
);
