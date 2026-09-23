import { describe, it, expect, beforeEach } from "vitest";
import {
  adoptCacheOwner,
  clearAllCachedData,
  getCachedData,
  setCachedData,
} from "@/lib/localCache";

// Cached rows paint instantly on the next launch, so they must never outlive the
// identity that fetched them: a shared device would otherwise show one shop's
// customers, products and sales to the next person who signs in.
describe("cache ownership", () => {
  beforeEach(() => localStorage.clear());

  it("keeps serving rows to the identity that cached them", () => {
    adoptCacheOwner("shop-1:user-1");
    setCachedData("products", [{ id: "p1" }]);

    adoptCacheOwner("shop-1:user-1");

    expect(getCachedData("products")).toEqual([{ id: "p1" }]);
  });

  it("drops rows cached under another shop or user", () => {
    adoptCacheOwner("shop-1:user-1");
    setCachedData("products", [{ id: "p1" }]);
    setCachedData("customers", [{ id: "c1" }]);
    setCachedData("sales", [{ id: "s1" }]);

    adoptCacheOwner("shop-2:user-9");

    expect(getCachedData("products")).toBeNull();
    expect(getCachedData("customers")).toBeNull();
    expect(getCachedData("sales")).toBeNull();
  });

  it("leaves nothing behind after signing out", () => {
    adoptCacheOwner("shop-1:user-1");
    setCachedData("sales", [{ id: "s1" }]);

    clearAllCachedData();

    expect(getCachedData("sales")).toBeNull();
    expect(localStorage.getItem("agrishop_cache_owner")).toBeNull();
  });
});
