import { describe, expect, it } from "vitest";
import { parseQuickAdd, quickAddAmount } from "@/lib/quickAdd";

/**
 * The quick-add reader, pinned by the sentences an owner actually writes.
 *
 * It is deliberately a suggestion engine, so these cases are about not being confidently wrong:
 * a sale must not become income, a quantity must not become a price, and a missing party must
 * stay missing rather than borrowing the word after "to".
 */
describe("quick add — reading a sentence", () => {
  it("reads an expense with a currency, a party, a category and a method", () => {
    const draft = parseQuickAdd("Paid Rs 5,000 cash to Malik for shop rent");
    expect(draft.amount).toBe(5000);
    expect(draft.kind).toBe("expense");
    expect(draft.party).toBe("Malik");
    expect(draft.category).toBe("rent");
    expect(draft.method).toBe("cash");
    expect(draft.looksLikeSale).toBe(false);
  });

  it("reads an income sentence and keeps the name after from", () => {
    const draft = parseQuickAdd("received 12k from Ahmed for milk");
    expect(draft.amount).toBe(12000);
    expect(draft.kind).toBe("income");
    expect(draft.party).toBe("Ahmed");
    expect(draft.category).toBe("other_income");
  });

  it("reads a drawing without calling it an expense", () => {
    const draft = parseQuickAdd("Took out 3,000 for personal use");
    expect(draft.amount).toBe(3000);
    expect(draft.kind).toBe("drawing");
    expect(draft.category).toBe("personal_use");
  });

  it("never files a sale as income: it marks the sentence and leaves the kind empty", () => {
    const draft = parseQuickAdd("sold 2 bags of rice for 8000 to Kamal");
    expect(draft.looksLikeSale).toBe(true);
    expect(draft.kind).toBeNull();
    expect(draft.amount).toBe(8000);
    expect(draft.party).toBe("Kamal");
  });

  it("reads a multiplier and a category without a party", () => {
    const draft = parseQuickAdd("paid 1.5 lakh rent");
    expect(draft.amount).toBe(150000);
    expect(draft.kind).toBe("expense");
    expect(draft.category).toBe("rent");
    expect(draft.party).toBe("");
  });

  it("prefers the price over the quantity in a stock sentence", () => {
    const draft = parseQuickAdd("bought 5 kg fertilizer for 2500");
    expect(draft.amount).toBe(2500);
    expect(draft.kind).toBe("expense");
    expect(draft.category).toBe("stock_purchase");
    expect(draft.party).toBe("");
  });

  it("returns no amount when the only numbers are quantities", () => {
    expect(quickAddAmount("bought 2 bags and 5 kg rice")).toBeNull();
  });

  it("reads the digits an Urdu keyboard produces", () => {
    const draft = parseQuickAdd("کرایہ ۵۰۰۰ ادا کیا");
    expect(draft.amount).toBe(5000);
    expect(draft.kind).toBe("expense");
    expect(draft.category).toBe("rent");
  });

  it("lets a category supply the kind when the verb is missing", () => {
    const draft = parseQuickAdd("5000 rent");
    expect(draft.kind).toBe("expense");
    expect(draft.category).toBe("rent");
  });

  it("does not turn a generic noun into a party", () => {
    expect(parseQuickAdd("paid 5000 to the bank").party).toBe("");
    expect(parseQuickAdd("paid 5000 to supplier").party).toBe("");
    expect(parseQuickAdd("paid 5000 cash").party).toBe("");
  });

  it("recognises the digital wallets", () => {
    expect(parseQuickAdd("received 3000 easypaisa from Bilal").method).toBe("easypaisa");
    expect(parseQuickAdd("paid 7000 jazz cash to Hamza").method).toBe("jazzcash");
    expect(parseQuickAdd("paid 7000 by cheque to Hamza").method).toBe("bank");
  });

  it("keeps the sentence as the note and says whether it understood anything", () => {
    const draft = parseQuickAdd("paid 900 for tea");
    expect(draft.note).toBe("paid 900 for tea");
    expect(draft.matched).toBe(true);
    expect(parseQuickAdd("").matched).toBe(false);
    expect(parseQuickAdd("   ").matched).toBe(false);
  });

  it("does not mistake a bare sentence for money", () => {
    const draft = parseQuickAdd("how much did I earn today");
    expect(draft.amount).toBeNull();
    expect(draft.looksLikeSale).toBe(false);
  });
});
