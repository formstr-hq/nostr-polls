import { Event, EventTemplate, finalizeEvent } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";
import { dataLayer } from "@formstr/local-relay";
import { signerManager } from "../singletons/Signer/SignerManager";
import { withClientTag } from "../services/clientTagSettings";

export const defaultRelays = [
  "wss://relay.formstr.app",
  "wss://relay.damus.io/",
  "wss://relay.primal.net/",
  "wss://nos.lol",
  "wss://relay.nostr.wirednet.jp/",
  "wss://nostr-01.yakihonne.com",
  "wss://nostr21.com",
  // relay.snort.social removed — frequently drops connections causing console spam
  // relay.nostr.band removed — confirmed dead
];

/**
 * Default relay for the NIP-46 `nostrconnect://` QR pairing flow.
 *
 * Kept to a single, known-good relay: the pairing subscription fails outright
 * if any relay in the list is unreachable, so adding extra public relays only
 * adds failure modes. The app's own relay handles kind:24133 RPC reliably.
 * The former hardcoded default, `relay.nsec.app`, was decommissioned and
 * silently broke every QR login. Users can still edit the field before pairing.
 */
export const nip46Relays = ["wss://relay.formstr.app"];

// Relays that support NIP-50 free-text search
export const searchRelays = [
  "wss://relay.noswhere.com",
  "wss://nostr.wine"
];

// Profile-specific search relays
export const profileSearchRelays = [
  "wss://relay.noswhere.com",
  "wss://nostr.wine",
];

export const fetchUserProfile = (
  pubkey: string,
  _relays: string[] = defaultRelays
) => {
  // A profile is a replaceable (kind 0) — one current value per pubkey, a real
  // terminal state, so a Promise is correct here (unlike growing-set reads).
  return dataLayer.fetchReplaceable(0, pubkey);
};

export async function parseContacts(contactList: Event) {
  if (contactList) {
    return contactList.tags.reduce<Set<string>>((result, [name, value]) => {
      if (name === "p") {
        result.add(value);
      }
      return result;
    }, new Set<string>());
  }
  return new Set<string>();
}

// Growing-set engagement reads (comments / likes / zaps / reposts / edits) are
// NOT one-shot fetches — they're reactive streams. Consumers use useEvents/observe
// (a card re-renders as reactions arrive) instead of awaiting a snapshot.

export function openProfileTab(
  npub: `npub1${string}`,
  navigate?: (path: string) => void
) {
  if (navigate) {
    // Use internal routing
    navigate(`/profile/${npub}`);
  } else {
    // Fallback to external njump.me
    let url = `https://njump.me/${npub}`;
    window?.open(url, "_blank")?.focus();
  }
}

export const getATagFromEvent = (event: Event) => {
  let d_tag = event.tags.find((tag) => tag[0] === "d")?.[1];
  let a_tag = d_tag
    ? `${event.kind}:${event.pubkey}:${d_tag}`
    : `${event.kind}:${event.pubkey}:`;
  return a_tag;
};

export const signEvent = async (event: EventTemplate, secret?: string) => {
  const tagged = withClientTag(event);
  let signedEvent;
  let secretKey;
  if (secret) {
    secretKey = hexToBytes(secret);
    signedEvent = finalizeEvent(tagged, secretKey);
    return signedEvent;
  }
  const signer = await signerManager.getSigner();
  if (!signer) {
    throw Error("Login Method Not Provided");
  }
  signedEvent = await signer.signEvent(tagged);
  return signedEvent;
};

export class MiningTracker {
  public cancelled: boolean;
  public maxDifficultySoFar: number;
  public hashesComputed: number;
  constructor() {
    this.cancelled = false;
    this.maxDifficultySoFar = 0;
    this.hashesComputed = 0;
  }

  cancel() {
    this.cancelled = true;
  }
}
