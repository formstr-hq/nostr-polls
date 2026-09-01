import { Event } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { collectOnce } from "../dataLayer/collect";

// ── NIP-A3: payto: Payment Targets ─────────────────────────────────────────────
// Payment targets live in a replaceable kind 10133 event as tags:
//   ["payto", "<type>", "<address>"]
// e.g. ["payto", "monero", "4..."]

export const PAYTO_EVENT_KIND = 10133;

/** Payment target types commonly used (per NIP-A3), always lowercase. */
export const PAYTO_TYPES = [
  "bip352",
  "bip353",
  "bitcoin",
  "cashme",
  "ethereum",
  "lightning",
  "litecoin",
  "monero",
  "nano",
  "paypal",
  "revolut",
  "solana",
  "venmo",
  "zcash",
] as const;

export type PaytoType = (typeof PAYTO_TYPES)[number];

export type PaytoTarget = {
  type: string;
  address: string;
};

/** Extract all payto targets from a kind 10133 event's tags. */
export function getPaytoTargets(event: Event): PaytoTarget[] {
  const targets: PaytoTarget[] = [];
  for (const tag of event.tags) {
    if (
      tag[0] === "payto" &&
      typeof tag[1] === "string" &&
      tag[1] &&
      typeof tag[2] === "string" &&
      tag[2]
    ) {
      targets.push({ type: tag[1].toLowerCase(), address: tag[2] });
    }
  }
  return targets;
}

/** Get the first payto target of the given type from an event (or null). */
export function getPaytoTarget(event: Event, type: string): PaytoTarget | null {
  const lowered = type.toLowerCase();
  return getPaytoTargets(event).find((t) => t.type === lowered) || null;
}

/** Build payto tags for a kind 10133 event from the given targets. */
export function buildPaytoTags(targets: PaytoTarget[]): string[][] {
  return targets
    .filter((t) => t.type && t.address)
    .map((t) => ["payto", t.type.toLowerCase(), t.address]);
}

/**
 * Fetch a pubkey's kind 10133 payto targets event (replaceable).
 *
 * The worker routes author-scoped reads via the outbox model: it reads the
 * author's NIP-65 list (kind 10002) from ITS cache and queries their write
 * relays — but nothing ever fetches other authors' 10002s (enrichment only
 * covers kind 0). For authors whose relay list isn't cached, the 10133 read
 * silently falls back to the user's own relays and misses the event.
 *
 * So: first warm the author's kind 10002 over the network (declared via a
 * short-lived interest; collectOnce resolves on stream-quiet), THEN fetch the
 * 10133. Results are memoized per pubkey so this happens once per author.
 */
const paytoEventCache = new Map<string, Event | null>();
const paytoEventInflight = new Map<string, Promise<Event | null>>();
// Pubkeys we've already network-probed — a miss won't retry until restart.
const paytoProbed = new Set<string>();

async function warmAuthorRelayList(pubkey: string): Promise<void> {
  try {
    await collectOnce([{ kinds: [10002], authors: [pubkey], limit: 1 }], {
      timeoutMs: 4000,
      quietMs: 600,
    });
  } catch {
    // best-effort: fall back to the user's own relays for the 10133 read
  }
}

export async function fetchPaytoEvent(
  pubkey: string
): Promise<Event | null> {
  if (paytoEventCache.has(pubkey)) {
    return paytoEventCache.get(pubkey) ?? null;
  }
  if (paytoEventInflight.has(pubkey)) {
    return paytoEventInflight.get(pubkey)!;
  }
  const promise = (async () => {
    try {
      // Cache-only probe first: if the author's relay list or 10133 is already
      // in the store, the worker can route the 10133 read immediately.
      let event = await dataLayer.fetchReplaceable(PAYTO_EVENT_KIND, pubkey);
      if (!event && !paytoProbed.has(pubkey)) {
        paytoProbed.add(pubkey);
        await warmAuthorRelayList(pubkey);
        const [fetched] = await collectOnce(
          [{ kinds: [PAYTO_EVENT_KIND], authors: [pubkey], limit: 1 }],
          { timeoutMs: 5000, quietMs: 700 }
        );
        event = fetched || null;
      }
      paytoEventCache.set(pubkey, event);
      return event;
    } catch {
      paytoEventCache.set(pubkey, null);
      return null;
    } finally {
      paytoEventInflight.delete(pubkey);
    }
  })();
  paytoEventInflight.set(pubkey, promise);
  return promise;
}

/**
 * Cache-buster for the fetch memo — after publishing a new 10133 the caller
 * can seed the cache with the signed event (or clear it) so the next read
 * reflects the update immediately.
 */
export function invalidatePaytoCache(pubkey: string, event?: Event | null) {
  if (event === undefined) {
    paytoEventCache.delete(pubkey);
  } else {
    paytoEventCache.set(pubkey, event);
  }
}

/** Fetch a pubkey's payto targets, or an empty array when none published. */
export async function fetchPaytoTargets(pubkey: string): Promise<PaytoTarget[]> {
  const event = await fetchPaytoEvent(pubkey);
  return event ? getPaytoTargets(event) : [];
}

/** Fetch a pubkey's payto target of a specific type (or null). */
export async function fetchPaytoTarget(
  pubkey: string,
  type: string
): Promise<PaytoTarget | null> {
  const event = await fetchPaytoEvent(pubkey);
  return event ? getPaytoTarget(event, type) : null;
}

/**
 * Basic validation for on-chain Monero addresses (mainnet/stagenet/testnet,
 * primary and integrated). No length/prefix guarantee is made for other types.
 */
export function isValidMoneroAddress(address: string): boolean {
  return /^[0-9A-Za-z]{90,130}$/.test(address);
}

/** Standard Monero address prefixes for stricter validation. */
const MONERO_PREFIXES = ["4", "8", "B", "A", "5", "7", "9", "F", "2", "3", "6"];

export function isValidMoneroAddressStrict(address: string): boolean {
  return (
    isValidMoneroAddress(address) && MONERO_PREFIXES.includes(address[0])
  );
}

/** Monero payment URI: monero:<address>[?tx_amount=<amount>] */
export function buildMoneroUri(address: string, amountXmr?: number): string {
  let uri = `monero:${address}`;
  if (amountXmr && amountXmr > 0) {
    uri += `?tx_amount=${amountXmr}`;
  }
  return uri;
}