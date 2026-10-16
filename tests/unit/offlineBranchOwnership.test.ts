import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueOperation, loadQueue, saveQueue, syncPendingOperations } from '@/lib/offlineQueue';
import { confirmCacheBranch } from '@/lib/localCache';

describe('offline branch/account ownership', () => {
  beforeEach(() => { localStorage.clear(); saveQueue([]); confirmCacheBranch('business', 'owner', 'main'); });
  it('never replays Main work as Warehouse or another account', async () => {
    enqueueOperation({ type: 'create_sale', payload: { idempotencyKey: 'fixture' } });
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'saved' }, error: null });
    confirmCacheBranch('business', 'owner', 'warehouse');
    expect((await syncPendingOperations({ rpc })).failed).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
    confirmCacheBranch('business', 'other-person', 'main');
    expect((await syncPendingOperations({ rpc })).failed).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
    confirmCacheBranch('business', 'owner', 'main');
    expect((await syncPendingOperations({ rpc })).synced).toBe(1);
    expect(rpc).toHaveBeenCalledWith('create_sale', { payload: { idempotencyKey: 'fixture', branchId: 'main', shopId: 'business' } });
    expect(loadQueue()).toEqual([]);
  });
  it('retains legacy unowned work instead of guessing a branch', async () => {
    saveQueue([{ id: 'legacy', operation: { type: 'create_sale', payload: {} }, queuedAt: '2026-10-06', retries: 0 }]);
    const rpc = vi.fn();
    expect((await syncPendingOperations({ rpc })).failed).toBe(1);
    expect(loadQueue()).toHaveLength(1);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('does not lose work queued while an earlier request is in flight', async () => {
    enqueueOperation({ type: 'create_sale', payload: { idempotencyKey: 'first' } });
    let resolve!: (value: unknown) => void;
    const rpc = vi.fn(() => new Promise((done) => { resolve = done; }));
    const syncing = syncPendingOperations({ rpc });
    enqueueOperation({ type: 'create_sale', payload: { idempotencyKey: 'second' } });
    resolve({ data: { id: 'saved' }, error: null });
    await syncing;
    expect(loadQueue()).toHaveLength(1);
    expect(loadQueue()[0].operation.payload).toMatchObject({ idempotencyKey: 'second' });
  });
});
