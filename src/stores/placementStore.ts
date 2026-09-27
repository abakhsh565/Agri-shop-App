import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Which screen a shop-level row lives on — Settings or the owner suite.
 *
 * Settings is the place for the phone and the person: language, dark mode, the PIN, signing
 * out. The owner suite is the place for the shop: its people, its stock, its roles. Every row
 * that could reasonably sit on either one starts on the side it belongs to, and this store is
 * the one thing that lets an owner put it on the other — because which of the two a shopkeeper
 * thinks of first is a habit, not a correct answer.
 *
 * The choice is remembered per account *and* per shop, and only on this device: it is a
 * preference about a layout, so it never goes near a table, and signing in as somebody else
 * shows them their own arrangement rather than the last person's.
 */

export type Screen = "settings" | "suite";

interface PlacementState {
  /** `userId|shopId` → `{ rowId: screen }`. Absent means the row's own default. */
  byOwner: Record<string, Record<string, Screen>>;
  move: (owner: string, rowId: string, screen: Screen) => void;
  /** Back to the shipped arrangement, for the owner who wants the default back. */
  resetOwner: (owner: string) => void;
}

export const usePlacementStore = create<PlacementState>()(
  persist(
    (set) => ({
      byOwner: {},
      move: (owner, rowId, screen) =>
        set((state) => ({
          byOwner: { ...state.byOwner, [owner]: { ...(state.byOwner[owner] ?? {}), [rowId]: screen } },
        })),
      resetOwner: (owner) =>
        set((state) => {
          const next = { ...state.byOwner };
          delete next[owner];
          return { byOwner: next };
        }),
    }),
    { name: "agrishop-row-placement", version: 0 }
  )
);

/**
 * One owner's arrangement, as a plain lookup. `owner` is `userId|shopId`: the same person in two
 * shops can keep the two arrangements they actually work with.
 */
export function placementFor(owner: string): Record<string, Screen> {
  return usePlacementStore.getState().byOwner[owner] ?? {};
}
