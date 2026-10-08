/**
 * Worker entry — the thin platform shell. All logic lives in RelayService
 * (shipped by @formstr/local-relay); this just wires it to the real Worker
 * globals: selfChannel(self), the default WebSocket factory, and the shared
 * IndexedDB store. Spawned from the main thread via:
 *   new Worker(new URL("../worker/relay.worker", import.meta.url))
 */
/* eslint-disable no-restricted-globals */
import {
  RelayService,
  selfChannel,
  IndexedDBStorage,
  defaultPrunePolicy,
  type Channel,
} from "@formstr/local-relay";

const base = selfChannel(self as unknown as {
  postMessage: (m: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
});

// `app:remove-events` — main-thread flood control. Intercepted before the
// relay protocol sees it; EventDB.remove is private in 0.6.4's .d.ts but
// present at runtime (same honest cast as prunePolicy below) and the removal
// propagates through write-through persistence as a real IndexedDB delete.
let service!: RelayService;
const channel: Channel = {
  post: (m) => base.post(m),
  close: () => base.close(),
  onMessage: (handler) =>
    base.onMessage((m) => {
      if ((m as { kind?: string } | null)?.kind === "app:remove-events") {
        const ids = (m as { ids?: unknown }).ids;
        if (Array.isArray(ids)) {
          const db = service.db as unknown as { remove(id: string): void };
          for (const id of ids) {
            if (typeof id === "string" && id) db.remove(id);
          }
        }
        return;
      }
      handler(m);
    }),
};

// Retention: the library prune is age-TTL + hard cap (50k events total), and
// protected kinds skip BOTH the TTL sweep and the eviction filter. The 7-day
// default silently erased gift-wrapped DM history, but fully protecting kind
// 1059 would also leave a junk-wrap flood with no storage bound — so wraps get
// a ~1-year TTL via ttlByKind and stay unprotected, i.e. always evictable
// oldest-first once the store passes the global cap. The DM read-state
// watermark (kind 30078) stays protected: one tiny event per conversation,
// load-bearing for unread counts.
//
// Beyond this policy: the main thread is the only place a wrap's sender is
// visible (it lives inside the encrypted seal), so IT classifies out-of-WoT
// wraps and asks the worker to drop them once a 72h intro-safety grace
// elapses — see the `app:remove-events` intercept below.
const prunePolicy = defaultPrunePolicy();
prunePolicy.protectedKinds.add(30078);
prunePolicy.ttlByKind.set(1059, 365 * 24 * 60 * 60);
// NIP-59 ephemeral gift wraps (pings): minutes locally, mirroring the relay-
// side MUST-NOT-STORE semantics. Consumed pings are deleted on arrival anyway.
prunePolicy.ttlByKind.set(21059, 10 * 60);

service = new RelayService({
  channel,
  storage: new IndexedDBStorage("shared"),
  // 0.6.4 honors options.prunePolicy at runtime (RelayService stores it and the
  // periodic prune calls db.prune(policy)) but the shipped .d.ts omits the
  // field — assertion keeps the call honest until the types catch up.
  prunePolicy,
} as ConstructorParameters<typeof RelayService>[0]);

// Hydrate from IndexedDB, then begin write-through + pruning. The worker emits
// `ready` from its constructor (before hydration), and hydration's bulkLoad
// suppresses change emits — so interests declared during boot can EOSE on an
// empty store and miss the hydrated cache. We post a `hydrated` frame once the
// store is loaded so the main thread can re-declare its interests against it.
void service.start().then(() => {
  base.post({ kind: "hydrated" });
});

export {};
