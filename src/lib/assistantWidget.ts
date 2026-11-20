import type { AssistantWidget } from "@/lib/assistant";

/**
 * Is this card worth showing at all?
 *
 * WHY. The chat used to draw a card for every tool a model happened to call. Asked "how to
 * calculate profit?", the answer was already correct, and then a full-width card appeared under it
 * reading "Nothing saved for that" with "undefined" beneath — no detail, no context, and taller
 * than the answer it sat below. A card is the detail of an answer; when there is no detail, the
 * sentence is the whole answer.
 *
 * The rule is the same one the server applies when it builds the payload, restated here so an older
 * payload (or a hand-built one) cannot paint an empty block:
 *   · no tool → nothing to draw;
 *   · no facts → nothing to draw;
 *   · a guide answer that matched no entry → nothing to draw (the sentence says so already).
 *
 * Informative empties are kept: "Nothing is running out" from `low_stock` carries facts, and that
 * emptiness is the answer to the question. This predicate asks whether there is a payload, not
 * whether the payload is cheerful.
 */
export function widgetWorthShowing(widget: AssistantWidget | null | undefined): boolean {
  if (!widget || !widget.tool) return false;
  const facts = widget.facts ?? {};
  if (Object.keys(facts).length === 0) return false;
  if (widget.tool === "help_topic" && !Number((facts as Record<string, unknown>).topicsMatched)) {
    return false;
  }
  return true;
}
