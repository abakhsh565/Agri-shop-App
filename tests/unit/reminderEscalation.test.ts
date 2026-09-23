import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { DEFAULT_ESCALATION, escalationIsOrdered, escalationStages, escalationDistances } from "@/lib/reminderEngine";
import type { EscalationStep, ReminderConfig } from "@/types";

/**
 * "Escalating sequence" must actually escalate.
 *
 * The defect: the group reminder sheet shipped `escalation: []`, so choosing the
 * option rendered no steps at all and the engine collapsed the reminder to ONE
 * stage — the firmer follow-up and the final notice never happened, silently.
 *
 * These lock: the standard sequence, the ordering rule the sequence is locked to,
 * and the fact that there is only ONE definition of it.
 */

const step = (day: number): EscalationStep => ({ label: "Gentle", tone: "gentle nudge", day });

describe("the standard escalating sequence", () => {
  it("is gentle → firmer → final notice, at 15 / 30 / 45 days", () => {
    expect(DEFAULT_ESCALATION.map((s) => [s.label, s.day])).toEqual([
      ["Gentle", 15],
      ["Firmer", 30],
      ["Final notice", 45],
    ]);
  });

  it("maps each step to the tone the reminder message uses, in order", () => {
    expect(DEFAULT_ESCALATION.map((s) => s.tone)).toEqual([
      "gentle nudge",
      "firmer follow-up",
      "final notice",
    ]);
  });

  it("is ordered by its own rule", () => {
    expect(escalationIsOrdered(DEFAULT_ESCALATION)).toBe(true);
  });
});

describe("escalationIsOrdered — the sequence is locked to moving forward", () => {
  it("rejects an empty sequence (nothing to send, and the engine would fall back to one stage)", () => {
    expect(escalationIsOrdered([])).toBe(false);
  });

  it("rejects two steps on the same day", () => {
    expect(escalationIsOrdered([step(15), step(15)])).toBe(false);
  });

  it("rejects steps out of order, which would send the final notice before the firmer one", () => {
    expect(escalationIsOrdered([step(45), step(15)])).toBe(false);
  });

  it("rejects day 0 and negative days", () => {
    expect(escalationIsOrdered([step(0), step(30)])).toBe(false);
    expect(escalationIsOrdered([step(-5), step(30)])).toBe(false);
  });

  it("accepts a strictly increasing sequence", () => {
    expect(escalationIsOrdered([step(1), step(2), step(3)])).toBe(true);
    expect(escalationIsOrdered([step(60)])).toBe(true);
  });
});

describe("escalationStages — what the reminder will actually send", () => {
  const config = (escalation: EscalationStep[], startDays = 3): ReminderConfig => ({
    id: "c1",
    enabled: true,
    startDays,
    anchor: "before_due",
    repeat: "escalate",
    intervalN: 7,
    intervalUnit: "days",
    escalation,
    ends: "paid",
    endsDate: null,
    endsCount: 5,
  });

  it("sends all three steps, in order, when the sequence is the standard one", () => {
    expect(escalationStages(config(DEFAULT_ESCALATION)).map((s) => s.tone)).toEqual([
      "gentle nudge",
      "firmer follow-up",
      "final notice",
    ]);
  });

  it("collapses to ONE stage at the start offset when there is no sequence — the defect this guards", () => {
    const stages = escalationStages(config([], 3));
    expect(stages).toHaveLength(1);
    expect(stages[0].day).toBe(3);
  });

  it("a saved sequence of three is what makes the escalation real", () => {
    expect(escalationStages(config(DEFAULT_ESCALATION))).toHaveLength(3);
    expect(escalationStages(config(DEFAULT_ESCALATION)).length).toBeGreaterThan(
      escalationStages(config([])).length,
    );
  });
});

describe("escalationDistances — the sequence must escalate TOWARD the deadline", () => {
  it("gives the first step the largest distance, so it fires earliest", () => {
    const distances = escalationDistances(DEFAULT_ESCALATION);
    expect(distances).toEqual([45, 30, 15]);
  });

  it("an anchored date therefore moves later with each step", () => {
    // due date minus each distance: gentle furthest out, final notice closest in.
    const due = Date.parse("2026-09-23");
    const dates = escalationDistances(DEFAULT_ESCALATION).map((d) => new Date(due - d * 86400000).toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-08-09", "2026-08-24", "2026-09-08"]);
    expect(dates[0] < dates[1] && dates[1] < dates[2], "the escalation runs backwards in time").toBe(true);
  });

  it("keeps every distance the owner typed", () => {
    expect([...escalationDistances(DEFAULT_ESCALATION)].sort((a, b) => a - b)).toEqual([15, 30, 45]);
  });
});

describe("one definition, not one per screen", () => {
  const sheets = [
    "src/components/ui/GroupReminderSheet.tsx",
    "src/components/ui/ReminderConfigSheet.tsx",
  ];

  it("both creation screens take the sequence from the engine", () => {
    for (const path of sheets) {
      const src = readFileSync(path, "utf8");
      expect(src, `${path} does not use the shared sequence`).toContain("DEFAULT_ESCALATION");
      expect(src, `${path} does not enforce the ordering rule`).toContain("escalationIsOrdered");
    }
  });

  it("neither screen hardcodes its own copy of the steps", () => {
    for (const path of sheets) {
      const src = readFileSync(path, "utf8");
      expect(src, `${path} still hardcodes an escalation step`).not.toMatch(/tone:\s*"gentle nudge"/);
    }
  });
});
