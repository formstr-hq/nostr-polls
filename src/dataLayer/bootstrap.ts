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

  // Feed the user's OWN relays into that set so DMs are received in REAL TIME.
  // Author-less interests only stream live from the user-relay set, so if the
  // worker only knows defaultRelays a gift wrap delivered to the user's actual
  // inbox relays isn't seen until a reconnect re-query (the "DMs aren't live"
  // symptom; feeds are unaffected because they're outbox-routed to the author).
  // A standing syncing observe fetches the user's NIP-65 read relays (kind 10002)
  // and NIP-17 DM inbox relays (kind 10050) and folds them in — each list can only
  // ever add relays above the default floor.
  let userRelaysHandle: { unobserve: () => void } | null = null;
  const applyUserRelays = () => {
    userRelaysHandle?.unobserve();
    userRelaysHandle = null;
    const pubkey = signerManager.getUser()?.pubkey;
    if (!pubkey) {
      client.setUserRelays(defaultRelays);
      return;
    }
    const relays = new Set(defaultRelays);
    userRelaysHandle = client.observe(
      [{ kinds: [10002, 10050], authors: [pubkey] }],
      {
        onEvent: (event: Event) => {
          if (event.kind === 10002) {
            // NIP-65 `r` tags: unmarked = read+write, "read" = inbox.
            for (const t of event.tags) {
              if (t[0] === "r" && t[1] && (!t[2] || t[2] === "read")) relays.add(t[1]);
            }
          } else if (event.kind === 10050) {
            // NIP-17 DM inbox relays.
            for (const t of event.tags) {
              if (t[0] === "relay" && t[1]) relays.add(t[1]);
            }
          }
          client.setUserRelays(Array.from(relays));
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
