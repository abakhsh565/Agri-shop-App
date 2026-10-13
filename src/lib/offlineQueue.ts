/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Offline Write Queue
 *
 * Persists pending write operations to localStorage and replays them to
 * Supabase when connectivity is restored. Each item carries the full
 * payload needed to retry the operation, plus the account and branch context
 * it was queued from.
 *
 * The queue is deliberately ownership-aware:
 *  - every item records the tenant/userId/branchId it was created under, via
 *    `getConfirmedDataContext()` at enqueue time;
 *  - replay refuses to send work whose original context no longer matches the
 *    confirmed context of the device, so a switch or a different account cannot
 *    implicitly ship one shop's sale into another's;
 *  - work that was queued before this ownership contract existed is retained
 *    rather than guessed, so it does not silently disappear.
 *
 * Operation types:
 *  - create_sale        → rpc create_sale
 *  - create_customer    → insert customers
 *  - create_notification → insert notifications
 *  - record_payment     → rpc record_customer_payment
 *  - update_note        → update sales.note
 *  - void_sale          → rpc void_sale
 *  - record_supplier_payment → rpc record_supplier_payment
 *  - process_return     → rpc process_return
 */

import { getConfirmedDataContext, beginScopedWrite } from "@/lib/localCache";

export type QueueOperation =
  | { type: "create_sale"; payload: Record<string, unknown> }
  | { type: "create_customer"; payload: Record<string, unknown> }
  | { type: "create_notification"; payload: Record<string, unknown> }
  | { type: "record_payment"; payload: Record<string, unknown> }
  | { type: "record_supplier_payment"; payload: Record<string, unknown> }
  | { type: "update_note"; payload: { saleId: string; note: string } }
  | { type: "void_sale"; payload: { saleId: string; reason: string } }
  | { type: "process_return"; payload: Record<string, unknown> };

export interface QueueItem {
  id: string;
  operation: QueueOperation;
  queuedAt: string;
  retries: number;
  context?: { tenantId: string; userId: string; branchId: string };
  /** Server-assigned ID after successful sync (for sale/customer) */
  syncedId?: string;
  /** Error message from last failed attempt */
  lastError?: string;
}

const STORAGE_KEY = "agrishop_write_queue";
const MAX_RETRIES = 5;

// ─── Persistence ────────────────────────────────────────────────────────────

export function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue: QueueItem[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

// ─── Public API ─────────────────────────────────────────────────────────────

let syncInFlight = false;

/** Add an operation to the queue. Returns the queue item id. */
export function enqueueOperation(op: QueueOperation): string {
  const queue = loadQueue();
  const context = getConfirmedDataContext();
  const item: QueueItem = {
    id: `oq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    operation: op,
    queuedAt: new Date().toISOString(),
    retries: 0,
    context: context ? { tenantId: context.tenantId, userId: context.userId, branchId: context.branchId } : undefined,
  };
  queue.push(item);
  saveQueue(queue);
  return item.id;
}

/** Remove a successfully-synced item from the queue. */
export function dequeueOperation(id: string): void {
  const queue = loadQueue().filter((q) => q.id !== id);
  saveQueue(queue);
}

/** Mark an item as failed with an error message. */
export function markOperationFailed(id: string, error: string): void {
  const queue = loadQueue().map((q) =>
    q.id === id ? { ...q, retries: q.retries + 1, lastError: error } : q
  );
  saveQueue(queue);
}

/** Get the count of pending items. */
export function getPendingCount(): number {
  return loadQueue().length;
}

/**
 * Sync all pending items to Supabase.
 * Uses the provided supabase client (from @/lib/supabase).
 * Returns { synced, failed } counts.
 */
export async function syncPendingOperations(
  supabaseClient: any
): Promise<{ synced: number; failed: number; errors: string[] }> {
  if (syncInFlight) return { synced: 0, failed: 0, errors: [] };
  syncInFlight = true;

  const queue = loadQueue();
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];
  const remaining: QueueItem[] = [];

  try {
    for (const item of queue) {
      if (item.retries >= MAX_RETRIES) {
        remaining.push(item);
        failed++;
        errors.push(`${item.operation.type}: max retries exceeded (${item.lastError ?? "unknown"})`);
        continue;
      }

      try {
        const context = getConfirmedDataContext();
        if (!item.context || !context || item.context.userId !== context.userId ||
          item.context.tenantId !== context.tenantId || item.context.branchId !== context.branchId) {
          throw new Error("Queued work needs its original account and branch before it can be sent");
        }
        const finish = beginScopedWrite();
        try {
          const result = await executeOperation(supabaseClient, item);
          synced++;
          if (result?.id) {
            item.syncedId = result.id;
          }
        } finally {
          finish();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        item.retries += 1;
        item.lastError = msg;
        remaining.push(item);
        failed++;
        errors.push(`${item.operation.type}: ${msg}`);
      }
    }
  } finally {
    // The lock must never wedge: even a thrown localStorage read, a network
    // exception inside the executor loop, or an unexpected store error must
    // reset the gate before anything else runs.
    syncInFlight = false;

    // Publish the present state of the queue after every attempt above gets a
    // chance to edit it. New work queued while we were sending is kept, leftover
    // retries are kept, and successfully synced items are only removed when we
    // reach here with a queue that actually left them behind.
    const snapshotIds = new Set(queue.map((item) => item.id));
    saveQueue([
      ...remaining,
      ...loadQueue().filter((item) => !snapshotIds.has(item.id)),
    ]);
  }

  return { synced, failed, errors };
}

// ─── Operation Executors ────────────────────────────────────────────────────

async function executeOperation(
  client: any,
  item: QueueItem
): Promise<{ id?: string } | null> {
  const { type, payload } = item.operation;
  const branchPayload = { ...payload, branchId: item.context?.branchId, shopId: item.context?.tenantId };

  switch (type) {
    case "create_sale": {
      const { data, error } = await client.rpc("create_sale", { payload: branchPayload });
      if (error) throw new Error(error.message);
      return { id: (data as any)?.id };
    }

    case "create_customer": {
      const { data, error } = await client
        .from("customers")
        .insert(payload)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { id: (data as any)?.id };
    }

    case "create_notification": {
      const { error } = await client.from("notifications").insert(payload);
      if (error) throw new Error(error.message);
      return null;
    }

    case "record_payment": {
      const { data, error } = await client.rpc("record_customer_payment", { payload: branchPayload });
      if (error) throw new Error(error.message);
      return { id: (data as any)?.id };
    }

    case "record_supplier_payment": {
      const { data, error } = await client.rpc("record_supplier_payment", { payload: branchPayload });
      if (error) throw new Error(error.message);
      return { id: (data as any)?.id };
    }

    case "update_note": {
      const { data, error } = await client
        .from("sales")
        .update({ notes: payload.note })
        .eq("id", payload.saleId)
        .eq("branch_id", item.context?.branchId)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("The note was not saved in its original branch");
      return null;
    }

    case "void_sale": {
      const { error } = await client.rpc("void_sale", {
        p_sale_id: payload.saleId,
        p_reason: payload.reason,
      });
      if (error) throw new Error(error.message);
      return null;
    }

    case "process_return": {
      const { data, error } = await client.rpc("process_return", { payload: branchPayload });
      if (error) throw new Error(error.message);
      return { id: (data as any)?.id };
    }

    default:
      throw new Error(`Unknown operation type: ${type}`);
  }
}
