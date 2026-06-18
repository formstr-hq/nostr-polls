/**
 * OutboxService — NIP-65 relay discovery and caching.
 *
 * The gossip/outbox model means:
 *   - Each user publishes events to their WRITE relays (outbox)
 *   - Each user wants to receive mentions on their READ relays (inbox)
 *
 * NIP-65 kind:10002 tag format:
 *   ["r", "wss://relay.url"]          → both read and write
 *   ["r", "wss://relay.url", "write"] → outbox only (user publishes here)
 *   ["r", "wss://relay.url", "read"]  → inbox only (user reads here)
 *
 * Usage:
 *   const writeRelays = await getOutboxRelays(pubkey);   // fetch from
 *   const readRelays  = await getNip65InboxRelays(pubkey); // publish to
 *   const cached      = getCachedOutboxRelays(pubkey);    // sync, no await
 *   cacheNip65Event(event);                              // seed from event
 */

import { Event } from "nostr-tools";
import { defaultRelays } from "./index";
import { nostrRuntime } from "../singletons";

const LS_PREFIX = "nip65_v1_";
const MAX_RELAYS = 5; // cap per-user to avoid excessive connections

interface RelayList {
  write: string[]; // outbox: where the user publishes
  read: string[];  // inbox: where the user wants to receive
  created_at: number;
}

// In-memory session cache (fastest path)
const cache = new Map<string, RelayList>();

function parseNip65(event: Event): RelayList {
  const write: string[] = [];
  const read: string[] = [];

  for (const tag of event.tags) {
    if (tag[0] !== "r" || !tag[1]) continue;
    const url = tag[1];
    const marker = tag[2]; // "read", "write", or undefined (= both)

    if (!marker || marker === "write") write.push(url);
    if (!marker || marker === "read") read.push(url);
  }

  return { write, read, created_at: event.created_at };
}

function readFromStorage(pubkey: string): RelayList | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + pubkey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeToStorage(pubkey: string, data: RelayList): void {
  try {
    localStorage.setItem(LS_PREFIX + pubkey, JSON.stringify(data));
  } catch {
    // localStorage full, ignore
  }
}

async function fetchFromNetwork(
  pubkey: string,
  knownAt: number,
  persist: boolean
): Promise<RelayList | null> {
  try {
    const event = await nostrRuntime.fetchOne(defaultRelays, {
      kinds: [10002],
      authors: [pubkey],
    });

    if (event && event.created_at > knownAt) {
      const relayList = parseNip65(event);
      cache.set(pubkey, relayList);
      if (persist) writeToStorage(pubkey, relayList);
      return relayList;
    }
  } catch (e) {
    console.error("OutboxService: failed to fetch kind:10002 for", pubkey, e);
  }

  return cache.get(pubkey) ?? null;
}

/**
 * Populate the cache from an already-fetched kind:10002 event.
 * Call this when you fetch a user's relay list so future lookups are free.
 *
 * Pass persist=true for the logged-in user(s) so the relay list survives a
 * reload and is available to background consumers (e.g. the Android worker
 * bridge, which reads it back via getNip65InboxRelays).
 */
export function cacheNip65Event(event: Event, persist = false): void {
  const existing = cache.get(event.pubkey);
  // Ignore an older event than what we already have cached.
  if (existing && event.created_at < existing.created_at) return;
  const relayList = parseNip65(event);
  cache.set(event.pubkey, relayList);
  if (persist) writeToStorage(event.pubkey, relayList);
}

/**
 * Synchronous cache-only lookup for a user's write (outbox) relays.
 * Returns empty array if not cached — no network call.
 */
export function getCachedOutboxRelays(pubkey: string): string[] {
  return cache.get(pubkey)?.write.slice(0, MAX_RELAYS) ?? [];
}

/**
 * Get write (outbox) relays for a pubkey.
 * These are where the user publishes their events — fetch from here.
 *
 * persist=true should only be passed for the logged-in user to enable
 * localStorage caching across sessions (stale-while-revalidate).
 */
export async function getOutboxRelays(
  pubkey: string,
  persist = false
): Promise<string[]> {
  // 1. In-memory hit
  if (cache.has(pubkey)) {
    return cache.get(pubkey)!.write.slice(0, MAX_RELAYS);
  }

  // 2. localStorage hit (logged-in user) — serve stale, revalidate in background
  if (persist) {
    const stored = readFromStorage(pubkey);
    if (stored) {
      cache.set(pubkey, stored);
      fetchFromNetwork(pubkey, stored.created_at, persist); // fire-and-forget
      return stored.write.slice(0, MAX_RELAYS);
    }
  }

  // 3. Cold start — await network
  const relayList = await fetchFromNetwork(pubkey, 0, persist);
  return relayList?.write.slice(0, MAX_RELAYS) ?? [];
}

/**
 * Get read (inbox) relays for a pubkey from their NIP-65 kind:10002.
 * These are where the user reads mentions — publish to here when mentioning them.
 *
 * Note: For encrypted DMs (NIP-17), use fetchInboxRelays from nip17.ts (kind:10050)
 * instead, as that is specifically for sealed/gift-wrapped messages.
 */
export async function getNip65InboxRelays(
  pubkey: string,
  persist = false
): Promise<string[]> {
  // 1. In-memory hit
  if (cache.has(pubkey)) {
    return cache.get(pubkey)!.read.slice(0, MAX_RELAYS);
  }

  // 2. localStorage hit (logged-in user)
  if (persist) {
    const stored = readFromStorage(pubkey);
    if (stored) {
      cache.set(pubkey, stored);
      fetchFromNetwork(pubkey, stored.created_at, persist); // fire-and-forget
      return stored.read.slice(0, MAX_RELAYS);
    }
  }

  // 3. Cold start — await network
  const relayList = await fetchFromNetwork(pubkey, 0, persist);
  return relayList?.read.slice(0, MAX_RELAYS) ?? [];
}

export interface GossipRelayEntry {
  url: string;
  pubkeyCount: number; // how many users use this relay
  modes: Set<"read" | "write">;
}

/**
 * Max gossip relays to connect to beyond the user's own relays.
 * Mobile devices handle far fewer concurrent WebSocket connections than desktop.
 * We pick the most popular relays (used by the most follows) to maximise coverage
 * while keeping the connection count manageable.
 */
const MAX_GOSSIP_RELAYS = 20;

/**
 * Return the user's own relays plus the most-popular outbox relays for a set
 * of authors, capped at MAX_GOSSIP_RELAYS extra relays (scored by how many
 * authors publish there). This is what you pass to a subscription when you
 * want to read content from those authors using the gossip model.
 */
export function getRelaysForAuthors(userRelays: string[], authors: string[]): string[] {
  const userRelaySet = new Set(userRelays);

  // Count how many authors publish to each relay
  const score = new Map<string, number>();
  for (const pubkey of authors) {
    for (const url of getCachedOutboxRelays(pubkey)) {
      if (!userRelaySet.has(url)) {
        score.set(url, (score.get(url) ?? 0) + 1);
      }
    }
  }

  // Take the top MAX_GOSSIP_RELAYS by author count
  const topGossip = Array.from(score.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_GOSSIP_RELAYS)
    .map(([url]) => url);

  return [...userRelays, ...topGossip];
}

/**
 * Publish the user's NIP-65 relay list (kind:10002).
 * readRelays  = relays the user reads from (inbox)
 * writeRelays = relays the user writes to (outbox)
 */
export async function publishUserRelays(
  readRelays: string[],
  writeRelays: string[]
): Promise<void> {
  const { signerManager } = await import("../singletons/Signer/SignerManager");
  const { pool } = await import("../singletons");
  const signer = await signerManager.getSigner();
  const tags: string[][] = [];
  // relays that appear in both → no marker (= both read and write)
  const bothSet = readRelays.filter((r) => writeRelays.includes(r));
  const readOnly = readRelays.filter((r) => !writeRelays.includes(r));
  const writeOnly = writeRelays.filter((r) => !readRelays.includes(r));
  for (const r of bothSet) tags.push(["r", r]);
  for (const r of readOnly) tags.push(["r", r, "read"]);
  for (const r of writeOnly) tags.push(["r", r, "write"]);

  const event = {
    kind: 10002,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
  const signed = await signer.signEvent(event);
  // publish to all relays (read + write combined)
  pool.publish(Array.from(new Set([...readRelays, ...writeRelays])), signed);
}

/**
 * Return a deduplicated list of all relays discovered from OTHER users' NIP-65
 * events (i.e. everything in the cache except the logged-in user's own entry).
 * Used by the relay settings UI to show the gossip network.
 */
export function getCachedGossipRelays(ownPubkey?: string): GossipRelayEntry[] {
  const urlMap = new Map<string, GossipRelayEntry>();

  cache.forEach((relayList, pubkey) => {
    if (pubkey === ownPubkey) return; // exclude own relays

    for (const url of relayList.write) {
      if (!urlMap.has(url)) urlMap.set(url, { url, pubkeyCount: 0, modes: new Set() });
      const entry = urlMap.get(url)!;
      entry.pubkeyCount++;
      entry.modes.add("write");
    }
    for (const url of relayList.read) {
      if (!urlMap.has(url)) urlMap.set(url, { url, pubkeyCount: 0, modes: new Set() });
      const entry = urlMap.get(url)!;
      // only increment pubkeyCount once per user per relay
      if (!relayList.write.includes(url)) entry.pubkeyCount++;
      entry.modes.add("read");
    }
  });

  return Array.from(urlMap.values()).sort((a, b) => b.pubkeyCount - a.pubkeyCount);
}

/**
 * Prefetch and cache NIP-65 relay lists for multiple pubkeys in one batch.
 * Skips pubkeys already cached. Useful when loading a feed of events.
 */
export async function prefetchOutboxRelays(pubkeys: string[]): Promise<void> {
  const uncached = pubkeys.filter((pk) => !cache.has(pk));
  if (uncached.length === 0) return;

  try {
    const events = await nostrRuntime.querySync(defaultRelays, {
      kinds: [10002],
      authors: uncached,
    });

    for (const event of events) {
      cacheNip65Event(event);
    }
  } catch (e) {
    console.error("OutboxService: batch prefetch failed", e);
  }
}
