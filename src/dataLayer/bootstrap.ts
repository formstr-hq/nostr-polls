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
  type Channel,
  type Event,
} from "@formstr/local-relay";
import { signerManager } from "../singletons/Signer/SignerManager";
import { defaultRelays } from "../nostr";
import { notifyRelayRefresh, subscribeRelayRefresh } from "./relayRefresh";

let started = false;

/** Idempotent: spawns the worker + wires the DataLayer once, returns the singleton. */
export function bootstrapDataLayer(): DataLayer {
  if (started) return getDataLayer();
  started = true;

  // Webpack 5 emits a same-origin worker chunk for this URL form (proven by the
  // existing mining worker); loads under http(s)/capacitor origins alike.
  const worker = new Worker(new URL("../worker/relay.worker", import.meta.url));
  const baseChannel = workerChannel(worker);

  // Wrap the channel to watch the worker boundary for moments when it can newly
  // serve cached data: `hydrated` (posted by our worker entry once IndexedDB load
  // finishes — interests declared during boot EOSE'd on an empty store and missed
  // it) and a repeat `ready` (a worker restart that dropped its in-memory
  // interests). Both bump the refresh signal so the hooks re-declare. Unknown
  // frames are passed straight through to the client, which ignores them.
  let readyCount = 0;
  const channel: Channel = {
    post: (m) => baseChannel.post(m),
    close: () => baseChannel.close(),
    onMessage: (handler) =>
      baseChannel.onMessage((m) => {
        const kind = (m as { kind?: string } | null)?.kind;
        if (kind === "hydrated") {
          notifyRelayRefresh();
        } else if (kind === "ready") {
          readyCount += 1;
          if (readyCount > 1) notifyRelayRefresh(); // restart, not first boot
        }
        handler(m);
      }),
  };

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

  // Base relay set: the upstream sync floor AND the relays that author-LESS
  // interests (DMs/kind-1059, mentions, "global") get their LIVE subscriptions on.
  // Outbox routing per author (kind-10002) happens inside the worker on top of this.
  client.setUserRelays(defaultRelays);

  // Feed the user's OWN relays into the worker so DMs are received in REAL TIME.
  // Two ROUTING-POLICY inputs, kept separate (local-relay >= 0.4.0):
  //   - setUserRelays  ← NIP-65 read relays (kind 10002), the floor for feeds and
  //     every author-less scope EXCEPT DMs.
  //   - setDmRelays    ← NIP-17 DM inbox relays (kind 10050). The kind-1059 stream
  //     reads from DM relays UNION user relays; other author-less scopes (the feed
  //     firehose, {ids} fetches) never touch the DM inbox relays. Folding 10050
  //     into setUserRelays (the pre-0.4.0 approach) firehosed the user's whole
  //     feed at their often access-restricted DM relay — exactly what this avoids.
  // A standing syncing observe fetches both lists; each is reapplied as it arrives.
  // A real change reopens the affected standing subs on the new relays; both lists
  // can only ever ADD relays above the default floor.
  let userRelaysHandle: { unobserve: () => void } | null = null;
  const applyUserRelays = () => {
    userRelaysHandle?.unobserve();
    userRelaysHandle = null;
    const pubkey = signerManager.getUser()?.pubkey;
    if (!pubkey) {
      client.setUserRelays(defaultRelays);
      client.setDmRelays([]);
      return;
    }
    const readRelays = new Set(defaultRelays);
    const dmRelays = new Set<string>();
    userRelaysHandle = client.observe(
      [{ kinds: [10002, 10050], authors: [pubkey] }],
      {
        onEvent: (event: Event) => {
          if (event.kind === 10002) {
            // NIP-65 `r` tags: unmarked = read+write, "read" = inbox.
            for (const t of event.tags) {
              if (t[0] === "r" && t[1] && (!t[2] || t[2] === "read")) readRelays.add(t[1]);
            }
            client.setUserRelays(Array.from(readRelays));
          } else if (event.kind === 10050) {
            // NIP-17 DM inbox relays → dedicated kind-1059 routing.
            for (const t of event.tags) {
              if (t[0] === "relay" && t[1]) dmRelays.add(t[1]);
            }
            client.setDmRelays(Array.from(dmRelays));
          }
        },
      }
    );
  };

  // Active account → worker scope + that account's own relays. setActiveAccount
  // does NOT rehydrate the shared store; it only retargets scope/sync.
  const applyAccount = () => {
    client.setActiveAccount(signerManager.getUser()?.pubkey ?? null);
    applyUserRelays();
  };
  applyAccount();
  signerManager.onChange(applyAccount);

  // The user's relay lists may only be in the store after hydration — re-apply on
  // the refresh signal so the live DM relay set reflects them once available.
  subscribeRelayRefresh(applyUserRelays);

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
