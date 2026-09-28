import type { BaseUnit, ProductCategory } from "@/types";
import type { PackDisplayUnit } from "@/lib/packSize";

/**
 * A product someone started adding and did not finish.
 *
 * This is deliberately **not** a row in the database. A product that was never saved is not
 * stock, has no price, and must not appear in a sale, a report or another branch's list — and
 * a half-typed form has no business being visible to anyone but the person who typed it. So it
 * lives on the device that typed it, keyed by branch, and is thrown away the moment the real
 * product is saved. Nothing else in the app needs to know it exists except the two screens
 * that show it: the form that fills it, and the inventory list that offers it back.
 *
 * (If drafts should follow the owner from phone to tablet, this becomes a table with a
 * migration and row-level security — the module's whole surface is the five functions below,
 * so that swap stays inside this file.)
 */

/** One pack, exactly as the form holds it — numbers as strings, because inputs hold strings. */
export interface ProductDraftPack {
  id?: string;
  expiryDate: string;
  stockQty: string;
  sellingPrice: string;
  costPrice: string;
  markup: string;
  sizeValue: string;
  sizeUnit: PackDisplayUnit;
  qtyStep: string;
  lowStockThreshold: string;
  typedName: string;
  named: boolean;
}

export interface ProductDraft {
  id: string;
  /** ISO. The list sorts on it and shows it as "Saved 10 minutes ago". */
  updatedAt: string;
  /** The branch this belongs to. A draft is never offered in another branch. */
  shopId: string;
  name: string;
  company: string;
  category: ProductCategory;
  baseUnit: BaseUnit;
  barcode: string;
  /** Kept as the form's value, which is a URL. A huge data-URL photo can bust the quota,
   *  which is what `saveProductDraft` reports back rather than failing silently. */
  imageUrl: string | null;
  packs: ProductDraftPack[];
}

/** The four things `handleSave` refuses to save without, as a draft can be missing any of them. */
export type DraftMissingField = "name" | "supplier" | "size" | "price";

const STORAGE_KEY = "agrishop.productDrafts.v1";

/**
 * `{ [shopId]: ProductDraft[] }`.
 *
 * Keyed by branch rather than holding a `shopId` inside a flat list, so a draft *cannot* be
 * read into the wrong branch by a filter that someone later forgets to write.
 */
type DraftBook = Record<string, ProductDraft[]>;

function readBook(): DraftBook {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as DraftBook;
  } catch {
    // Corrupt, unreadable, or blocked (private mode): no drafts is the only safe answer —
    // and the screens that offer them simply render nothing.
    return {};
  }
}

/** Write the book, dropping the photo rather than the draft when the quota is the obstacle. */
function writeBook(book: DraftBook, withImage: boolean): { ok: boolean; droppedImage: boolean } {
  try {
    if (!withImage) {
      for (const list of Object.values(book)) {
        for (const draft of list) draft.imageUrl = null;
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
    return { ok: true, droppedImage: !withImage };
  } catch {
    if (withImage) return writeBook(book, false);
    return { ok: false, droppedImage: false };
  }
}

export function draftNewId(): string {
  // Not `crypto.randomUUID` only: it is missing on an old WebView, and a draft id only has to
  // be unique within one device's storage.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** This branch's drafts, newest first. */
export function loadProductDrafts(shopId: string | null | undefined): ProductDraft[] {
  if (!shopId) return [];
  const list = readBook()[shopId] ?? [];
  if (list.length === 0) return [];
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProductDraft(shopId: string | null | undefined, id: string): ProductDraft | null {
  if (!shopId || !id) return null;
  return (readBook()[shopId] ?? []).find((d) => d.id === id) ?? null;
}

export function saveProductDraft(draft: ProductDraft): { ok: boolean; droppedImage: boolean } {
  const book = readBook();
  const list = book[draft.shopId] ?? [];
  const stamped = { ...draft, updatedAt: new Date().toISOString() };
  const index = list.findIndex((d) => d.id === draft.id);
  if (index >= 0) list[index] = stamped;
  else list.push(stamped);
  book[draft.shopId] = list;
  return writeBook(book, true);
}

export function deleteProductDraft(shopId: string | null | undefined, id: string): void {
  if (!shopId || !id) return;
  const book = readBook();
  const list = book[shopId] ?? [];
  const kept = list.filter((d) => d.id !== id);
  if (kept.length === list.length) return;
  if (kept.length === 0) delete book[shopId];
  else book[shopId] = kept;
  writeBook(book, true);
}

/**
 * Did anyone actually type something worth keeping?
 *
 * The test is the same one the save button applies: the four fields a product cannot be
 * created without. Opening the form and immediately going back must not leave a draft behind,
 * and a screen that auto-fills a supplier from the page you arrived from does not count as
 * someone's work.
 */
export function draftHasContent(input: {
  name: string;
  company: string;
  barcode: string;
  packs: ProductDraftPack[];
}): boolean {
  if (input.name.trim() || input.company.trim() || input.barcode.trim()) return true;
  return input.packs.some(
    (p) =>
      p.sizeValue.trim() ||
      p.sellingPrice.trim() ||
      p.costPrice.trim() ||
      p.stockQty.trim() ||
      p.expiryDate.trim()
  );
}

/** What is still missing before this can become a product. Empty means it is ready. */
export function draftMissingFields(input: {
  name: string;
  company: string;
  packs: ProductDraftPack[];
}): DraftMissingField[] {
  const missing: DraftMissingField[] = [];
  if (!input.name.trim()) missing.push("name");
  if (!input.company.trim()) missing.push("supplier");
  if (input.packs.length === 0 || input.packs.some((p) => !(Number(p.sizeValue) > 0))) missing.push("size");
  if (input.packs.length === 0 || input.packs.some((p) => !(Number(p.sellingPrice) > 0))) missing.push("price");
  return missing;
}
