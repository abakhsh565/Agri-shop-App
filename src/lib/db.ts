import { supabase } from "@/lib/supabase";
import { beginScopedWrite } from "@/lib/localCache";
import { tNow } from "@/lib/i18n";
import { useAuthStore } from "@/stores/authStore";
import type {
  Purchase,
  PurchaseItem,
  CustomerPayment,
  StockAdjustment,
  Return,
  PaymentMethod,
  PaymentType,
  AdjustmentType,
  ProductCategory,
  PhysicalFormCode,
  ClassificationPreset,
  ClassificationForm,
  HandlingType,
} from "@/types";

// Centralised data access for the flows that either (a) mutate several tables
// atomically or (b) are read-only history lists. The atomic writes go through
// SECURITY DEFINER RPCs (see migration 0004) so stock can't go negative, price
// is read from the DB, and money/stock updates are transactional.

// Switching working context while a financial request is in flight would
// leave its server result under a different branch header. Keep one counter
// at the existing atomic data-access boundary, not in each screen.
async function scopedRpc(name: string, args: Record<string, unknown>) {
  const finish = beginScopedWrite();
  try { return await supabase.rpc(name, args); }
  finally { finish(); }
}

// ─── Atomic write RPCs ───────────────────────────────────────────────────────

export interface SaleLineInput {
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  qty: number;
  unitPrice: number;
  unitSize: number;
  baseUnit: string;
}

export async function rpcCreateSale(payload: {
  /** Claimed by the database so one confirm cannot create two sales (0134). */
  idempotencyKey?: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  employeeId?: string;
  employeeName?: string;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  note?: string;
  items: SaleLineInput[];
}): Promise<{ id: string; saleNumber: string; totalAmount: number; amountPaid: number; outstandingBalance: number }> {
  const userId = useAuthStore.getState().user?.id ?? null;
  const { data, error } = await scopedRpc("create_sale", { payload: { ...payload, userId } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcCreatePurchase(payload: {
  companyId?: string | null;
  companyName: string;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  note?: string;
  /** Claimed by the database so one confirm cannot receive the same delivery twice (0140). */
  idempotencyKey?: string;
  items: { productId?: string; productName: string; variantId?: string; variantName: string; qty: number; costPrice: number; sellingPrice?: number }[];
}): Promise<{ id: string; purchaseNumber: string; totalAmount: number; outstandingPayable: number; idempotent?: boolean }> {
  const userId = useAuthStore.getState().user?.id ?? null;
  const { data, error } = await scopedRpc("create_purchase", { payload: { ...payload, userId } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcRecordCustomerPayment(payload: {
  customerId: string;
  amount?: number;
  method?: PaymentMethod;
  notes?: string;
  splits?: { amount: number; method: PaymentMethod }[];
  idempotencyKey?: string;
}): Promise<{ id: string; balanceAfter: number; splitCount?: number; totalAmount?: number }> {
  const actorId = useAuthStore.getState().user?.id;
  const idempotency_key = payload.idempotencyKey ?? crypto.randomUUID();
  const { data, error } = await scopedRpc("record_customer_payment", { payload: { ...payload, actorId, idempotency_key } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcRecordSupplierPayment(payload: {
  companyId: string;
  amount: number;
  method: PaymentMethod;
  notes?: string;
  /** Claimed by the database so one confirm cannot record two payments (0138). */
  idempotencyKey?: string;
}): Promise<{ id: string; payableAfter: number; idempotent?: boolean }> {
  const actorId = useAuthStore.getState().user?.id;
  const { data, error } = await scopedRpc("record_supplier_payment", {
    payload: { ...payload, actorId, idempotencyKey: payload.idempotencyKey },
  });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcAdjustStock(payload: {
  variantId: string;
  productId?: string;
  productName: string;
  adjustmentType: AdjustmentType;
  qty: number;
  reason?: string;
  /** Claimed by the database so one confirm cannot adjust stock twice (0139). */
  idempotencyKey?: string;
}): Promise<{ id: string; qtyBefore: number; qtyChange: number; qtyAfter: number; idempotent?: boolean }> {
  const actorId = useAuthStore.getState().user?.id;
  const { data, error } = await scopedRpc("adjust_stock", { payload: { ...payload, actorId } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcCreateProduct(payload: {
  name: string;
  company: string;
  category: ProductCategory;
  /** The shop's own shelf (0259). The server writes the kind from its root, not from here. */
  categoryId?: string;
  /** The shop's own unit (0259). The server writes `base_unit` from its family. */
  unitId?: string;
  /**
   * The unit the shop sells this product in. Required, and stored: before 0158 the server
   * silently dropped it, so every product added through the app read back as `piece`.
   */
  baseUnit: string;
  /** The physical form selected from the category profile, when the category has one. */
  physicalForm?: PhysicalFormCode | null;
  imageUrl?: string;
  /**
   * Optional. When it is absent the database mints one (`AGS-…`) and records it as this
   * product's primary code, so a product can never exist without one.
   */
  barcode?: string;
  /**
   * Opening stock belongs to the VARIANT, which is the stock of record (0128). Each pack's
   * `stockQty` is written as an opening movement carrying its cost, so the shelf has a
   * beginning rather than a number with no history (0158).
   */
  variants: { name: string; sellingPrice: number; costPrice: number; unitSize: number; qtyStep: number; lowStockThreshold: number; stockQty?: number; /** yyyy-mm-dd, or null for a pack with no date. */ expiryDate?: string | null }[];
  /**
   * "List on Farmer Marketplace" (0185). Absent means not listed, which is also the database
   * default — a product is never publicly visible because a client forgot to send the flag.
   */
  marketplaceListed?: boolean;
}): Promise<{ id: string; name: string; barcode: string; marketplace_listed?: boolean }> {
  const actorId = useAuthStore.getState().user?.id;
  const { data, error } = await supabase.rpc("create_product_with_classification", { payload: { ...payload, actorId, userId: actorId } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcUpdateProduct(payload: {
  id: string;
  name: string;
  company: string;
  category: ProductCategory;
  /**
   * The shelf this product is on. Sent even when empty: an empty id takes the product off the
   * shelf, while leaving the key out would leave the stored shelf alone. `null` is that empty.
   */
  categoryId?: string | null;
  /** The unit it is sold in; the same present/absent rule as the shelf above. */
  unitId?: string | null;
  baseUnit?: string;
  /** The chosen form; absent preserves an existing product's form. */
  physicalForm?: PhysicalFormCode | null;
  imageUrl?: string;
  barcode?: string;
  /**
   * An existing pack's `stockQty` is deliberately ignored — the catalogue does not own stock
   * (0145) and the database refuses the write. A pack that is NEW in this call may carry
   * one, because creating a pack is not the same act as adjusting one.
   */
  variants: { id?: string; name: string; sellingPrice: number; costPrice: number; unitSize?: number; qtyStep?: number; lowStockThreshold: number; stockQty?: number; expiryDate?: string | null }[];
  /**
   * The listing switch (0185). The database distinguishes "not mentioned" from `false`, exactly
   * as it does for `barcode` and `expiryDate`: absent leaves the flag alone; `false` is the
   * marketplace listing state the owner chose. Sent on every save from this screen, so an
   * unlisting is recorded as a decision rather than inferred from silence.
   */
  marketplaceListed?: boolean;
}): Promise<{ id: string }> {
  const actorId = useAuthStore.getState().user?.id;
  const { data, error } = await supabase.rpc("update_product_with_classification", { payload: { ...payload, actorId } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

/**
 * The catalogue's own errors, said in a sentence.
 *
 * `save_product_category` and `save_product_unit` raise `CODE: sentence` — the code is for a
 * developer, the sentence is for the person who typed the name. Permission failures keep the
 * one translation the rest of the app uses, because "you are not allowed" is not something the
 * server should phrase per table.
 */
function catalogueError(message: string): Error {
  if (/NOT_AUTHORIZED|NOT_AUTHENTICATED|permission denied/i.test(message)) {
    return new Error(friendly(message));
  }
  if (/CLASSIFICATION_PROFILE_INVALID/.test(message ?? "")) {
    return new Error(tNow("classification.saveError"));
  }
  return new Error((message ?? "").replace(/^[A-Z_]+:\s*/, ""));
}

export interface SavedCategory {
  id: string;
  name: string;
  parentId: string | null;
  legacyCategory: ProductCategory | null;
  isSystem: boolean;
}

/** The configuration the category form sends with its normal save. */
export interface CategoryClassificationInput {
  preset: ClassificationPreset;
  physicalForms: ClassificationForm[];
  handlingTypes: HandlingType[];
}

/**
 * Create or rename one of the shop's shelves.
 *
 * `parentId` is the shelf this one lives under, or null for a top-level shelf. The database
 * refuses a third level, a duplicate name and a parent from another shop; those refusals are
 * the point, so none of them is checked here first and hoped for there.
 */
export async function rpcSaveProductCategory(payload: {
  id?: string;
  name: string;
  parentId?: string | null;
  /** Absent leaves an existing profile alone; null removes an override. */
  classification?: CategoryClassificationInput | null;
}): Promise<SavedCategory> {
  const { data, error } = await supabase.rpc("save_product_category_with_classification", { payload });
  if (error) throw catalogueError(error.message);
  return data as SavedCategory;
}

export interface SavedUnit {
  id: string;
  name: string;
  symbol: string;
  baseUnit: "kg" | "liter" | "piece";
  precision: number;
  isSystem: boolean;
}

/**
 * Create or edit one of the shop's units.
 *
 * The measurement family travels with it, because pack sizes and stock are arithmetic in that
 * family; the database refuses a fourth one and a duplicate symbol.
 */
export async function rpcSaveProductUnit(payload: {
  id?: string;
  name: string;
  symbol: string;
  baseUnit: string;
  precision: number;
}): Promise<SavedUnit> {
  const { data, error } = await supabase.rpc("save_product_unit", { payload });
  if (error) throw catalogueError(error.message);
  return data as SavedUnit;
}

/** The answer from a catalogue delete: a dependency count, or the row that was removed. */
export interface CatalogueDeleteResult {
  deleted: boolean;
  reason?: "has_products" | "has_children";
  productCount?: number;
  childCount?: number;
  id?: string;
  name?: string;
}

/** Delete a shelf only when no active product or subcategory still uses it. */
export async function rpcDeleteProductCategory(id: string): Promise<CatalogueDeleteResult> {
  const { data, error } = await supabase.rpc("delete_product_category", { p_category_id: id });
  if (error) throw catalogueError(error.message);
  return data as CatalogueDeleteResult;
}

/** Delete a unit only when no active product still uses it. */
export async function rpcDeleteProductUnit(id: string): Promise<CatalogueDeleteResult> {
  const { data, error } = await supabase.rpc("delete_product_unit", { p_unit_id: id });
  if (error) throw catalogueError(error.message);
  return data as CatalogueDeleteResult;
}

/**
 * What a scanned code belongs to, decided by the database rather than by this device.
 *
 * `findByBarcode` in the products store answers the same question from an in-memory list,
 * which is only right while that list is complete and fresh. This is the answer for a code
 * nobody has loaded yet — a product added on another phone, or one whose code was printed
 * from a different label. Returns null when the code is not this shop's.
 */
export async function rpcResolveProductBarcode(
  code: string
): Promise<{ productId: string; variantId: string | null; code: string } | null> {
  const { data, error } = await supabase.rpc("resolve_product_barcode", { p_code: code });
  if (error) throw new Error(friendly(error.message));
  return (data as any) ?? null;
}

/**
 * A code for this shop that is free — and that stays free, because the database checks the
 * barcode registry rather than only the codes currently in use.
 *
 * The client used to build one itself (`generateProductBarcode`, name + 4 letters + a
 * sequence) with no way to know what this shop already had, so "Make one" could hand the
 * owner a code the save then refused as taken. Generating is the shop's bookkeeping, so the
 * shop decides it.
 */
export async function rpcPreviewProductBarcode(name: string): Promise<string> {
  const { data, error } = await supabase.rpc("preview_product_barcode", { p_name: name });
  if (error) throw new Error(friendly(error.message));
  return data as string;
}

/**
 * Put a code on a product — typed, scanned or generated. Replacing one retires the code it
 * replaced, so the old code can never be put on anything again.
 */
export async function rpcSetProductBarcode(
  productId: string,
  code: string,
  source: "supplied" | "generated" | "scanned" = "supplied",
  reason?: string,
): Promise<{ productId: string; code: string }> {
  const { data, error } = await supabase.rpc("set_product_barcode", {
    p_product_id: productId, p_code: code, p_source: source, p_reason: reason ?? null,
  });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

/**
 * Take the barcode off a product. The code is retired rather than forgotten, and no past sale
 * is touched — a sale references the product and the variant, never the code.
 */
export async function rpcDeleteProductBarcode(
  productId: string,
  reason?: string,
): Promise<{ productId: string; deleted: number }> {
  const { data, error } = await supabase.rpc("delete_product_barcode", {
    p_product_id: productId, p_reason: reason ?? null,
  });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export interface BarcodeHistoryEntry {
  code: string;
  previousCode: string | null;
  action: "added" | "replaced" | "deleted";
  source: string | null;
  changedAt: string;
  reason: string | null;
  retired: boolean;
}

/** A product's codes: the one it has now, and every one it used to have. */
export async function rpcProductBarcodes(
  productId: string,
): Promise<{ current: { code: string; isPrimary: boolean; source: string }[]; history: BarcodeHistoryEntry[] }> {
  const { data, error } = await supabase.rpc("product_barcodes_for", { p_product_id: productId });
  if (error) throw new Error(friendly(error.message));
  const d = (data as any) ?? {};
  return { current: d.current ?? [], history: d.history ?? [] };
}

export async function rpcDeleteProduct(payload: {
  id: string;
}): Promise<{ id: string; deactivated: boolean }> {
  const actorId = useAuthStore.getState().user?.id;
  const { data, error } = await supabase.rpc("delete_product", { payload: { ...payload, actorId } });
  if (error) throw new Error(friendly(error.message));
  return data as any;
}

export async function rpcProcessReturn(payload: {
  saleId?: string;
  customerId?: string | null;
  customerName: string;
  resolution: string;
  reason?: string;
  note?: string;
  idempotencyKey?: string;
  processedBy?: string;
  processedByName?: string;
  items: { saleItemId?: string; productId?: string; productName: string; variantId?: string; variantName: string; qty: number; unitPrice: number; restock: boolean }[];
}): Promise<{ id: string; returnNumber: string; totalRefund: number }> {
  // Build payload — only include optional fields that have values
  const rpcPayload: Record<string, unknown> = {
    saleId: payload.saleId,
    customerId: payload.customerId,
    customerName: payload.customerName,
    resolution: payload.resolution,
    items: payload.items,
  };
  if (payload.reason) rpcPayload.reason = payload.reason;
  if (payload.idempotencyKey) rpcPayload.idempotency_key = payload.idempotencyKey;
  if (payload.note) rpcPayload.note = payload.note;
  if (payload.processedBy) rpcPayload.processedBy = payload.processedBy;
  if (payload.processedByName) rpcPayload.processedByName = payload.processedByName;

  const { data, error } = await scopedRpc("process_return", { payload: rpcPayload });
  if (error) throw new Error(friendly(error.message));
  // Map snake_case RPC response to camelCase for UI consumption
  return {
    id: data.id,
    returnNumber: data.return_number,
    totalRefund: Number(data.total_refund ?? 0),
  };
}

// Turn raw Postgres exception text into a human message for the UI.
function friendly(msg: string): string {
  const m = msg ?? "";
  if (/INSUFFICIENT_STOCK/.test(m)) return tNow("errors.noStock");
  if (/NEGATIVE_STOCK|below zero/i.test(m)) return tNow("errors.belowZero");
  // A dead session is NOT a permission problem, and saying so sends an owner to demand
  // rights they already have: PostgREST answers an expired or unverifiable JWT with
  // PGRST301, which used to land on "You are not allowed to do this. Please ask the shop
  // owner." — the one message that cannot be acted on. The honest sentence is "sign in
  // again", and it has to be tested for first, because "permission denied" also matches
  // the not-allowed rule below.
  if (/PGRST301|JWT|token is expired|invalid claim|NOT_AUTHENTICATED|refresh token/i.test(m))
    return tNow("errors.loginAgain");
  // A missing permission, as the database phrases it when it refuses an action.
  if (/NOT_AUTHORIZED|missing permission|permission denied/i.test(m)) return tNow("errors.notAllowed");
  if (/VARIANT_NOT_FOUND|PRODUCT_NOT_FOUND|SALE_ITEM_NOT_FOUND|does not exist|no longer exists/i.test(m))
    return tNow("errors.gone");
  if (/REASON_REQUIRED/.test(m)) return tNow("errors.needReason");
  if (/RETURN_WINDOW_EXPIRED/.test(m)) return tNow("errors.returnTooLate");
  if (/EXCESS_RETURN/.test(m)) return tNow("errors.returnTooMuch");
  if (/ITEM_NOT_OWNED/.test(m)) return tNow("errors.itemNotInSale");
  if (/SALE_NOT_FOUND/.test(m)) return tNow("errors.saleGone");
  if (/INVALID_QTY/.test(m)) return tNow("errors.minOne");
  if (/CUSTOMER_NOT_FOUND/.test(m)) return tNow("errors.gone");
  if (/INVALID_SPLIT/.test(m)) return tNow("errors.badSplit");
  if (/DUPLICATE_PHONE|duplicate key.*users_phone/i.test(m)) return tNow("errors.duplicatePhone");
  // 0134: the same sale submitted twice. Not a failure the owner should have to
  // interpret — the sale exists, and the list shows it.
  if (/DUPLICATE_SUBMISSION/.test(m)) return tNow("errors.alreadySaved");
  if (/ACCOUNT_INACTIVE/.test(m)) return tNow("errors.accountOff");
  // 0158: the code the shop is minting or typing is already in use in this shop, which is
  // the one thing a barcode must never be, because a scan has to have exactly one answer.
  if (/BARCODE_TAKEN/.test(m)) return tNow("errors.barcodeTaken");
  // 0160: this code has been used before and retired. The one refusal an owner cannot fix by
  // removing something else — the only way forward is a different code.
  if (/BARCODE_RETIRED/.test(m)) return tNow("errors.barcodeRetired");
  if (/BARCODE_NONE/.test(m)) return tNow("errors.barcodeNone");
  if (/INVALID_UNIT/.test(m)) return tNow("errors.badUnit");
  if (/CLASSIFICATION_FORM_REQUIRED|CLASSIFICATION_FORM_INVALID/.test(m))
    return tNow("classification.formRequiredError");
  if (/CLASSIFICATION_UNIT/.test(m)) return tNow("classification.unitMismatchError");
  if (/CLASSIFICATION_PROFILE_INVALID/.test(m)) return tNow("classification.saveError");
  if (/NOT_AUTHENTICATED|JWT|invalid claim/i.test(m)) return tNow("errors.loginAgain");
  if (/^VALIDATION|VALIDATION:/i.test(m) || /check constraint|invalid input syntax/i.test(m))
    return tNow("errors.checkEntry");
  // Missing/blank column, or a NOT NULL the payload did not fill.
  if (/null value|not-null|NOT NULL/i.test(m)) return tNow("errors.missingField");
  // Offline, DNS, timeout, aborted request.
  if (/failed to fetch|networkerror|network request failed|timeout|timed out|offline|ERR_NETWORK/i.test(m))
    return tNow("errors.noInternet");
  // Anything else from the database is a developer's sentence, not an owner's:
  // "insert or update on table \"sales\" violates foreign key constraint …" used to
  // be shown exactly as written. Say something a shop owner can act on instead.
  return tNow("errors.didNotWork");
}

/**
 * The same mapping, reachable from the microcopy guard test. Raw database
 * failures are the most common way technical wording reaches a shop owner's
 * screen, so the mapping itself is what the test pins down.
 */
export { friendly as friendlyForTest };

// ─── Read-only history fetchers ────────────────────────────────────────────

interface PurchaseRow {
  id: string;
  purchase_number: string;
  company_id: string | null;
  company_name: string;
  branch_id: string | null;
  total_amount: number;
  amount_paid: number;
  // The unpaid balance column is `amount_due`. It was read as `outstanding_payable`,
  // a name that exists on `companies`, not on `purchases` — so every row mapped to
  // NaN and the screen called an unpaid delivery "PAID" with Rs. 0 owing.
  amount_due: number;
  // The method the advance was handed over in. Added to the table by 0258 — before that the
  // form sent it and the database dropped it, so every bill could only print "cash".
  payment_method: PaymentMethod | null;
  // The bill's note and the person who booked it. These were read as `note`/`created_by`, names
  // that live on nothing: `purchases` carries `notes` and `recorded_by`, so both read as blank.
  notes: string | null;
  recorded_by: string | null;
  created_at: string;
  purchase_items?: {
    id: string; purchase_id: string; product_id: string | null; product_name: string;
    // `unit_price` is the purchase line column; `cost_price` lives on product_variants.
    variant_id: string | null; variant_name: string; qty: number; unit_price: number; line_total: number;
  }[];
}

export async function fetchPurchases(): Promise<Purchase[]> {
  const { data, error } = await supabase
    .from("purchases")
    .select("*, purchase_items(*)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as PurchaseRow[]).map((r) => ({
    id: r.id,
    purchaseNumber: r.purchase_number,
    companyId: r.company_id ?? "",
    companyName: r.company_name,
    branchId: r.branch_id ?? undefined,
    items: (r.purchase_items ?? []).map<PurchaseItem>((it) => ({
      id: it.id,
      purchaseId: it.purchase_id,
      productId: it.product_id ?? "",
      productName: it.product_name,
      variantId: it.variant_id ?? "",
      variantName: it.variant_name,
      qty: it.qty,
      costPrice: Number(it.unit_price),
      lineTotal: Number(it.line_total),
    })),
    totalAmount: Number(r.total_amount),
    amountPaid: Number(r.amount_paid),
    outstandingPayable: Number(r.amount_due),
    paymentMethod: r.payment_method ?? "cash",
    note: r.notes ?? undefined,
    createdAt: r.created_at,
    createdBy: r.recorded_by ?? "",
  }));
}

/** One unpaid delivery, as the payables list expands it. */
export interface SupplierUnpaidBill {
  id: string;
  purchaseNumber: string;
  outstandingPayable: number;
  createdAt: string;
}

interface SupplierUnpaidBillRow {
  id: string;
  purchase_number: string;
  amount_due: number | string;
  created_at: string;
}

/**
 * The unpaid bills behind one supplier's balance.
 *
 * Read on demand when the supplier is expanded, so opening the payables screen does not load
 * every purchase line for every supplier. `amount_due` is what was left on the delivery when it
 * was recorded; a later payment reduces the supplier balance rather than rewriting one bill.
 */
export async function fetchSupplierUnpaidBills(companyId: string): Promise<SupplierUnpaidBill[]> {
  const { data, error } = await supabase
    .from("purchases")
    .select("id, purchase_number, amount_due, created_at")
    .eq("company_id", companyId)
    .gt("amount_due", 0)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as SupplierUnpaidBillRow[]).map((r) => ({
    id: r.id,
    purchaseNumber: r.purchase_number,
    outstandingPayable: Number(r.amount_due),
    createdAt: r.created_at,
  }));
}

/** A payment recorded against a supplier, as the supplier's own page reads it. */
export interface SupplierPaymentEntry {
  id: string;
  companyId: string;
  amount: number;
  method: PaymentMethod;
  notes: string | null;
  recordedByName: string | null;
  createdAt: string;
  /**
   * The bill this payment settled at order time (0258), or null for a payment recorded later
   * against the running balance. A supplier's history holds both kinds — the advance used to be
   * missing from it entirely, which is what made “paid” disagree with the payable.
   */
  purchaseId: string | null;
}

interface SupplierPaymentDbRow {
  id: string;
  company_id: string;
  amount: number;
  method: PaymentMethod;
  notes: string | null;
  recorded_by_name: string | null;
  created_at: string;
  purchase_id: string | null;
}

/**
 * The payments made to suppliers, newest first — all of them, or one supplier's.
 *
 * The supplier's page shows what has actually been paid against their bills, so it reads the
 * payment records themselves rather than inferring them from a running total. The hub asks the
 * same question for the whole month, which is why the supplier is optional: a second query with
 * a different shape would be a second definition of "what we paid". Row-level security still
 * decides which branch's payments an account may see.
 */
export async function fetchSupplierPayments(companyId?: string): Promise<SupplierPaymentEntry[]> {
  let query = supabase
    .from("supplier_payments")
    .select("*")
    .order("created_at", { ascending: false });
  if (companyId) query = query.eq("company_id", companyId);
  const { data, error } = await query.limit(200);
  if (error) throw new Error(error.message);
  return (data as SupplierPaymentDbRow[]).map((r) => ({
    id: r.id,
    companyId: r.company_id,
    amount: Number(r.amount),
    method: r.method,
    notes: r.notes,
    recordedByName: r.recorded_by_name,
    createdAt: r.created_at,
    purchaseId: r.purchase_id ?? null,
  }));
}

/** One supplier payment, for the detail screen opened from a history row. */
export async function fetchSupplierPayment(id: string): Promise<SupplierPaymentEntry | null> {
  const { data, error } = await supabase
    .from("supplier_payments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as SupplierPaymentDbRow;
  return {
    id: r.id,
    companyId: r.company_id,
    amount: Number(r.amount),
    method: r.method,
    notes: r.notes,
    recordedByName: r.recorded_by_name,
    createdAt: r.created_at,
    purchaseId: r.purchase_id ?? null,
  };
}

interface CustomerPaymentRow {
  id: string; customer_id: string; amount: number; method: PaymentMethod;
  notes: string | null; recorded_by: string | null; recorded_by_name: string | null;
  balance_after: number; created_at: string;
  payment_group_id: string | null; split_index: number | null;
}

export async function fetchCustomerPayments(customerId?: string): Promise<CustomerPayment[]> {
  let q = supabase.from("customer_payments").select("*").order("created_at", { ascending: false });
  if (customerId) q = q.eq("customer_id", customerId);
  const { data, error } = await q.limit(200);
  if (error) throw new Error(error.message);

  const rows = data as CustomerPaymentRow[];

  // Group split payments by payment_group_id
  const groups = new Map<string, CustomerPaymentRow[]>();
  const singles: CustomerPayment[] = [];

  for (const r of rows) {
    const groupId = r.payment_group_id || r.id;
    const isSplit = groupId !== r.id || (rows.filter((x) => x.payment_group_id === groupId).length > 1);

    if (isSplit) {
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId)!.push(r);
    } else {
      singles.push({
        id: r.id,
        customerId: r.customer_id,
        amount: Number(r.amount),
        method: r.method,
        notes: r.notes ?? undefined,
        recordedBy: r.recorded_by ?? "",
        recordedByName: r.recorded_by_name ?? "",
        balanceAfter: Number(r.balance_after),
        createdAt: r.created_at,
      });
    }
  }

  // Convert split groups to grouped payment entries
  for (const [groupId, groupRows] of groups) {
    const sorted = groupRows.sort((a, b) => (a.split_index ?? 0) - (b.split_index ?? 0));
    const total = sorted.reduce((sum, r) => sum + Number(r.amount), 0);
    singles.push({
      id: groupId,
      customerId: sorted[0].customer_id,
      amount: total,
      method: sorted.length === 1 ? sorted[0].method : ("split" as PaymentMethod),
      notes: sorted[0].notes ?? undefined,
      recordedBy: sorted[0].recorded_by ?? "",
      recordedByName: sorted[0].recorded_by_name ?? "",
      balanceAfter: Number(sorted[0].balance_after),
      createdAt: sorted[0].created_at,
    });
  }

  // Sort by date descending
  return singles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

interface StockAdjustmentRow {
  id: string; product_id: string | null; product_name: string; variant_id: string | null;
  variant_name: string; adjustment_type: AdjustmentType; qty_before: number; qty_change: number;
  qty_after: number; reason: string | null; adjusted_by: string | null; adjusted_by_name: string | null;
  created_at: string;
}

export async function fetchStockAdjustments(): Promise<StockAdjustment[]> {
  const { data, error } = await supabase
    .from("stock_adjustments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as StockAdjustmentRow[]).map((r) => ({
    id: r.id,
    productId: r.product_id ?? "",
    productName: r.product_name,
    variantId: r.variant_id ?? "",
    variantName: r.variant_name,
    adjustmentType: r.adjustment_type,
    qtyBefore: r.qty_before,
    qtyChange: r.qty_change,
    qtyAfter: r.qty_after,
    reason: r.reason ?? undefined,
    adjustedBy: r.adjusted_by_name ?? r.adjusted_by ?? "",
    createdAt: r.created_at,
  }));
}

interface ReturnRow {
  id: string; return_number: string; sale_id: string | null; customer_id: string | null;
  customer_name: string; total_refund: number; resolution: string; reason: string | null;
  note: string | null; processed_by: string | null; processed_by_name: string | null; created_at: string;
}

export async function fetchReturns(): Promise<Return[]> {
  const { data, error } = await supabase
    .from("returns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as ReturnRow[]).map((r) => ({
    id: r.id,
    saleId: r.sale_id ?? "",
    saleNumber: "",
    customerId: r.customer_id ?? "",
    customerName: r.customer_name,
    items: [],
    totalRefund: Number(r.total_refund),
    resolution: (r.resolution as Return["resolution"]) ?? "refund_cash",
    reason: r.reason ?? undefined,
    processedBy: r.processed_by_name ?? r.processed_by ?? "",
    note: r.note ?? undefined,
    createdAt: r.created_at,
  }));
}

// ─── Customer Archive / Restore ──────────────────────────────────────────────

export async function rpcArchiveCustomer(customerId: string): Promise<void> {
  const actorId = useAuthStore.getState().user?.id;
  const { error } = await supabase.rpc("archive_customer", {
    p_customer_id: customerId,
    p_archived_by: actorId,
  });
  if (error) throw new Error(friendly(error.message));
}

export async function rpcRestoreCustomer(customerId: string): Promise<void> {
  const { error } = await supabase.rpc("restore_customer", {
    p_customer_id: customerId,
  });
  if (error) throw new Error(friendly(error.message));
}

// ─── Void Sale ──────────────────────────────────────────────────────────────

export async function rpcVoidSale(saleId: string, reason: string): Promise<void> {
  const { error } = await scopedRpc("void_sale", {
    p_sale_id: saleId,
    p_reason: reason,
    p_voided_by: useAuthStore.getState().user?.id ?? null,
  });
  if (error) throw new Error(friendly(error.message));
}
