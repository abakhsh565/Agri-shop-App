import { describe, expect, it } from "vitest";
import type { Customer, CropConfig } from "@/types";
import type { LocalCreditRequest } from "@/lib/localGroupRegistry";
import {
  isFlaggedRed,
  latestRedCreditOverride,
  nextHarvestWindow,
  summariseSentToday,
} from "@/lib/quickAlerts";

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "c1",
    name: "Ahsan Iqbal",
    phone: "03001234567",
    address: "Lahore",
    creditLimit: 5_000,
    outstandingBalance: 5_000,
    totalPurchases: 10_000,
    totalPaid: 5_000,
    dueDate: null,
    createdAt: "2026-10-01T10:00:00+05:00",
    createdBy: "owner",
    isArchived: false,
    ...overrides,
  };
}

function request(overrides: Partial<LocalCreditRequest> = {}): LocalCreditRequest {
  return {
    id: "r1",
    customerId: "c1",
    customerName: "Ahsan Iqbal",
    requestedBy: "Ali",
    currentLimit: 1_000,
    requestedLimit: 2_000,
    approvedLimit: 2_000,
    status: "approved",
    reviewedBy: "Yaqub",
    reviewedAt: "2026-11-03T04:00:00Z",
    rejectionReason: null,
    reason: "Seasonal fertiliser",
    createdAt: "2026-11-03T03:00:00Z",
    ...overrides,
  };
}

describe("quick alert rules", () => {
  it("flags a customer at 80% of the limit and keeps a fully paid customer clear", () => {
    expect(isFlaggedRed(customer({ outstandingBalance: 4_000 }))).toBe(true);
    expect(isFlaggedRed(customer({ outstandingBalance: 3_999 }))).toBe(false);
    expect(isFlaggedRed(customer({ outstandingBalance: 0 }))).toBe(false);
  });

  it("selects the newest approved override that is still red, not the newest approval overall", () => {
    const red = customer({ id: "c1", outstandingBalance: 5_000 });
    const clear = customer({ id: "c2", outstandingBalance: 0 });
    const redApproval = request({ id: "red", customerId: "c1", reviewedAt: "2026-11-03T04:00:00Z" });
    const newerClearApproval = request({ id: "clear", customerId: "c2", reviewedAt: "2026-11-03T05:00:00Z" });

    const event = latestRedCreditOverride(
      [redApproval, newerClearApproval],
      [red, clear],
      new Date("2026-11-03T12:00:00Z"),
    );

    expect(event?.request.id).toBe("red");
    expect(event?.approvedAmount).toBe(2_000);
  });

  it("uses the next occurrence of a harvest and counts only farmers who still owe", () => {
    const today = new Date("2026-11-03T10:00:00+05:00");
    const crops: CropConfig[] = [{ name: "Cotton", harvestMonth: 11, harvestDay: 8 }];
    const farmers = [
      customer({ id: "c1", name: "Ahsan", outstandingBalance: 2_000 }),
      customer({ id: "c2", name: "Bilal", outstandingBalance: 0 }),
      customer({ id: "c3", name: "Nadia", outstandingBalance: 900, isArchived: true }),
    ];
    const map = { c1: ["Cotton"], c2: ["Cotton"], c3: ["Cotton"] };

    const window = nextHarvestWindow(crops, farmers, map, today);

    expect(window?.date).toBe("2026-11-08");
    expect(window?.days).toBe(5);
    expect(window?.allFarmers.map((row) => row.id)).toEqual(["c1", "c2"]);
    expect(window?.farmers.map((row) => row.id)).toEqual(["c1"]);
    expect(window?.outstanding).toBe(2_000);
  });

  it("rolls a passed harvest to next year rather than reporting a negative countdown", () => {
    const today = new Date("2026-11-03T10:00:00+05:00");
    const crops: CropConfig[] = [{ name: "Wheat", harvestMonth: 10, harvestDay: 1 }];

    const window = nextHarvestWindow(crops, [], {}, today, 400);

    expect(window?.date).toBe("2027-10-01");
    expect(window?.days).toBeGreaterThan(300);
  });

  it("counts reminder logs by Pakistan day and keeps the channel split", () => {
    const summary = summariseSentToday(
      [
        { channel: "whatsapp", customerId: "c1", sentAt: "2026-11-03T09:00:00+05:00" },
        { channel: "sms", customerId: "c1", sentAt: "2026-11-03T08:00:00+05:00" },
        // 23:00 PKT yesterday — UTC is still 2 November, so a UTC date slice would miss this.
        { channel: "sms", customerId: "c2", sentAt: "2026-11-02T23:00:00+05:00" },
      ],
      new Date("2026-11-03T10:00:00+05:00"),
    );

    expect(summary).toEqual({
      total: 2,
      whatsapp: 1,
      sms: 1,
      other: 0,
      customers: 1,
    });
  });
});
