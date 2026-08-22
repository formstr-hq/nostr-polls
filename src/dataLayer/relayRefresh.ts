/**
 * Relay "refresh" signal — a monotonic counter that bumps whenever the worker
 * becomes able to serve cached data it couldn't a moment ago: after IndexedDB
 * hydration completes (the worker emits `ready` from its constructor, BEFORE
 * `start()` loads the store, and hydration's `bulkLoad` suppresses change emits —
 * so an interest declared during that window EOSEs on an empty store and never
 * receives the hydrated events), or after a worker restart that lost its
 * in-memory interests.
 *
 * Reactive consumers (`useEvents` / `useEvent` / the DM subscription) read this
 * via `useSyncExternalStore` and re-declare their interest when it changes, which
 * re-runs the REQ against the now-populated store. `bootstrap.ts` feeds it from
 * the worker boundary; this module is framework-free so non-React code can read
 * it too.
 */

let refreshCount = 0;
let hydrated = false;
const listeners = new Set<() => void>();

/** Bump the signal — call when the worker can newly serve more cached data. */
export function notifyRelayRefresh(): void {
  refreshCount++;
  listeners.forEach((l) => l());
}

/** Current signal value (changes identity-stably as a number). */
export function getRelayRefresh(): number {
  return refreshCount;
}

/**
 * Mark IndexedDB hydration as complete. Consumers use this to hold off
 * declaring "no results" until the store has actually finished loading —
 * otherwise a pre-hydration EOSE flashes an empty/failed state right before
 * the retry (driven by `notifyRelayRefresh`) paints the real data.
 */
export function markRelayHydrated(): void {
  hydrated = true;
}

/** True once IndexedDB hydration has completed at least once this session. */
export function isRelayHydrated(): boolean {
  return hydrated;
}

/** Subscribe to refreshes; returns an unsubscribe fn (useSyncExternalStore shape). */
export function subscribeRelayRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
