import { Event } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { collectOnce } from "../dataLayer/collect";
import { signEvent } from "./index";

// ── NIP-65: Relay List Metadata ────────────────────────────────────────────────
// A replaceable kind 10002 event with tags:
//   ["r", "<relay-url>"]              → read + write
//   ["r", "<relay-url>", "read"]      → read only
//   ["r", "<relay-url>", "write"]     → write only

export const RELAY_LIST_EVENT_KIND = 10002;

export type RelayListEntry = {
  url: string;
  read: boolean;
  write: boolean;
};

/** Normalize a relay URL: trim, default to wss://, strip trailing slashes. */
export function normalizeRelayUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";
  if (!/^(wss?|ws):\/\//i.test(url)) {
    url = `wss://${url}`;
  }
  return url.replace(/\/+$/, "");
}

/** Parse the `r` tags of a kind 10002 event into relay entries. */
export function parseRelayListEvent(event: Event): RelayListEntry[] {
  const entries: RelayListEntry[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== "r" || typeof tag[1] !== "string" || !tag[1]) continue;
    const url = normalizeRelayUrl(tag[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const marker = tag[2];
    entries.push({
      url,
      read: marker !== "write",
      write: marker !== "read",
    });
  }
  return entries;
}

/** Build the `r` tags for a kind 10002 event from relay entries. */
export function buildRelayListTags(entries: RelayListEntry[]): string[][] {
  return entries
    .filter((e) => e.url)
    .map((e) => {
      if (e.read && e.write) return ["r", e.url];
      return ["r", e.url, e.write ? "write" : "read"];
    });
}

/**
 * Read a pubkey's kind 10002 from the local store (cache-only, instant).
 */
export async function fetchRelayListCached(
  pubkey: string
): Promise<Event | null> {
  try {
    return await dataLayer.fetchReplaceable(RELAY_LIST_EVENT_KIND, pubkey);
  } catch {
    return null;
  }
}

/**
 * Fetch a pubkey's kind 10002 over the network (one-shot snapshot via
 * collectOnce — the worker decides how to reach the author's relays).
 */
export async function fetchRelayListFresh(
  pubkey: string
): Promise<Event | null> {
  try {
    const [event] = await collectOnce(
      [{ kinds: [RELAY_LIST_EVENT_KIND], authors: [pubkey], limit: 1 }],
      { timeoutMs: 5000, quietMs: 700 }
    );
    return event || null;
  } catch {
    return null;
  }
}

/**
 * Publish a replaceable kind 10002 relay list for the current user.
 * Returns the signed event so callers can seed caches.
 */
export async function publishRelayList(
  entries: RelayListEntry[]
): Promise<Event> {
  const template = {
    kind: RELAY_LIST_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: buildRelayListTags(entries),
    content: "",
  };
  const signed = await signEvent(template);
  await dataLayer.publishEvent(signed);
  return signed;
}