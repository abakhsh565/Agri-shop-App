/**
 * A card is the detail of an answer — never decoration.
 *
 * THE REPORT. Asked "how to calculate profit?", the assistant answered correctly and then drew a
 * full-width card underneath reading "Nothing saved for that" with "undefined" below it: the model
 * had called `help_topic`, no guide entry matched, and the server attached a payload with
 * `topicsMatched: 0` which the chat rendered as a large empty state. The block was taller than the
 * answer and contradicted it.
 *
 * WHAT IS PINNED HERE
 *   1. The server does not build a card for a result with no detail (help with no entry, no facts,
 *      or a tool that opts out).
 *   2. It still builds one where there is detail — an informative emptiness included, because
 *      "Nothing is running out" is the answer to that question.
 *   3. The chat's own predicate agrees, so an older payload cannot paint an empty block.
 */
import { describe, it, expect } from "vitest";
import { widgetFor } from "../../supabase/functions/assistant/providers.mjs";
import { widgetWorthShowing } from "@/lib/assistantWidget";
import type { AssistantWidget } from "@/lib/assistant";

const salesCard: AssistantWidget = {
  tool: "sales_summary",
  title: "Today's sales",
  facts: { sales: 4, revenue: 19750, period: "today" },
  notes: [],
  sources: [],
};

describe("a card is attached only when there is detail", () => {
  it("draws nothing for a guide question with no matching entry", () => {
    // Exactly the payload that produced the reported block.
    const result = {
      tool: "help_topic",
      title: "Not sure",
      spoken: 'I do not have a saved explanation for "how to calculate profit?" yet.',
      facts: { query: "", topicsMatched: 0, topicCount: 24 },
      sources: [],
    };
    expect(widgetFor(result)).toBeNull();
    expect(widgetWorthShowing({ ...salesCard, tool: "help_topic", facts: result.facts })).toBe(false);
  });

  it("still draws the guide when an entry did match", () => {
    const result = {
      tool: "help_topic",
      title: "Recording a sale",
      spoken: "Open Sales, then New sale.",
      facts: { topicsMatched: 1, steps: ["Open Sales", "Tap New sale"] },
      sources: [],
    };
    const card = widgetFor(result);
    expect(card).not.toBeNull();
    expect(card.tool).toBe("help_topic");
    expect(widgetWorthShowing(card)).toBe(true);
  });

  it("drops a payload with no facts at all", () => {
    expect(widgetFor({ tool: "sales_summary", spoken: "Nothing yet.", facts: {} })).toBeNull();
    expect(widgetFor({ tool: "sales_summary", spoken: "Nothing yet." })).toBeNull();
    expect(widgetFor(null)).toBeNull();
  });

  it("lets a tool opt out of a card", () => {
    expect(widgetFor({ tool: "help_topic", facts: { topicsMatched: 2 }, widget: false })).toBeNull();
  });

  it("keeps an informative empty — the emptiness IS the answer", () => {
    const card = widgetFor({
      tool: "low_stock",
      title: "Low stock",
      spoken: "Nothing is running out.",
      facts: { products: [], period: "now" },
      sources: [],
    });
    expect(card).not.toBeNull();
    expect(widgetWorthShowing(card)).toBe(true);
  });

  it("keeps the ordinary detail card", () => {
    const card = widgetFor({
      tool: "sales_summary",
      title: "Today's sales",
      spoken: "Four sales, 19,750 rupees.",
      facts: salesCard.facts,
      sources: salesCard.sources,
    });
    expect(card).not.toBeNull();
    expect(widgetWorthShowing(card)).toBe(true);
  });

  it("the chat predicate refuses what the server refuses, and nothing else it shouldn't", () => {
    expect(widgetWorthShowing(null)).toBe(false);
    expect(widgetWorthShowing({ ...salesCard, tool: "" })).toBe(false);
    expect(widgetWorthShowing({ ...salesCard, facts: {} })).toBe(false);
    expect(widgetWorthShowing(salesCard)).toBe(true);
  });
});
