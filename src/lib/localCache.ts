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

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/** Read cached data for a key. Returns null if no cache exists. */
export function getCachedData<T>(key: string): T | null {
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
