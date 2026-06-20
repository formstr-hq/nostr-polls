/**
 * Worker entry — the thin platform shell. All logic lives in RelayService
 * (shipped by @formstr/local-relay); this just wires it to the real Worker
 * globals: selfChannel(self), the default WebSocket factory, and the shared
 * IndexedDB store. Spawned from the main thread via:
 *   new Worker(new URL("../worker/relay.worker", import.meta.url))
 */
/* eslint-disable no-restricted-globals */
import { RelayService, selfChannel, IndexedDBStorage } from "@formstr/local-relay";

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
