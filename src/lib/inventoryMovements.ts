import { supabase } from "@/lib/supabase";
import { useScopedRows } from "@/lib/scopedRead";

/**
 * The stock ledger, as the database keeps it.
 *
 * `inventory_movements` is the record of everything that moved a quantity: a sale, a goods
 * received against a purchase, a return, or someone counting the shelf. Stock movements used to
 * be reconstructed on the screen from the sales the app happened to hold — which could only ever
 * show half the story (no purchases, no adjustments) and only for the sales still in the loaded
 * window. The ledger says it once, keeps it, and is the same rows the quantities themselves were
 * derived from.
 *
 * A row's `qty_change` is in the product's base unit and is signed: positive is stock in,
 * negative is stock out. `reference_type`/`reference_id` name the document that caused it, which
 * is how a row can say "Purchase #P104" instead of just "stock changed".
 */

export type MovementType = "sale" | "purchase" | "adjustment" | "return" | (string & {});

export interface InventoryMovement {
  id: string;
  variantId: string;
  productId: string;
  type: MovementType;
  qtyBefore: number;
  qtyChange: number;
  qtyAfter: number;
  referenceType: string;
  referenceId: string;
  notes: string;
  createdAt: string;
}

interface MovementRow {
  id: string;
  variant_id: string | null;
  product_id: string | null;
  movement_type: string;
  qty_before: number | null;
  qty_change: number | null;
  qty_after: number | null;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
}

/** Newest first, capped at the most recent 200 movements — the same window the other ledgers use. */
export function useInventoryMovements(): { movements: InventoryMovement[]; ready: boolean } {
  const { rows, ready } = useScopedRows<InventoryMovement>(async () => {
    const { data, error } = await supabase
      .from("inventory_movements")
      .select(
        "id, variant_id, product_id, movement_type, qty_before, qty_change, qty_after, reference_type, reference_id, notes, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data as MovementRow[] ?? []).map((r) => ({
      id: r.id,
      variantId: r.variant_id ?? "",
      productId: r.product_id ?? "",
      type: r.movement_type,
      qtyBefore: Number(r.qty_before ?? 0),
      qtyChange: Number(r.qty_change ?? 0),
      qtyAfter: Number(r.qty_after ?? 0),
      referenceType: r.reference_type ?? "",
      referenceId: r.reference_id ?? "",
      notes: r.notes ?? "",
      createdAt: r.created_at,
    }));
  });
  return { movements: rows, ready };
}
