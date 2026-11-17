/**
 * ONE HUMAN-READABLE NAME FOR EVERY RECORD.
 *
 * A shopkeeper says "sale 42", not "the sale with id 8f14e45f-ea3b-4a4f-9a1e-3a5f0c9a1b77".
 * Until now every screen showed either nothing (a row named only by customer and time) or the raw
 * uuid, which nobody can read out loud over the counter. This gives each record a short name with
 * the kind in front — `SL#`, `EMP#`, `INV#` — so a sale, an employee and a product are told apart
 * by their prefix alone, in the app and in a conversation about it.
 *
 * WHERE THE NUMBER COMES FROM. It is derived from the record's own id, so it is the same on every
 * screen, after every reload, and for every user — a name that changed between two screens would
 * be worse than none. It is not a stored sequence: the database has no per-shop counter for these
 * tables, and inventing one in the client would renumber history whenever a row was deleted. The
 * six digits are the id folded into the million range, which is what makes the code stable and
 * short rather than ordered.
 *
 * THE UPGRADE PATH, when numbering has to be consecutive and quotable ("the next sale is
 * SL#0012"): a per-shop counter column filled by the insert RPC. That is a migration and a
 * backfill, not a client change — and this function is the only place that would have to change,
 * because every screen calls it instead of formatting a number of its own.
 */

/** The record kinds that carry a reference. One prefix each, never two spellings of one kind. */
export type ReferencePrefix = "SL" | "EMP" | "INV" | "CUS" | "SUP" | "PUR";

const DIGITS = 6;

/**
 * The reference for one record id.
 *
 * An id that is not a uuid (a draft's local id, an empty value) still resolves to a code instead
 * of `undefined` leaking onto a row: `PREFIX#000000` says "this row has no server identity yet",
 * which is exactly true for a draft.
 */
export function referenceCode(prefix: ReferencePrefix, id: string | null | undefined): string {
  const hex = (id ?? "").replace(/[^0-9a-f]/gi, "").slice(0, 10);
  const folded = hex ? parseInt(hex, 16) % 10 ** DIGITS : 0;
  return `${prefix}#${String(folded).padStart(DIGITS, "0")}`;
}
