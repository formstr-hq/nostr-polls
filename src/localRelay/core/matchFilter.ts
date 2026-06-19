/**
 * NIP-01 filter matching + filter utilities. Pure, platform-free.
 *
 * Ported from src/nostrRuntime/utils/filterUtils.ts. `matchFilter` implements
 * NIP-01 semantics: within a field the values are OR'd; across fields (and
 * across distinct #tag keys) they are AND'd. `limit` is NOT applied here — it is
 * a result-set concern handled by the query layer.
 */
import type { Event, Filter } from "nostr-tools";

export function matchFilter(event: Event, filter: Filter): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;

  // Tag filters: #e, #p, #t, … — each distinct key must be satisfied (AND),
  // any one of its values matching is enough (OR).
  for (const [key, value] of Object.entries(filter)) {
    if (!key.startsWith("#")) continue;
    const tagName = key.slice(1);
    const wanted = value as string[];
    const present = event.tags
      .filter((tag) => tag[0] === tagName)
      .map((tag) => tag[1]);
    if (!wanted.some((v) => present.includes(v))) return false;
  }

  return true;
}

/** True if the event matches ANY of the filters (the NIP-01 REQ semantics). */
export function matchAnyFilter(event: Event, filters: Filter[]): boolean {
  return filters.some((f) => matchFilter(event, f));
}

/** Tag index keys for an event, e.g. "e:<id>", "p:<pubkey>", "t:<topic>". */
export function extractTagKeys(event: Event): string[] {
  const keys: string[] = [];
  for (const tag of event.tags || []) {
    if (tag.length >= 2) keys.push(`${tag[0]}:${tag[1]}`);
  }
  return keys;
}

/** Stable, order-insensitive hash of filters + relays for subscription dedup. */
export function generateFilterHash(filters: Filter[], relays: string[]): string {
  const normalized = filters.map(normalizeFilter);
  const sortedRelays = [...relays].sort();
  return simpleHash(JSON.stringify({ filters: normalized, relays: sortedRelays }));
}

export function normalizeFilter(filter: Filter): Filter {
  const out: any = {};
  for (const key of Object.keys(filter).sort()) {
    const value = (filter as any)[key];
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? [...value].sort() : value;
  }
  return out;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash; // force 32-bit
  }
  return hash.toString(36);
}

/** Split a filter whose author list exceeds `chunkSize` into smaller filters. */
export function chunkFilter(filter: Filter, chunkSize = 1000): Filter[] {
  if (!filter.authors || filter.authors.length <= chunkSize) return [filter];
  const chunks: Filter[] = [];
  for (let i = 0; i < filter.authors.length; i += chunkSize) {
    chunks.push({ ...filter, authors: filter.authors.slice(i, i + chunkSize) });
  }
  return chunks;
}
