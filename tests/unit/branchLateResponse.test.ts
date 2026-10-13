import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ pending: [] as Array<(result: unknown) => void> }));
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://qa.supabase.co', supabase: {
  from: () => ({ select: () => ({ order: () => ({ limit: () => new Promise((resolve) => transport.pending.push(resolve)) }) }) }),
} }));
import { useSalesStore } from '@/stores/salesStore';
import { confirmCacheBranch, suspendCachedData, getCachedData } from '@/lib/localCache';

describe('late branch response cannot repopulate the real store', () => {
  beforeEach(() => { localStorage.clear(); transport.pending = []; confirmCacheBranch('business', 'owner', 'main'); useSalesStore.getState().reset(); });
  it('discards Main data arriving after Warehouse adoption, including the instant cache', async () => {
    const request = useSalesStore.getState().load();
    expect(transport.pending).toHaveLength(1);
    suspendCachedData(); useSalesStore.getState().reset(); confirmCacheBranch('business', 'owner', 'warehouse');
    transport.pending.shift()!({ data: [{ id: 'main-sale', sale_items: [] }], error: null });
    await request;
    expect(useSalesStore.getState().sales).toEqual([]);
    expect(useSalesStore.getState().ready).toBe(false);
    expect(getCachedData('sales')).toBeNull();
  });
  it('every domain loader captures a context version and rejects obsolete results', () => {
    for (const name of ['products', 'customers', 'sales', 'companies', 'employees', 'roles', 'notification']) {
      const source = fs.readFileSync(`src/stores/${name}Store.ts`, 'utf8');
      const load = source.slice(source.indexOf('  load: async'), source.indexOf('  subscribe:', source.indexOf('  load: async')) > 0
        ? source.indexOf('  subscribe:', source.indexOf('  load: async')) : source.indexOf('  createRole:', source.indexOf('  load: async')));
      expect(load, name).toContain('captureDataContext()');
      expect(load.match(/isDataContextCurrent\(context\)/g)?.length, name).toBeGreaterThanOrEqual(2);
    }
    const broken = 'load: async () => { const data = await fetchRows(); set({ data }); }';
    expect(broken.includes('isDataContextCurrent(context)')).toBe(false);
  });
  it('does not request business data while server context is unresolved', async () => {
    suspendCachedData();
    await useSalesStore.getState().load();
    expect(transport.pending).toHaveLength(0);
    expect(useSalesStore.getState().sales).toEqual([]);
  });
});
