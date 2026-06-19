/**
 * Worker entry — the thin platform shell. All logic lives in RelayService (which
 * is fully unit-tested over a fake channel + FakeSocket); this file just wires it
 * to the real Worker globals: `selfChannel(self)`, the real WebSocket factory
 * (default), nostr-tools verify (default), and the shared IndexedDB store.
 *
 * Loaded from the main thread via:
 *   new Worker(new URL("./localRelay/worker/relay.worker", import.meta.url))
 */
/* eslint-disable no-restricted-globals */
import { RelayService } from "../RelayService";
import { selfChannel } from "../transport/channel";
import { IndexedDBStorage } from "../storage/IndexedDBStorage";

const channel = selfChannel(self as unknown as {
  postMessage: (m: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
});

const service = new RelayService({
  channel,
  storage: new IndexedDBStorage("shared"),
});

// Hydrate from IndexedDB, then begin write-through + pruning.
void service.start();

export {};
