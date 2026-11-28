import { supabase } from "@/lib/supabase";

/**
 * One branch's own record: the facts the branch list does not carry.
 *
 * The ERP split (owner, 2026-11-27): a branch is a place, so it has a short code staff can say, a
 * kind (a shop floor, a warehouse, a collection point, an office) and the hours it is open. Its
 * name, address, phone, manager and team were already its own; the company's registration, tax
 * numbers and financial year are never asked here.
 */
export interface BranchRecord {
  id: string;
  tenant_id: string;
  name: string;
  code: string | null;
  branch_type: "store" | "warehouse" | "outlet" | "office";
  opens_at: string | null;
  closes_at: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  is_default: boolean;
}

export const BRANCH_TYPES = ["store", "warehouse", "outlet", "office"] as const;

/** The four operational facts this screen writes, as a patch: absent leaves a fact alone. */
export type BranchDetailsPatch = Partial<{
  code: string;
  branch_type: string;
  opens_at: string;
  closes_at: string;
}>;

export async function loadBranchRecord(branchId: string): Promise<BranchRecord> {
  const { data, error } = await supabase.rpc("get_branch_record", { p_branch_id: branchId });
  if (error) throw new Error(error.message);
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (!parsed?.id) throw new Error("NOT_FOUND");
  return parsed as BranchRecord;
}

export async function setBranchDetails(branchId: string, patch: BranchDetailsPatch): Promise<BranchRecord> {
  const { data, error } = await supabase.rpc("set_branch_details", {
    p_branch_id: branchId,
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (!parsed?.id) throw new Error("NOT_FOUND");
  return parsed as BranchRecord;
}

/** `09:00:00` → `09:00`, the shape a time input reads and writes. */
export function timeValue(raw: string | null): string {
  if (!raw) return "";
  return raw.slice(0, 5);
}
