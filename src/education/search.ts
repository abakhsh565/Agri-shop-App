import { FAQS, FEATURES, TUTORIALS, WORKFLOWS, featureById, featurePath, type EduRole } from "./model";

/**
 * Search over the education model.
 *
 * WHY IT LIVES BESIDE THE MODEL. The guide is the one screen a shopkeeper opens a month after
 * onboarding, and what they have is a question, not a section name: "who owes me", "udhaar",
 * "kharcha", "why is cash different from profit". A keyword filter over titles answers almost
 * none of those, so this module indexes every sentence the model already holds — feature
 * names, what/why pairs, workflow steps, video steps and FAQ answers — and ranks them.
 *
 * THE THREE THINGS IT DOES, AND WHY EACH IS NEEDED:
 *
 *  1. **Keywords are not the copy.** Every document carries an alias list (`ALIASES`) holding
 *     the shop's own words in both languages — udhaar/khata, kharcha, nafa, maal, mulazim — so
 *     a person searching in one language finds a screen labelled in the other. That is also
 *     why the aliases are never shown: they are a bridge, not content.
 *  2. **Role is part of the answer.** A capability the person cannot open is still explained —
 *     the guide's promise — but it is returned `locked`, so the screen renders it as a line
 *     with "owner only" instead of a control that leads nowhere. `featurePath` is the single
 *     decision here, exactly as it is in the guide list.
 *  3. **The current screen is context.** Someone reading Finance who searches "cash" wants the
 *     money book before a definition, so a document whose destination is the screen they are
 *     standing on is lifted above an equal match elsewhere. It is a tie-break booster, not a
 *     filter: nothing is hidden because of where you are.
 *
 * Matching is normalised and script-aware: Urdu diacritics and tatweel are stripped, Arabic
 * yeh/kaf/alef variants are folded to the Urdu letters the app writes, and punctuation is
 * dropped, so `ادھار؟` and `ادھار` are the same token. A token matches a whole word, a word
 * prefix, or (for 3+ letters) any part of a word; documents matching every token always
 * outrank documents matching only some, which keeps a two-word query from being answered by
 * the one word it happened to find first.
 */

export type GuideHitKind = "feature" | "video" | "answer" | "workflow" | "action";

export interface GuideDoc {
  id: string;
  kind: GuideHitKind;
  title: string;
  /** The line shown under the title. */
  detail?: string;
  /** Extra prose searched but not shown (a workflow's steps, a tutorial's narration). */
  body: string;
  /** The shop's own words for this thing, in both languages. Never rendered. */
  keywords: string;
  /** Shell-prefixed destination; null when this person may not open it. */
  path?: string | null;
  /** Explained, but not this person's to open. */
  locked?: boolean;
  tutorialId?: string;
  action?: "tour" | "ask";
}

export interface GuideHit extends GuideDoc {
  score: number;
  matched: number;
}

type Translate = (key: string, params?: Record<string, string>) => string;

/**
 * The shop's words for each thing, in English, Roman Urdu and Urdu script.
 *
 * The aliases matter most where the product vocabulary and the spoken vocabulary differ:
 * nobody asks for "receivables", and "drawing" is not how an owner describes taking money out.
 */
const ALIASES: Record<string, string[]> = {
  "feature:sales": ["bill", "invoice", "sell", "sale", "new sale", "bikri", "فروخت", "بل", "بیچنا", "سیل"],
  "feature:stock": [
    "inventory", "product", "products", "stock", "maal", "samaan", "barcode", "reorder", "expiry",
    "catalogue", "unit", "اسٹاک", "سامان", "مال", "پروڈکٹ", "بارکوڈ",
  ],
  "feature:customers": [
    "udhaar", "udhar", "khata", "credit", "customer", "baqaya", "receivable", "owes", "owing",
    "ادھار", "کھاتہ", "گاہک", "بقایا", "وصولی",
  ],
  "feature:purchases": [
    "purchase", "supplier", "suppliers", "company", "kharidari", "payable", "stock in",
    "خریداری", "سپلائر", "کمپنی", "واجبات", "سامان آنا",
  ],
  "feature:finance": [
    "finance", "money", "cash", "payment", "payments", "expense", "expenses", "kharcha",
    "drawing", "till", "income", "ادائیگی", "نقدی", "خرچ", "پیسے", "رقم", "مالیات", "آمدنی",
  ],
  "feature:reports": [
    "report", "reports", "profit", "nafa", "loss", "sales report", "رپورٹ", "منافع", "نقصان", "حساب",
  ],
  "feature:assistant": [
    "assistant", "ai", "bot", "ask", "question", "sawal", "help", "اسسٹنٹ", "سوال", "مدد", "پوچھیں",
  ],
  "feature:alerts": [
    "alert", "alerts", "reminder", "reminders", "overdue", "low stock", "expiry", "late",
    "الرٹ", "یاد دہانی", "تاخیر", "کم اسٹاک", "ختم",
  ],
  "feature:staff": [
    "staff", "employee", "employees", "worker", "team", "role", "roles", "permission",
    "access", "mulazim", "ملازم", "عملہ", "کردار", "اجازت", "ٹیم",
  ],
  "feature:branches": ["branch", "branches", "location", "shop", "برانچ", "شاخ", "دکان"],
  "action:tour": ["tour", "show me", "walkthrough", "guide", "گائیڈ", "دکھائیں", "گھمائیں"],
  "faq:cashVsProfit": ["cash vs profit", "difference", "نقدی اور نفع", "فرق"],
  "faq:expense": ["expense", "kharcha", "drawing", "خرچ", "نکاسی"],
  "faq:moneyAccess": ["who can see money", "permission", "پیسے کون", "اجازت"],
};

/** Fold a value to the words a search actually compares. */
export function normalizeGuideText(value: string): string {
  return value
    .toLowerCase()
    // Diacritics and the tatweel are optional in written Urdu; typing them must not miss.
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    // One letter, several code points: fold the Arabic variants to the Urdu spelling.
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    // Everything that is not a letter, a digit or an Urdu character separates words.
    .replace(/[^\w\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The documents the guide can answer from, for one person and one language. */
export function buildGuideIndex(
  t: Translate,
  role: EduRole | undefined,
  base: string,
  tourStops: number,
): GuideDoc[] {
  const docs: GuideDoc[] = [];

  for (const feature of FEATURES) {
    const path = featurePath(feature, role);
    docs.push({
      id: `feature:${feature.id}`,
      kind: "feature",
      title: t(feature.titleKey),
      detail: t(feature.whatKey),
      body: `${t(feature.titleKey)} ${t(feature.whatKey)} ${t(feature.whyKey)}`,
      keywords: (ALIASES[`feature:${feature.id}`] ?? []).join(" "),
      path: path ? `${base}${path}` : null,
      locked: path === null,
    });
  }

  for (const tutorial of TUTORIALS) {
    const workflow = WORKFLOWS.find((w) => w.id === tutorial.workflowId);
    const feature = workflow ? featureById(workflow.featureId) : undefined;
    docs.push({
      id: `video:${tutorial.id}`,
      kind: "video",
      title: t(tutorial.titleKey),
      detail: t("edu.tut.urduNote"),
      body: tutorial.stepKeys.map((key) => t(key)).join(" "),
      keywords: feature ? (ALIASES[`feature:${feature.id}`] ?? []).join(" ") : "",
      tutorialId: tutorial.id,
    });
  }

  for (const workflow of WORKFLOWS) {
    const feature = featureById(workflow.featureId);
    const path = feature ? featurePath(feature, role) : null;
    const tutorial = TUTORIALS.find((v) => v.workflowId === workflow.id);
    docs.push({
      id: `workflow:${workflow.id}`,
      kind: "workflow",
      title: t(workflow.titleKey),
      detail: workflow.stepKeys.map((key) => t(key)).join(" · "),
      body: `${t(workflow.titleKey)} ${workflow.stepKeys.map((key) => t(key)).join(" ")}`,
      keywords: feature ? (ALIASES[`feature:${feature.id}`] ?? []).join(" ") : "",
      path: path ? `${base}${path}` : null,
      locked: path === null,
      tutorialId: tutorial?.id,
    });
  }

  for (const faq of FAQS) {
    const feature = faq.featureId ? featureById(faq.featureId) : undefined;
    const path = feature ? featurePath(feature, role) : null;
    docs.push({
      id: `answer:${faq.id}`,
      kind: "answer",
      title: t(faq.qKey),
      detail: t(faq.aKey),
      body: `${t(faq.qKey)} ${t(faq.aKey)}`,
      keywords: [
        ...(ALIASES[`faq:${faq.id}`] ?? []),
        ...(feature ? ALIASES[`feature:${feature.id}`] ?? [] : []),
      ].join(" "),
      path: path ? `${base}${path}` : null,
    });
  }

  docs.push({
    id: "action:tour",
    kind: "action",
    title: t("edu.guide.startTour"),
    detail: t("edu.guide.tourHint", { count: String(tourStops) }),
    body: t("edu.guide.startTour"),
    keywords: (ALIASES["action:tour"] ?? []).join(" "),
    action: "tour",
  });

  // "Ask a question" is deliberately NOT an indexed document: the card for it sits at the
  // bottom of the guide in both modes, so indexing it produced the same row twice — once as a
  // result and once as the way out. A search that found nothing already points at that card.

  return docs;
}

interface WeightedField {
  text: string;
  weight: number;
}

/**
 * How well one token matches one document.
 *
 * A whole word beats a prefix, and a prefix beats a fragment inside a word; each is multiplied
 * by the field's weight so a title hit outranks a sentence that happens to contain the word.
 */
function tokenScore(token: string, fields: WeightedField[]): number {
  let best = 0;
  for (const field of fields) {
    if (!field.text) continue;
    for (const word of field.text.split(" ")) {
      let hit = 0;
      if (word === token) hit = 3;
      else if (token.length >= 2 && word.startsWith(token)) hit = 2;
      else if (token.length >= 3 && word.includes(token)) hit = 1.2;
      if (hit) best = Math.max(best, hit * field.weight);
    }
  }
  return best;
}

/**
 * Ranked answers for a query, best first.
 *
 * `currentPath` is the screen the reader is on: a match that opens that same screen is lifted,
 * because a question asked from Finance is usually about Finance.
 */
export function searchGuide(docs: GuideDoc[], query: string, currentPath = ""): GuideHit[] {
  const phrase = normalizeGuideText(query);
  if (!phrase) return [];
  const tokens = phrase.split(" ").filter(Boolean);
  const here = currentPath.replace(/\/+$/, "");
  const hits: GuideHit[] = [];

  for (const doc of docs) {
    const title = normalizeGuideText(doc.title);
    const detail = normalizeGuideText(doc.detail ?? "");
    const keywords = normalizeGuideText(doc.keywords);
    const body = normalizeGuideText(doc.body);
    const fields: WeightedField[] = [
      { text: title, weight: 9 },
      { text: keywords, weight: 7 },
      { text: detail, weight: 4 },
      { text: body, weight: 3 },
    ];

    let score = 0;
    let matched = 0;
    for (const token of tokens) {
      const value = tokenScore(token, fields);
      if (value > 0) {
        matched += 1;
        score += value;
      }
    }
    if (matched === 0) continue;

    // A document that answers every word is a better answer than one that answers one word,
    // whatever the weights say about that one word.
    if (matched === tokens.length) score += 8;
    if (title.includes(phrase)) score += 12;
    else if (detail.includes(phrase) || keywords.includes(phrase)) score += 6;
    else if (body.includes(phrase)) score += 4;
    if (doc.path && here && (here === doc.path || here.startsWith(`${doc.path}/`))) score += 6;

    hits.push({ ...doc, score, matched });
  }

  hits.sort((a, b) => {
    const aFull = a.matched === tokens.length;
    const bFull = b.matched === tokens.length;
    if (aFull !== bFull) return aFull ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.title.length - b.title.length;
  });

  return hits;
}
