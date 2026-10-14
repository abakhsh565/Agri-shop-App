/**
 * Local Data Cache
 *
 * Stores fetched data in localStorage with a timestamp so the app can
 * render immediately from cache while revalidating from the network
 * in the background. Uses stale-while-revalidate pattern.
 *
 * Cache structure in localStorage:
 *   agrishop_cache_<key> = { data: T, timestamp: number }
 *
 * Stale threshold: 5 minutes. After that, data is considered stale
 * and the app should refetch. But stale data is STILL shown until
 * the refetch completes — no blank screens.
 */

const CACHE_PREFIX = "agrishop_cache_";
const OWNER_KEY = CACHE_PREFIX + "owner";
const STALE_MS = 5 * 60 * 1000; // 5 minutes
let contextVersion = 0;
let suspended = false;
let writesInFlight = 0;
let confirmedContext: { tenantId: string; userId: string; branchId: string } | null = null;
let contextWaiters: Array<() => void> = [];
export const getConfirmedDataContext = () => suspended ? null : confirmedContext;
export const hasScopedWriteInFlight = () => writesInFlight > 0;
export function beginScopedWrite(): () => void {
  writesInFlight += 1;
  let finished = false;
  return () => { if (!finished) { finished = true; writesInFlight -= 1; } };
}

/** Requests capture this before awaiting; obsolete responses may not publish. */
export const captureDataContext = () => contextVersion;
export const isDataContextCurrent = (version: number) => !suspended && version === contextVersion;

/** Fail closed while the server resolves a branch, including after rehydration. */
export function suspendCachedData(): void {
  confirmedContext = null;
  suspended = true;
  clearAllCachedData();
}

export function confirmCacheBranch(tenantId: string, userId: string, branchId: string): void {
  adoptCacheOwner(`${tenantId}:${userId}:${branchId}`);
  confirmedContext = { tenantId, userId, branchId };
  suspended = false;
  // Release the reads that arrived before the context existed. Nothing else wakes them, and a
  // read that waits for a confirmation that has already happened is the only reason they exist.
  const waiting = contextWaiters;
  contextWaiters = [];
  waiting.forEach((wake) => wake());
}

/**
 * Wait until the branch context is confirmed. `false` if it never is (bounded).
 *
 * WHY THIS EXISTS. `isDataContextCurrent` answers "may this response publish?", and the stores ask
 * it before every read. A screen that mounts before the shell has confirmed which shop and branch
 * the app is working in — a deep link, a refresh on that screen, or the first navigation after
 * sign-in — asked that question too early and got `no`, and nothing ever asked again: `ready` stayed
 * false, the screen kept its "Loading…" or skeleton state for the whole session, and the rows were
 * never read even though the context was confirmed a moment later. The read was not wrong, it was
 * early, so the answer is to wait for the confirmation it depends on rather than to drop it.
 *
 * The bound matters: an app that never confirms a branch (no membership that resolves one) must
 * still settle, so the caller falls through to its own refusal instead of hanging.
 */
export function whenDataContextConfirmed(timeoutMs = 10000): Promise<boolean> {
  if (!suspended && confirmedContext) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(true);
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      contextWaiters = contextWaiters.filter((w) => w !== wake);
      resolve(false);
    }, timeoutMs);
    contextWaiters.push(wake);
  });
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/** Read cached data for a key. Returns null if no cache exists. */
export function getCachedData<T>(key: string): T | null {
  if (suspended) return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    return entry.data;
  } catch {
    return null;
  }
}

/** Check if the cache for a key is stale (older than STALE_MS). */
export function isCacheStale(key: string): boolean {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return true;
    const entry: CacheEntry<any> = JSON.parse(raw);
    return Date.now() - entry.timestamp > STALE_MS;
  } catch {
    return true;
  }
}

/** Write data to cache with current timestamp. */
export function setCachedData<T>(key: string, data: T): void {
  if (suspended) return;
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

/** Remove cached data for a key. */
export function clearCachedData(key: string): void {
  localStorage.removeItem(CACHE_PREFIX + key);
}

/** Drop every cached payload, and the ownership marker with it. */
export function clearAllCachedData(): void {
  contextVersion += 1;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) doomed.push(key);
    }
    doomed.forEach((key) => localStorage.removeItem(key));
  } catch {
    // localStorage unavailable — nothing to clear
  }
}

/**
 * Bind the cache to the identity allowed to read it.
 *
 * Cached rows paint instantly on the next launch, so a device used by more than
 * one shop or user must never show one account's rows to another. Anything
 * cached under a different identity is dropped before it can be rendered.
 */
export function adoptCacheOwner(ownerId: string): void {
  try {
    if (localStorage.getItem(OWNER_KEY) !== ownerId) {
      clearAllCachedData();
      localStorage.setItem(OWNER_KEY, ownerId);
    }
  } catch {
    // localStorage unavailable — the cache is inert anyway
  }
}

/**
 * Smart load: returns cached data immediately if available,
 * and whether it's stale (should refetch).
 * Returns { data, stale } — data may be null on first load.
 */
export function getCachedOrStale<T>(key: string): { data: T | null; stale: boolean } {
  const data = getCachedData<T>(key);
  const stale = isCacheStale(key);
  return { data, stale };
}
