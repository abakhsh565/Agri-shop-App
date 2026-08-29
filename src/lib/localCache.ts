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
