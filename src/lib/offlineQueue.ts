/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Offline Write Queue
 *
 * Persists pending write operations to localStorage and replays them to
 * Supabase when connectivity is restored. Each item carries the full
 * payload needed to retry the operation.
 *
 * Operation types:
 *  - create_sale        → rpc create_sale
 *  - create_customer    → insert customers
 *  - create_notification → insert notifications
 *  - record_payment     → rpc record_customer_payment
 *  - update_note        → update sales.note
 *  - void_sale          → rpc void_sale
 *  - record_supplier_payment → rpc record_supplier_payment
 */

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
  const item: QueueItem = {
    id: `oq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    operation: op,
    queuedAt: new Date().toISOString(),
    retries: 0,
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

  for (const item of queue) {
    if (item.retries >= MAX_RETRIES) {
      remaining.push(item);
      failed++;
      errors.push(`${item.operation.type}: max retries exceeded (${item.lastError ?? "unknown"})`);
      continue;
    }

    try {
      const result = await executeOperation(supabaseClient, item);
      synced++;
      if (result?.id) {
        item.syncedId = result.id;
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

  saveQueue(remaining);
  syncInFlight = false;

  return { synced, failed, errors };
}

// ─── Operation Executors ────────────────────────────────────────────────────

async function executeOperation(
  client: any,
  item: QueueItem
): Promise<{ id?: string } | null> {
  const { type, payload } = item.operation;

  switch (type) {
    case "create_sale": {
      const { data, error } = await client.rpc("create_sale", { payload });
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
      const { data, error } = await client.rpc("record_customer_payment", { payload });
      if (error) throw new Error(error.message);
      return { id: (data as any)?.id };
    }

    case "record_supplier_payment": {
      const { data, error } = await client.rpc("record_supplier_payment", { payload });
      if (error) throw new Error(error.message);
      return { id: (data as any)?.id };
    }

    case "update_note": {
      const { error } = await client
        .from("sales")
        .update({ note: payload.note })
        .eq("id", payload.saleId);
      if (error) throw new Error(error.message);
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
      const { data, error } = await client.rpc("process_return", { payload });
      if (error) throw new Error(error.message);
      return { id: (data as any)?.id };
    }

    default:
      throw new Error(`Unknown operation type: ${type}`);
  }
}
