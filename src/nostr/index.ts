import { Event, EventTemplate, Filter, finalizeEvent, SimplePool } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";
import { dataLayer } from "../dataLayer/client";
import { signerManager } from "../singletons/Signer/SignerManager";
import { withClientTag } from "../services/clientTagSettings";

export const defaultRelays = [
  "wss://relay.damus.io/",
  "wss://relay.primal.net/",
  "wss://nos.lol",
  "wss://relay.nostr.wirednet.jp/",
  "wss://nostr-01.yakihonne.com",
  "wss://nostr21.com",
  // relay.snort.social removed — frequently drops connections causing console spam
  // relay.nostr.band removed — confirmed dead
];

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

export const fetchUserProfile = async (
  pubkey: string,
  _relays: string[] = defaultRelays
) => {
  // Outbox routing now lives in the worker; just ask for the profile.
  const profiles = await dataLayer.observeOnce([{ kinds: [0], authors: [pubkey] }]);
  return profiles[0] ?? null;
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

export const fetchUserProfiles = async (
  pubkeys: string[],
  _pool: SimplePool,
  relays: string[] = defaultRelays
) => {
  let result = await dataLayer.observeOnce([{
    kinds: [0],
    authors: pubkeys,
  }]);
  return result;
};

export const fetchReposts = async (
  ids: string[],
  pool: SimplePool,
  relays: string[]
): Promise<Event[]> => {
  const filters: Filter = {
    kinds: [6, 16],
    "#e": ids,
  }

  try {
    const events = await dataLayer.observeOnce([filters]);
    return events;
  } catch (err) {
    console.error("Error fetching reposts", err);
    return [];
  }
};

export const fetchEdits = async (
  eventIds: string[],
  _pool: SimplePool,
  relays: string[] = defaultRelays
) => {
  const result = await dataLayer.observeOnce([{
    kinds: [1010],
    "#e": eventIds,
  }]);
  return result;
};

export const fetchComments = async (
  eventIds: string[],
  _pool: SimplePool,
  relays: string[] = defaultRelays
) => {
  const [kind1, kind1111e, kind1111E] = await Promise.all([
    dataLayer.observeOnce([{ kinds: [1], "#e": eventIds }]),
    dataLayer.observeOnce([{ kinds: [1111], "#e": eventIds } as any]),
    dataLayer.observeOnce([{ kinds: [1111], "#E": eventIds } as any]),
  ]);
  return [...kind1, ...kind1111e, ...kind1111E];
};

export const fetchLikes = async (
  eventIds: string[],
  _pool: SimplePool,
  relays: string[] = defaultRelays
) => {
  let result = await dataLayer.observeOnce([{
    kinds: [7],
    "#e": eventIds,
  }]);
  return result;
};

export const fetchZaps = async (
  eventIds: string[],
  _pool: SimplePool,
  relays: string[] = defaultRelays
) => {
  let result = await dataLayer.observeOnce([{
    kinds: [9735],
    "#e": eventIds,
  }]);
  return result;
};

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
