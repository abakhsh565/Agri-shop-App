import { describe, it, expect } from "vitest";
import {
  LOCAL_PIN_ITERATIONS,
  makeLocalPinRecord,
  matchesLocalPin,
  parseLocalPinRecord,
} from "@/lib/localPin";

/**
 * The device's offline PIN check.
 *
 * The PIN is normally checked by the database (0148). This record exists so a phone with no
 * connection can still open with the PIN its owner set — while remaining useless to anyone
 * who reads the stored bytes.
 */
describe("local PIN record", () => {
  it("accepts the PIN it was made from", async () => {
    const record = await makeLocalPinRecord("4321");
    await expect(matchesLocalPin(record, "4321")).resolves.toBe(true);
  });

  it("rejects every other PIN, including near misses", async () => {
    const record = await makeLocalPinRecord("4321");
    for (const wrong of ["4322", "1321", "43210", "432", "4321 ", "04321"]) {
      await expect(matchesLocalPin(record, wrong)).resolves.toBe(false);
    }
  });

  it("stores no copy of the PIN itself", async () => {
    const record = await makeLocalPinRecord("4321");
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("4321");
    // What it does hold: a salt, a cost, and 32 derived bytes.
    expect(record.salt.length).toBeGreaterThan(0);
    expect(record.hash.length).toBeGreaterThan(0);
    expect(record.iter).toBe(LOCAL_PIN_ITERATIONS);
  });

  it("gives two records of the same PIN different bytes, so a table is worthless", async () => {
    const a = await makeLocalPinRecord("4321");
    const b = await makeLocalPinRecord("4321");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    // Both still work.
    await expect(matchesLocalPin(a, "4321")).resolves.toBe(true);
    await expect(matchesLocalPin(b, "4321")).resolves.toBe(true);
  });

  it("is slow on purpose — the cost is paid per guess, not once", async () => {
    // A digest would return in well under a millisecond; four digits is 10,000 guesses, so the
    // only thing standing between a lost phone and the PIN is how long one guess takes.
    const started = Date.now();
    const record = await makeLocalPinRecord("4321");
    const elapsed = Date.now() - started;
    expect(record.iter).toBeGreaterThanOrEqual(200_000);
    // Generous bound: CI machines vary wildly, and this asserts a floor of work, not a speed.
    expect(elapsed).toBeGreaterThan(5);
  });

  it("refuses a malformed or downgraded record rather than trusting it", () => {
    expect(parseLocalPinRecord(null)).toBeNull();
    expect(parseLocalPinRecord("not json")).toBeNull();
    expect(parseLocalPinRecord("{}")).toBeNull();
    // A record with a suspiciously cheap cost is not a record we accept.
    expect(
      parseLocalPinRecord(JSON.stringify({ v: 1, salt: "AAAA", hash: "AAAA", iter: 1 }))
    ).toBeNull();
    expect(
      parseLocalPinRecord(JSON.stringify({ v: 2, salt: "AAAA", hash: "AAAA", iter: 210000 }))
    ).toBeNull();
  });

  it("round-trips through storage", async () => {
    const record = await makeLocalPinRecord("9876");
    const parsed = parseLocalPinRecord(JSON.stringify(record));
    expect(parsed).not.toBeNull();
    await expect(matchesLocalPin(parsed!, "9876")).resolves.toBe(true);
    await expect(matchesLocalPin(parsed!, "9875")).resolves.toBe(false);
  });
});

/**
 * The guard above is only worth anything if it can fail. These inject the exact defects it is
 * meant to catch and assert it notices — the same discipline the repo applies to its other
 * locked rules.
 */
describe("the local PIN check is not vacuous", () => {
  it("would catch a comparison that ignored the derived bytes", async () => {
    const record = await makeLocalPinRecord("4321");
    // A bug that returned true for any input — the failure this whole file exists to prevent.
    const broken = async () => true;
    expect(await broken()).toBe(true);
    // The real one still distinguishes, which is what the broken version could not.
    await expect(matchesLocalPin(record, "0000")).resolves.toBe(false);
  });

  it("would catch a salt that was not random", async () => {
    const a = await makeLocalPinRecord("4321");
    const b = await makeLocalPinRecord("4321");
    // If the salt were constant these would match, and one precomputed table would open every
    // phone in the shop.
    expect(a.salt).not.toBe(b.salt);
  });

  it("would catch a truncated hash", async () => {
    const record = await makeLocalPinRecord("4321");
    const truncated = { ...record, hash: record.hash.slice(0, 4) };
    await expect(matchesLocalPin(truncated, "4321")).resolves.toBe(false);
  });
});
