import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteProductDraft,
  draftHasContent,
  draftMissingFields,
  draftNewId,
  getProductDraft,
  loadProductDrafts,
  saveProductDraft,
  type ProductDraft,
  type ProductDraftPack,
} from "@/lib/productDraft";

/**
 * Drafts are the one thing in this app that exists in no table, so nothing else can check
 * them: not a migration, not row-level security, not a foreign key. What is asserted here is
 * what the database would otherwise have enforced for us —
 *
 *   - a draft belongs to exactly one branch and cannot be read from another (the moment it
 *     leaks, one shop's unfinished work appears in a different shop's list),
 *   - an untouched form leaves nothing behind (a draft nobody typed is litter that the owner
 *     then has to clean up by hand),
 *   - a draft that cannot be stored never claims to have been stored.
 */

function memoryStorage(onSet?: (value: string) => void): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      onSet?.(v);
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

function blankPack(): ProductDraftPack {
  return {
    stockQty: "",
    sellingPrice: "",
    costPrice: "",
    markup: "",
    sizeValue: "",
    sizeUnit: "kg",
    qtyStep: "1",
    lowStockThreshold: "10",
    typedName: "",
    named: false,
    expiryDate: "",
  };
}

function draft(shopId: string, overrides: Partial<ProductDraft> = {}): ProductDraft {
  return {
    id: draftNewId(),
    updatedAt: new Date().toISOString(),
    shopId,
    name: "Karate",
    company: "Bayer",
    category: "pesticide",
    baseUnit: "kg",
    barcode: "",
    imageUrl: null,
    packs: [blankPack()],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("a draft belongs to one branch", () => {
  it("is offered back in the branch that made it", () => {
    const saved = saveProductDraft(draft("shop-a"));
    expect(saved.ok).toBe(true);
    expect(loadProductDrafts("shop-a").map((d) => d.name)).toEqual(["Karate"]);
  });

  it("is invisible from any other branch, by id as well as by list", () => {
    const saved = saveProductDraft(draft("shop-a"));
    expect(loadProductDrafts("shop-b")).toEqual([]);
    expect(getProductDraft("shop-b", saved.ok ? "unknown" : "")).toBeNull();
    const listed = loadProductDrafts("shop-a")[0];
    expect(getProductDraft("shop-b", listed.id)).toBeNull();
  });

  it("is not offered at all when there is no branch yet", () => {
    saveProductDraft(draft(""));
    expect(loadProductDrafts(null)).toEqual([]);
    expect(loadProductDrafts(undefined)).toEqual([]);
  });
});

describe("nothing is kept that nobody typed", () => {
  it("an untouched add-product form leaves no draft", () => {
    expect(draftHasContent({ name: "", company: "", barcode: "", packs: [blankPack()] })).toBe(false);
    expect(draftHasContent({ name: "   ", company: "", barcode: "", packs: [blankPack()] })).toBe(false);
  });

  it("any field of real work counts — a name, a supplier, a code, or a pack detail", () => {
    expect(draftHasContent({ name: "Karate", company: "", barcode: "", packs: [] })).toBe(true);
    expect(draftHasContent({ name: "", company: "Bayer", barcode: "", packs: [] })).toBe(true);
    expect(draftHasContent({ name: "", company: "", barcode: "123", packs: [] })).toBe(true);
    expect(
      draftHasContent({ name: "", company: "", barcode: "", packs: [{ ...blankPack(), sellingPrice: "150" }] })
    ).toBe(true);
  });
});

describe("what a draft is still waiting for matches what saving refuses without", () => {
  it("names every missing field, in the order the form asks for them", () => {
    expect(draftMissingFields({ name: "", company: "", packs: [blankPack()] })).toEqual([
      "name",
      "supplier",
      "size",
      "price",
    ]);
  });

  it("is empty once the four things a product needs are there", () => {
    expect(
      draftMissingFields({
        name: "Karate",
        company: "Bayer",
        packs: [{ ...blankPack(), sizeValue: "1", sellingPrice: "150" }],
      })
    ).toEqual([]);
  });

  it("counts a pack with no size the same way the save does", () => {
    expect(
      draftMissingFields({ name: "Karate", company: "Bayer", packs: [{ ...blankPack(), sellingPrice: "150" }] })
    ).toEqual(["size"]);
  });
});

describe("storing a draft", () => {
  it("updates the same draft rather than piling up copies", () => {
    const first = draft("shop-a");
    saveProductDraft(first);
    saveProductDraft({ ...first, name: "Karate Gold" });
    const list = loadProductDrafts("shop-a");
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Karate Gold");
  });

  it("drops an oversized photo instead of losing the typing with it", () => {
    let rejectPhotos = true;
    vi.stubGlobal(
      "localStorage",
      memoryStorage((value) => {
        if (rejectPhotos && value.includes("data:image")) {
          rejectPhotos = false;
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        }
      })
    );
    const outcome = saveProductDraft(draft("shop-a", { imageUrl: "data:image/png;base64,AAAA" }));
    expect(outcome.ok).toBe(true);
    expect(outcome.droppedImage).toBe(true);
    expect(loadProductDrafts("shop-a")[0].name).toBe("Karate");
    expect(loadProductDrafts("shop-a")[0].imageUrl).toBeNull();
  });

  it("reports failure rather than claiming a save it could not make", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage(() => {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      })
    );
    expect(saveProductDraft(draft("shop-a")).ok).toBe(false);
  });

  it("reads storage that has been corrupted as no drafts, not as a crash", () => {
    localStorage.setItem("agrishop.productDrafts.v1", "not json at all");
    expect(loadProductDrafts("shop-a")).toEqual([]);
  });
});

describe("discarding", () => {
  it("removes it, and leaves the other branch's draft alone", () => {
    const mine = draft("shop-a");
    saveProductDraft(mine);
    saveProductDraft(draft("shop-b"));
    deleteProductDraft("shop-a", mine.id);
    expect(loadProductDrafts("shop-a")).toEqual([]);
    expect(loadProductDrafts("shop-b")).toHaveLength(1);
  });
});
