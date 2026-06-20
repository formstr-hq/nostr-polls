/**
 * Browser bootstrap for the DataLayer — the only place that touches platform
 * globals (Worker, document) and the app's signer. Spawns the relay worker,
 * wires the NIP-42 sign RPC + publish signing to `signerManager`, tracks the
 * active account, and pauses/resumes upstream on app visibility changes.
 *
 * Kept separate from `client.ts` so the DataLayer class stays unit-testable in
 * jsdom (no Worker, no signerManager import).
 */
import {
  DataLayer,
  LocalRelayClient,
  workerChannel,
  getDataLayer,
  setDataLayer,
  type Event,
} from "@formstr/local-relay";
import { signerManager } from "../singletons/Signer/SignerManager";
import { defaultRelays } from "../nostr";

let started = false;

/** Idempotent: spawns the worker + wires the DataLayer once, returns the singleton. */
export function bootstrapDataLayer(): DataLayer {
  if (started) return getDataLayer();
  started = true;

  // Webpack 5 emits a same-origin worker chunk for this URL form (proven by the
  // existing mining worker); loads under http(s)/capacitor origins alike.
  const worker = new Worker(new URL("../worker/relay.worker", import.meta.url));
  const channel = workerChannel(worker);

  const client = new LocalRelayClient(channel, {
    // The worker asks us to sign NIP-42 AUTH challenges; route to the active signer.
    onSignRequest: async (template) => {
      try {
        const signer = await signerManager.getSigner();
        return (await signer.signEvent(template)) as Event;
      } catch {
        return null; // refuse → worker treats the relay as auth-failed (counts as done)
      }
    },
  });

  // Upstream sync fallback + publish floor. Outbox routing per author (kind-10002)
  // happens inside the worker; this is the relay set used when an author's write
  // relays aren't yet known. (A later pass can feed the user's NIP-65 read list.)
  client.setUserRelays(defaultRelays);

  // Active account → worker scope. setActiveAccount does NOT rehydrate the shared
  // public store; it only retargets which scope/relays the syncs follow.
  const applyAccount = () =>
    client.setActiveAccount(signerManager.getUser()?.pubkey ?? null);
  applyAccount();
  signerManager.onChange(applyAccount);

  // Lifecycle: drop all sockets when backgrounded, reconnect syncs on return.
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") client.pause();
      else client.resume();
    });
  }

  const dataLayer = new DataLayer({
    client,
    sign: async (template) => {
      const signer = await signerManager.getSigner();
      return (await signer.signEvent(template)) as Event;
    },
  });
  setDataLayer(dataLayer);
  return dataLayer;
}
