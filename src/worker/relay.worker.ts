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
} from "@formstr/local-relay";

const channel = selfChannel(self as unknown as {
  postMessage: (m: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
});

// Retention: the library default prunes by age (7-day TTL) + hard cap, and only
// protects kinds 0/3/10002/10000-19999. Gift wraps (kind 1059) are our ONLY
// persistent DM history — shedding them silently erases offline chats — and the
// DM read-state watermark (kind 30078) is load-bearing for unread counts. Both
// are now age/cap-proof; the cap only ever evicts replays of public data.
const prunePolicy = defaultPrunePolicy();
prunePolicy.protectedKinds.add(1059);
prunePolicy.protectedKinds.add(30078);

const service = new RelayService({
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
  channel.post({ kind: "hydrated" });
});

export {};
