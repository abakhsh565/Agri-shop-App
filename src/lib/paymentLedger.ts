import { supabase } from "@/lib/supabase";

/**
 * The payments ledger, read once.
 *
 * Two tables hold money that moved after the bill: `customer_payments` (credit coming back) and
 * `supplier_payments` (money going out to a supplier). The Payments screen states both directions
 * and lists them on one timeline, so both are read here rather than each screen querying one table
 * and inventing the other.
 *
 * A READ THAT FAILED IS NOT A ZERO. Supplier payments are behind a narrower policy than customer
 * payments, so an account can legitimately see one table and not the other. `readable` says which
 * reads succeeded; the screen prints "—" for a direction it could not read instead of claiming
 * nothing was paid.
 *
 * Rows are read as the database already scopes them (RLS through the customer/company), newest
 * first. Nothing is filtered by branch here: a payment recorded against an old bill is history,
 * and hiding rows with a NULL pre-0233 branch stamp would understate the ledger.
 */

export interface LedgerPayment {
  id: string;
  direction: "in" | "out";
  /** The customer or supplier the money moved for. */
  counterparty: string;
  amount: number;
  method: string;
  note: string | null;
  createdAt: string;
  /** What the row can open, when the screen offers that. */
  customerId?: string;
  companyId?: string;
}

export interface PaymentLedger {
  entries: LedgerPayment[];
  received: number;
  paid: number;
  readable: { customers: boolean; suppliers: boolean };
}

interface CustomerPaymentRow {
  id: string;
  customer_id: string;
  amount: number | string;
  method: string;
  notes: string | null;
  created_at: string;
}

interface SupplierPaymentRow {
  id: string;
  company_id: string;
  amount: number | string;
  method: string;
  notes: string | null;
  created_at: string;
}

export async function loadPaymentLedger(): Promise<PaymentLedger> {
  const [customersResult, suppliersResult] = await Promise.all([
    supabase
      .from("customer_payments")
      .select("id, customer_id, amount, method, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("supplier_payments")
      .select("id, company_id, amount, method, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const customerRows = (customersResult.data as CustomerPaymentRow[] | null) ?? [];
  const supplierRows = (suppliersResult.data as SupplierPaymentRow[] | null) ?? [];

  // Names are read in one call per side, not joined per row: a missing name then reads as a
  // missing account rather than making the whole ledger fail.
  const customerIds = [...new Set(customerRows.map((r) => r.customer_id))];
  const companyIds = [...new Set(supplierRows.map((r) => r.company_id))];

  const [customerNames, companyNames] = await Promise.all([
    customerIds.length
      ? supabase.from("customers").select("id, name").in("id", customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    companyIds.length
      ? supabase.from("companies").select("id, name").in("id", companyIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const custNameById = new Map(
    ((customerNames.data as { id: string; name: string }[] | null) ?? []).map((c) => [c.id, c.name]),
  );
  const companyNameById = new Map(
    ((companyNames.data as { id: string; name: string }[] | null) ?? []).map((c) => [c.id, c.name]),
  );

  const entries: LedgerPayment[] = [
    ...customerRows.map((r) => ({
      id: r.id,
      direction: "in" as const,
      counterparty: custNameById.get(r.customer_id) ?? "",
      amount: Number(r.amount) || 0,
      method: r.method,
      note: r.notes,
      createdAt: r.created_at,
      customerId: r.customer_id,
    })),
    ...supplierRows.map((r) => ({
      id: r.id,
      direction: "out" as const,
      counterparty: companyNameById.get(r.company_id) ?? "",
      amount: Number(r.amount) || 0,
      method: r.method,
      note: r.notes,
      createdAt: r.created_at,
      companyId: r.company_id,
    })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return {
    entries,
    received: customerRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
    paid: supplierRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
    readable: {
      customers: !customersResult.error,
      suppliers: !suppliersResult.error,
    },
  };
}
