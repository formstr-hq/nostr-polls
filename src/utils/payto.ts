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
 * NOTE: `dataLayer.fetchReplaceable` is cache-only (localOnly) — it never
 * triggers an upstream relay fetch, so other people's 10133 events would
 * never arrive. Instead we use `collectOnce`, which declares a standing
 * interest (the worker fetches from the user's relays) and resolves once
 * the stream goes quiet. Results are memoized per pubkey: payto targets
 * only change when the owner republishes, and this avoids a relay fetch
 * every time a Zap component mounts.
 */
const paytoEventCache = new Map<string, Event | null>();
const paytoEventInflight = new Map<string, Promise<Event | null>>();

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
      const [event] = await collectOnce(
        [{ kinds: [PAYTO_EVENT_KIND], authors: [pubkey], limit: 1 }],
        { timeoutMs: 4000, quietMs: 700 }
      );
      paytoEventCache.set(pubkey, event || null);
      return event || null;
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