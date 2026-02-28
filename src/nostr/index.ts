import { Event, EventTemplate, Filter, finalizeEvent, SimplePool } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { nostrRuntime } from "../singletons";
import { signerManager } from "../singletons/Signer/SignerManager";

export const defaultRelays = [
  "wss://relay.damus.io/",
  "wss://relay.primal.net/",
  "wss://nos.lol",
  "wss://relay.nostr.wirednet.jp/",
  "wss://nostr-01.yakihonne.com",
  "wss://relay.snort.social",
  "wss://relay.nostr.band",
  "wss://nostr21.com",
];

// Relays that support NIP-50 free-text search (mirrors Snort's SearchRelays config)
export const searchRelays = [
  "wss://search.nos.today/",
  "wss://relay.noswhere.com/",
  "wss://nostr-relay.app",
];

// Profile-specific search relays — broader coverage for kind 0
// Primal has one of the largest profile indexes on the network
export const profileSearchRelays = [
  "wss://relay.primal.net",
  "wss://search.nos.today/",
  "wss://relay.noswhere.com/",
];

export const fetchUserProfile = async (
  pubkey: string,
  relays: string[] = defaultRelays
) => {
  let result = await nostrRuntime.fetchOne(relays, { kinds: [0], authors: [pubkey] });
  return result;
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

export const fetchComments = async (
  eventIds: string[],
  _pool: SimplePool,
  relays: string[] = defaultRelays
) => {
  let result = await nostrRuntime.querySync(relays, {
    kinds: [1],
    "#e": eventIds,
  });
  return result;
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
  let signedEvent;
  let secretKey;
  if (secret) {
    secretKey = hexToBytes(secret);
    signedEvent = finalizeEvent(event, secretKey);
    return signedEvent;
  }
  const signer = await signerManager.getSigner();
  if (!signer) {
    throw Error("Login Method Not Provided");
  }
  signedEvent = await signer.signEvent(event);
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
