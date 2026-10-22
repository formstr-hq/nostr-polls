import { dataLayer, type Event, type Filter } from "@formstr/local-relay";

/**
 * One-shot collection over the dataLayer's streaming `observe`.
 *
 * The contract deliberately has no `querySync` — growing result sets must stream
 * so the worker (local relay) stays the single owner of the network. But some
 * call sites genuinely need a *finite* snapshot they act on exactly once (e.g.
 * "find my existing votes, then delete them").
 *
 * IMPORTANT: under this contract the observe `onEose` fires after the LOCAL
 * store replay (immediate, empty on a cold cache) — NOT after the worker's
 * upstream relay fetch, which streams in later via `onEvent`. So we must NOT
 * treat EOSE as completion (that returns nothing on a cold read). Instead we
 * keep the interest open and resolve when events stop arriving (a short quiet
 * period after the last one) or when a hard timeout elapses — whichever comes
 * first — then drop the interest.
 *
 * This is NOT a way to drive the network — the worker still decides if/when to
 * fetch; we only collect what it streams back.
 */
export function collectOnce(
  filters: Filter[],
  options?: { localOnly?: boolean; timeoutMs?: number; quietMs?: number }
): Promise<Event[]> {
  const { localOnly = false, timeoutMs = 4000, quietMs = 700 } = options || {};
  return new Promise((resolve) => {
    const byId = new Map<string, Event>();
    let settled = false;
    let handle: { unobserve: () => void } | null = null;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (quietTimer) clearTimeout(quietTimer);
      handle?.unobserve();
      resolve(Array.from(byId.values()));
    };

    // Hard cap so a read can never hang (and bounds the wait on a cold miss).
    const hardTimer = setTimeout(finish, timeoutMs);

    handle = dataLayer.observe(
      filters,
      {
        onEvent: (e) => {
          byId.set(e.id, e);
          // Settle shortly after the stream goes quiet (cache + upstream done).
          if (quietTimer) clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, quietMs);
        },
        // Networked reads: local EOSE is not completion (upstream streams in
        // later). A pure cache read has no upstream, so its EOSE — the end of
        // the store replay — is exactly completion. (Settling on a 0ms timer
        // instead resolved before the worker's async replay arrived, so cache
        // reads always came back empty.)
        ...(localOnly ? { onEose: finish } : {}),
      },
      { localOnly }
    );
  });
}
