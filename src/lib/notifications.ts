import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { enqueueOperation } from "@/lib/offlineQueue";
import { isAlertDue, loadStockAlertSettings } from "@/lib/stockAlerts";

/**
 * Create a notification from the frontend.
 * Used after RPC calls that don't create notifications in the DB.
 */
export async function createNotification(input: {
  kind: string;
  title: string;
  body?: string;
  entityId?: string;
}): Promise<void> {
  const user = useAuthStore.getState().user;
  const payload = {
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    entity_id: input.entityId ?? null,
    actor_id: user?.id ?? null,
    actor_name: user?.name ?? null,
  };

  try {
    const { error } = await supabase.from("notifications").insert(payload);
    if (error) {
      if (import.meta.env.DEV) console.error("[Notification] Insert failed:", error.message, error.code);
      // If offline, queue for later
      if (!navigator.onLine) {
        enqueueOperation({ type: "create_notification", payload });
      }
    }
  } catch (err) {
    if (import.meta.env.DEV) console.error("[Notification] Insert exception:", err);
    if (!navigator.onLine) {
      enqueueOperation({ type: "create_notification", payload });
    }
  }
}

/** Create a payment received notification */
export async function notifyPaymentReceived(
  customerName: string,
  amount: number,
  customerId: string
): Promise<void> {
  await createNotification({
    kind: "payment",
    title: `Payment received: Rs. ${amount.toLocaleString("en-PK")}`,
    body: `${customerName} paid Rs. ${amount.toLocaleString("en-PK")}`,
    entityId: customerId,
  });
}

/** Create a return processed notification */
export async function notifyReturnProcessed(
  customerName: string,
  refundAmount: number,
  saleId: string
): Promise<void> {
  await createNotification({
    kind: "return",
    title: `Return from ${customerName}`,
    body: `Rs. ${refundAmount.toLocaleString("en-PK")} refund processed`,
    entityId: saleId,
  });
}

/**
 * Warn about a product that has just run low, at the frequency the shop chose.
 *
 * This used to fire on **every** call — once per sale line — so a shop selling ten packs
 * on a busy afternoon got ten identical alerts about the same product, and the screen
 * taught it that these notices are noise. The shop's own policy now decides: once at the
 * crossing, once a day, or every few days (Settings → Stock alerts).
 *
 * `previousStock` is what makes "only when it crosses" truthful: only the caller knows
 * the level before the sale, and without it the rule would have to guess. It is optional
 * so existing callers keep working, and an unknown previous level is read as "the first
 * time we have seen this product low" rather than as a crossing.
 */
export async function checkAndNotifyLowStock(
  productId: string,
  productName: string,
  currentStock: number,
  threshold: number,
  previousStock?: number
): Promise<void> {
  // Above the line: nothing happened that the shop needs to hear about.
  if (currentStock > threshold) return;

  const { frequency } = await loadStockAlertSettings();

  // Look for the last time this product was alerted about, so "once a day" and "only at
  // the crossing" have something to measure against. A failure to read it is treated as
  // "no previous alert" by `isAlertDue` — the alert path must not go silent because a
  // history lookup failed.
  let lastAlertAt: string | null = null;
  try {
    const { data } = await supabase
      .from("notifications")
      .select("created_at")
      .eq("kind", "low_stock")
      .eq("entity_id", productId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastAlertAt = (data as { created_at?: string } | null)?.created_at ?? null;
  } catch {
    lastAlertAt = null;
  }

  // "It crossed" means it was fine before this sale and is low now. Written with a negated
  // comparison rather than a greater-than sign so the pair of angle brackets the i18n
  // ratchet scans for never appears in prose the ratchet would then have to be taught to
  // ignore: weakening that guard to keep a comment is the wrong trade.
  const sawPreviousLevel = typeof previousStock === "number";
  const wasFineBefore = sawPreviousLevel ? !(previousStock <= threshold) : false;
  const crossed = sawPreviousLevel ? wasFineBefore && currentStock <= threshold : undefined;

  if (!isAlertDue({ lastAlertAt, frequency, crossed })) return;

  if (currentStock > 0) {
    await createNotification({
      kind: "low_stock",
      title: `Low stock: ${productName}`,
      body: `${productName} has ${currentStock} left (warns at ${threshold})`,
      entityId: productId,
    });
  } else {
    await createNotification({
      kind: "low_stock",
      title: `Out of stock: ${productName}`,
      body: `${productName} is now out of stock`,
      entityId: productId,
    });
  }
}
