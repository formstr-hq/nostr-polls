import { Event } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";

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

/** Fetch a pubkey's kind 10133 payto targets event (replaceable). */
export async function fetchPaytoEvent(pubkey: string): Promise<Event | null> {
  return dataLayer.fetchReplaceable(PAYTO_EVENT_KIND, pubkey);
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