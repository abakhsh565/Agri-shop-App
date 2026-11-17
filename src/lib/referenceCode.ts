/**
 * ONE HUMAN-READABLE NAME FOR EVERY RECORD.
 *
 * A shopkeeper says "sale 42", not "the sale with id 8f14e45f-ea3b-4a4f-9a1e-3a5f0c9a1b77".
 * This gives each record a short name in the convention the trade already reads:
 *
 *   invoice INV-001 · sale SAL-001 · sales order SO-001 · purchase PUR-001
 *   purchase order PO-001 · quotation QUO-001 · payment PAY-001
 *
 * …plus the two records a shop also names out loud: a product (`INV-`-style shelf code is a
 * different thing from an invoice, so products use `PRD-`) and an employee (`EMP-`).
 *
 * WHERE THE NUMBER COMES FROM. It is derived from the record's own id, so it is the same on every
 * screen, after every reload, and for every user — a name that changed between two screens would
 * be worse than none.
 *
 * WHAT THAT COSTS, said plainly. A derived number is not a counter: the three digits are the id
 * folded into 1…999, so two records can land on the same number once a shop has a few hundred rows
 * of one kind (a 100-row list has roughly a 1-in-200 chance of one visible repeat). The shop's own
 * sale numbers are NOT affected — a sale prints the `sale_number` the database stored, and this
 * function only fills in for a row that has none.
 *
 * THE UPGRADE PATH, when these must be consecutive, quotable and never repeat ("the next sale is
 * SAL-0012"): a per-shop counter table filled by the insert RPC, with these columns backfilled in
 * creation order. That is a migration and a backfill, not a client change — and every screen calls
 * `referenceCode`, so the change lands in one file.
 *
 * (Products are `PRD-`, not `INV-`: `INV-` is an invoice in this convention, and a shelf code that
 * reads as an invoice would make two different things answer to one name.)
 */

/** The kinds that carry a reference, each with the prefix the convention gives it. */
export const REFERENCE_PREFIX = {
  invoice: "INV",
  sale: "SAL",
  salesOrder: "SO",
  purchase: "PUR",
  purchaseOrder: "PO",
  quotation: "QUO",
  payment: "PAY",
  product: "PRD",
  employee: "EMP",
  customer: "CUS",
  supplier: "SUP",
} as const;

export type ReferenceKind = keyof typeof REFERENCE_PREFIX;

/** Three digits, as the convention writes them: `SAL-007`. */
const DIGITS = 3;
const RANGE = 10 ** DIGITS;

/**
 * The reference for one record id, in one kind.
 *
 * An id that is not a uuid (a draft's local id, an empty value) still resolves to a code instead
 * of `undefined` leaking onto a row: `SAL-001` says "this row has no server identity yet", which is
 * exactly true for a draft.
 */
export function referenceCode(kind: ReferenceKind, id: string | null | undefined): string {
  const hex = (id ?? "").replace(/[^0-9a-f]/gi, "").slice(0, 10);
  // 1…999, so a reference never reads `SAL-000` — zero is the "no identity" slot.
  const folded = (hex ? parseInt(hex, 16) % (RANGE - 1) : 0) + 1;
  return `${REFERENCE_PREFIX[kind]}-${String(folded).padStart(DIGITS, "0")}`;
}
