/**
 * Work that gave up must not disappear.
 *
 * A queued sale is money the cashier already took. When every retry is used the item stops
 * blocking the app — that is what let a shop change branch again — but the payload has to stay
 * on the device, visibly, until a person retries it or throws it away on purpose. This lane
 * checks the three ways it could be lost: the switch deleting it, the sync pass skipping it into
 * nothing, and a retry that never comes back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  discardParkedItem,
  enqueueOperation,
  getBlockingPendingCount,
  getParkedItems,
  loadQueue,
  parkExhausted,
  retryParked,
  saveQueue,
  syncPendingOperations,
} from "@/lib/offlineQueue";
import { confirmCacheBranch } from "@/lib/localCache";

const SALE = { type: "create_sale" as const, payload: { idempotencyKey: "sale-1", total: 1200 } };
const OWNER = { tenantId: "business", userId: "owner", branchId: "main" };

describe("offline queue: exhausted work is parked, not discarded", () => {
  beforeEach(() => {
    localStorage.clear();
    saveQueue([]);
    confirmCacheBranch("business", "owner", "main");
  });

  it("parks an item after its last failed attempt, keeping every byte of the sale", async () => {
    const id = enqueueOperation(SALE);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "network is down" } });

    for (let attempt = 0; attempt < 5; attempt += 1) await syncPendingOperations({ rpc });

    const [item] = loadQueue();
    expect(item.id).toBe(id);
    expect(item.retries).toBe(5);
    expect(item.parked).toBe(true);
    expect(item.parkedAt).toBeTruthy();
    expect(item.lastError).toBe("network is down");
    expect(item.operation).toEqual(SALE);
    expect(item.context).toEqual({ tenantId: "business", userId: "owner", branchId: "main" });
  });

  it("stops blocking a branch switch once parked", () => {
    saveQueue([
      { id: "a", operation: SALE, queuedAt: "2026-11-25T00:00:00Z", retries: 5, lastError: "x", context: OWNER },
      { id: "b", operation: SALE, queuedAt: "2026-11-25T00:00:01Z", retries: 2, context: OWNER },
    ]);
    // The exhausted sale is no longer "waiting to send", so it does not block the switch; the
    // retryable one does, because it can still be delivered on its own.
    expect(getBlockingPendingCount()).toBe(1);
    expect(parkExhausted()).toBe(1);
    expect(getBlockingPendingCount()).toBe(1);
    // Nothing left the device, and the sale that gave up is the one on the parked list.
    expect(loadQueue()).toHaveLength(2);
    expect(getParkedItems().map((item) => item.id)).toEqual(["a"]);
    expect(loadQueue().find((item) => item.id === "a")?.operation).toEqual(SALE);
  });

  it("leaves parked work alone in a later sync, and no failure is invented", async () => {
    saveQueue([{ id: "parked", operation: SALE, queuedAt: "2026-11-25T00:00:00Z", retries: 5, parked: true, context: OWNER }]);
    const rpc = vi.fn();
    const result = await syncPendingOperations({ rpc });
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 0, failed: 0, errors: [] });
    expect(loadQueue()[0].operation).toEqual(SALE);
  });

  it("sends a parked sale after a person retries it", async () => {
    saveQueue([{ id: "parked", operation: SALE, queuedAt: "2026-11-25T00:00:00Z", retries: 5, parked: true, lastError: "down", context: OWNER }]);
    expect(retryParked("parked")).toBe(true);
    expect(getBlockingPendingCount()).toBe(1);

    const rpc = vi.fn().mockResolvedValue({ data: { id: "server-sale" }, error: null });
    expect((await syncPendingOperations({ rpc })).synced).toBe(1);
    expect(rpc).toHaveBeenCalledWith("create_sale", {
      payload: { idempotencyKey: "sale-1", total: 1200, branchId: "main", shopId: "business" },
    });
    expect(loadQueue()).toEqual([]);
  });

  it("removes it only when that person discards it", () => {
    saveQueue([{ id: "parked", operation: SALE, queuedAt: "2026-11-25T00:00:00Z", retries: 5, parked: true, context: OWNER }]);
    parkExhausted();
    expect(discardParkedItem("parked")).toBe(true);
    expect(loadQueue()).toEqual([]);
    expect(discardParkedItem("parked")).toBe(false);
  });
});
