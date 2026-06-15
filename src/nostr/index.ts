import { Event, EventTemplate, Filter, finalizeEvent, SimplePool } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";
import { nostrRuntime } from "../singletons";
import { signerManager } from "../singletons/Signer/SignerManager";
import { getCachedOutboxRelays, getOutboxRelays } from "./OutboxService";
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
  relays: string[] = defaultRelays
) => {
  // Use cached outbox relays if available (no extra round-trip on cache hit)
  const cachedOutbox = getCachedOutboxRelays(pubkey);
  const fetchRelays = cachedOutbox.length > 0
    ? Array.from(new Set([...cachedOutbox, ...relays]))
    : relays;

  // Trigger background fetch of outbox relays so future calls benefit
  if (cachedOutbox.length === 0) {
    getOutboxRelays(pubkey); // fire-and-forget
  }

  return nostrRuntime.fetchOne(fetchRelays, { kinds: [0], authors: [pubkey] });
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
  let result = await nostrRuntime.querySync(relays, {
    kinds: [0],
    authors: pubkeys,
  });
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
    const events = await nostrRuntime.querySync(relays, filters);
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
  const result = await nostrRuntime.querySync(relays, {
    kinds: [1010],
    "#e": eventIds,
  });
  return result;
};

export const fetchComments = async (
  eventIds: string[],
  _pool: SimplePool,
  relays: string[] = defaultRelays
) => {
  const [kind1, kind1111e, kind1111E] = await Promise.all([
    nostrRuntime.querySync(relays, { kinds: [1], "#e": eventIds }),
    nostrRuntime.querySync(relays, { kinds: [1111], "#e": eventIds } as any),
    nostrRuntime.querySync(relays, { kinds: [1111], "#E": eventIds } as any),
  ]);
  return [...kind1, ...kind1111e, ...kind1111E];
};

export const fetchLikes = async (
  eventIds: string[],
  _pool: SimplePool,
  relays: string[] = defaultRelays
) => {
  let result = await nostrRuntime.querySync(relays, {
    kinds: [7],
    "#e": eventIds,
  });
  return result;
};

export const fetchZaps = async (
  eventIds: string[],
  _pool: SimplePool,
  relays: string[] = defaultRelays
) => {
  let result = await nostrRuntime.querySync(relays, {
    kinds: [9735],
    "#e": eventIds,
  });
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
