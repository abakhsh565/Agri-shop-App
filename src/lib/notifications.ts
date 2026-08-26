import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";

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
  try {
    await supabase.from("notifications").insert({
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      entity_id: input.entityId ?? null,
      actor_id: user?.id ?? null,
      actor_name: user?.name ?? null,
    });
  } catch {
    // Non-critical — don't break the flow if notification creation fails
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

/** Check stock and create low-stock alert if needed */
export async function checkAndNotifyLowStock(
  productId: string,
  productName: string,
  currentStock: number,
  threshold: number
): Promise<void> {
  if (currentStock <= threshold && currentStock > 0) {
    await createNotification({
      kind: "low_stock",
      title: `Low stock: ${productName}`,
      body: `${productName} has ${currentStock} units remaining (threshold: ${threshold})`,
      entityId: productId,
    });
  } else if (currentStock <= 0) {
    await createNotification({
      kind: "low_stock",
      title: `Out of stock: ${productName}`,
      body: `${productName} is now out of stock`,
      entityId: productId,
    });
  }
}
