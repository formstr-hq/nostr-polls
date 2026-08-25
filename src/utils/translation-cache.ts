/**
 * Translation cache utilities
 * In-memory, session-scoped: translations are enrichment (text renders fine
 * without one), so they don't pay for localStorage quota or per-write sync.
 * Capped LRU so a long session with lots of notes can't grow unbounded.
 */

const MAX_ENTRIES = 200;

type CacheEntry = { translation: string };

const cache = new Map<string, CacheEntry>();

/**
 * Get cached translation
 */
export function getCachedTranslation(
  text: string,
  targetLang: string
): string | null {
  const key = `${targetLang}::${text}`;
  const entry = cache.get(key);
  if (!entry) return null;
  // Refresh recency.
  cache.delete(key);
  cache.set(key, entry);
  return entry.translation;
}

/**
 * Set cached translation
 */
export function setCachedTranslation(
  text: string,
  targetLang: string,
  translation: string
): void {
  const key = `${targetLang}::${text}`;
  if (cache.has(key)) cache.delete(key);
  const entry: CacheEntry = { translation };
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Clear all translation cache
 */
export function clearTranslationCache(): void {
  cache.clear();
}
