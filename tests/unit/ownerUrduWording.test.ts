/**
 * The owner's own words, pinned.
 *
 * WHY. The owner is the one who hears customers at the counter, so the vocabulary on these few
 * everyday labels is his, not the translator's: "Aj tak" rather than "sab", "Bill banain" rather
 * than "invoice", "Ahm ittilaat" rather than "Action Center", "Kharidar" rather than "supplier",
 * "Yad dihani" rather than "follow-up". A later translation tidy-up would happily "improve" these
 * back to formal Urdu, and the person it would inconvenience is behind the counter, not in this
 * repository. So the wording is a test, and the test is the requirement.
 *
 * Only the labels he named are pinned. Compound screen copy that merely contains one of these
 * words (a form field reading "سپلائر چنیں") is deliberately left alone — those were not part of the
 * request, and some of them are selector text in browser lanes.
 */
import { describe, it, expect } from "vitest";
import { translations } from "@/lib/i18n";

const ur = translations.ur as Record<string, string>;

/** key → the owner's wording, exactly as he wrote it. */
const OWNER_WORDING: Record<string, string> = {
  "sale.addNewCustomer": "نیا گاہک شامل کریں",
  "addCustomer.title": "نیا گاہک شامل کریں",
  "sales.all": "آج تک",
  "nav.invoices": "بل بنائیں",
  "invoice.title": "بل",
  "invoice.new": "نیا بل بنائیں",
  "shopAction.dailyCash": "آج کا کیش",
  "inline.action_center": "اہم اطلاعات",
  "actionCenter.followUp": "یاد دہانی",
  "admin.followUpNeeded": "یاد دہانی درکار ہے",
  "common.supplier": "خریدار",
  "shopAction.suppliers": "خریدار",
  "reports.creditCollected": "ادھار کی وصولی",
  "dashboard.creditCollected": "ادھار کی وصولی",
};

describe("the owner's everyday Urdu wording", () => {
  for (const [key, wording] of Object.entries(OWNER_WORDING)) {
    it(`${key} reads «${wording}»`, () => {
      expect(ur[key], `${key} has drifted from the owner's wording`).toBe(wording);
    });
  }

  it("has no 'supplier' left on the supplier-facing labels he named", () => {
    for (const key of ["common.supplier", "shopAction.suppliers"]) {
      expect(ur[key]).not.toMatch(/سپلائر/);
    }
  });

  it("has no 'follow up' left where he asked for یاد دہانی", () => {
    for (const key of ["actionCenter.followUp", "admin.followUpNeeded"]) {
      expect(ur[key]).not.toMatch(/فالو اپ/);
    }
  });

  it("no longer calls the Action Center an English loan", () => {
    expect(ur["inline.action_center"]).not.toMatch(/ایکشن/);
    expect(ur["inline.action_center"]).not.toMatch(/کارروائی/);
  });
});
