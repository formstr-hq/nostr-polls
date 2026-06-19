/**
 * EventDB — in-memory, multi-indexed event store with synchronous queries and a
 * change emitter for live subscription fan-out. Pure and platform-free: this is
 * the storage engine of the local relay and runs identically in a Worker or in
 * Node (tests).
 *
 * Ported from src/nostrRuntime/EventStore.ts with three changes:
 *  - a single `onChange` emitter (RelayCore does live-sub matching) instead of
 *    per-filter listeners baked into the store;
 *  - a policy-driven `prune` (per-kind TTL classes + hard cap) per design §7;
 *  - `allEvents`/`bulkLoad` for persistence hydration.
 */
import type { Event, Filter } from "nostr-tools";
import {
  DBStats,
  PrunePolicy,
  StoreChange,
  StoreListener,
  defaultPrunePolicy,
} from "./types";
import { matchFilter, extractTagKeys } from "./matchFilter";
import {
  getReplaceableKey,
  isEphemeralEvent,
  isExpired,
  isReplaceableEvent,
  isValidEventStructure,
  shouldReplaceEvent,
} from "./eventValidation";

export class EventDB {
  private byId = new Map<string, Event>();
  private byKind = new Map<number, Set<string>>();
  private byAuthor = new Map<string, Set<string>>();
  private byTag = new Map<string, Set<string>>();

  // Replaceable tracking: replaceable key -> winning event id.
  private replaceableKeys = new Map<string, string>();

  // NIP-09 deletion tracking.
  private deletedIds = new Map<string, string>(); // target id -> deleter pubkey
  private processedDeletions = new Set<string>();

  private listeners = new Set<StoreListener>();

  /** Injectable clock so tests can control expiration/TTL deterministically. */
  constructor(private now: () => number = () => Math.floor(Date.now() / 1000)) {}

  // --- mutation ---

  /** Add an event. Returns true if it changed the store. */
  add(event: Event): boolean {
    if (!isValidEventStructure(event)) return false;

    // NIP-09 deletion: process, don't store.
    if (event.kind === 5) {
      if (this.processedDeletions.has(event.id)) return false;
      this.processedDeletions.add(event.id);
      for (const tag of event.tags) {
        if (tag[0] === "e" && tag[1]) {
          this.deletedIds.set(tag[1], event.pubkey);
          const target = this.byId.get(tag[1]);
          // Only the author may delete their own event.
          if (target && target.pubkey === event.pubkey) this.remove(tag[1]);
        }
      }
      return true;
    }

    // Reject events already deleted by their own author.
    const deleter = this.deletedIds.get(event.id);
    if (deleter && deleter === event.pubkey) return false;

    // Ephemeral: never stored (RelayCore still fans it out to live subs).
    if (isEphemeralEvent(event.kind)) return false;

    // Replaceable: keep only the winner.
    if (isReplaceableEvent(event.kind)) {
      const key = getReplaceableKey(event);
      const existingId = this.replaceableKeys.get(key);
      if (existingId) {
        const existing = this.byId.get(existingId);
        if (existing && !shouldReplaceEvent(event, existing)) return false;
        if (existing) this.remove(existingId);
      }
      this.replaceableKeys.set(key, event.id);
    }

    if (this.byId.has(event.id)) return false;

    this.byId.set(event.id, event);
    index(this.byKind, event.kind, event.id);
    index(this.byAuthor, event.pubkey, event.id);
    for (const key of extractTagKeys(event)) index(this.byTag, key, event.id);

    this.emit({ type: "add", event });
    return true;
  }

  private remove(id: string): void {
    const event = this.byId.get(id);
    if (!event) return;
    this.byId.delete(id);
    this.byKind.get(event.kind)?.delete(id);
    this.byAuthor.get(event.pubkey)?.delete(id);
    for (const key of extractTagKeys(event)) this.byTag.get(key)?.delete(id);
    this.emit({ type: "remove", id });
  }

  // --- query ---

  /** Synchronous query. Returns matches newest-first, honouring `limit`. */
  query(filter: Filter): Event[] {
    const candidates = this.candidates(filter);
    const now = this.now();
    const out: Event[] = [];
    for (const id of Array.from(candidates)) {
      const event = this.byId.get(id);
      if (!event) continue;
      if (!matchFilter(event, filter)) continue;
      const deleter = this.deletedIds.get(id);
      if (deleter && deleter === event.pubkey) continue;
      if (isExpired(event, now)) continue;
      out.push(event);
    }
    out.sort((a, b) => b.created_at - a.created_at);
    return filter.limit && filter.limit > 0 ? out.slice(0, filter.limit) : out;
  }

  /** Pick the most selective index available for the filter. */
  private candidates(filter: Filter): Iterable<string> {
    if (filter.ids?.length) return filter.ids;
    if (filter.authors?.length) return union(this.byAuthor, filter.authors);
    if (filter.kinds?.length) return union(this.byKind, filter.kinds);
    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith("#")) {
        const tagName = key.slice(1);
        return union(
          this.byTag,
          (value as string[]).map((v) => `${tagName}:${v}`)
        );
      }
    }
    return this.byId.keys();
  }

  getById(id: string): Event | undefined {
    const event = this.byId.get(id);
    if (!event) return undefined;
    const deleter = this.deletedIds.get(id);
    if (deleter && deleter === event.pubkey) return undefined;
    if (isExpired(event, this.now())) return undefined;
    return event;
  }

  isDeleted(id: string): boolean {
    return this.deletedIds.has(id);
  }

  // --- change emitter (RelayCore subscribes once for live fan-out) ---

  onChange(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: StoreChange): void {
    for (const l of Array.from(this.listeners)) l(change);
  }

  // --- persistence helpers ---

  /** Snapshot of every stored event (for write-through / export). */
  allEvents(): Event[] {
    return Array.from(this.byId.values());
  }

  /**
   * Bulk-load (boot hydration). Suppresses change emits for the whole batch so
   * hydration doesn't trigger a storm of live-sub fan-out; callers refresh once
   * afterwards. Returns the number of events actually stored.
   */
  bulkLoad(events: Event[]): number {
    const saved = this.listeners;
    this.listeners = new Set();
    let added = 0;
    try {
      for (const event of events) {
        if (this.add(event)) added++;
      }
    } finally {
      this.listeners = saved;
    }
    return added;
  }

  // --- pruning ---

  /**
   * Remove expired/old events and enforce the size cap. Protected kinds are
   * never removed. Returns the number of events pruned.
   */
  prune(policy: PrunePolicy = defaultPrunePolicy()): number {
    const now = this.now();
    const toRemove: string[] = [];

    for (const [id, event] of Array.from(this.byId.entries())) {
      if (policy.protectedKinds.has(event.kind)) continue;
      if (isExpired(event, now)) {
        toRemove.push(id);
        continue;
      }
      const ttl = policy.ttlByKind.get(event.kind) ?? policy.defaultTtlSeconds;
      if (event.created_at < now - ttl) toRemove.push(id);
    }
    for (const id of toRemove) this.remove(id);

    // Hard cap: evict oldest non-protected until under maxEvents.
    if (this.byId.size > policy.maxEvents) {
      const evictable = Array.from(this.byId.values())
        .filter((e) => !policy.protectedKinds.has(e.kind))
        .sort((a, b) => a.created_at - b.created_at);
      let overflow = this.byId.size - policy.maxEvents;
      for (const event of evictable) {
        if (overflow <= 0) break;
        this.remove(event.id);
        toRemove.push(event.id);
        overflow--;
      }
    }

    return toRemove.length;
  }

  // --- misc ---

  stats(): DBStats {
    const eventsByKind: Record<number, number> = {};
    for (const [kind, set] of Array.from(this.byKind.entries())) {
      if (set.size > 0) eventsByKind[kind] = set.size;
    }
    return {
      totalEvents: this.byId.size,
      eventsByKind,
      totalAuthors: this.byAuthor.size,
    };
  }

  clear(): void {
    this.byId.clear();
    this.byKind.clear();
    this.byAuthor.clear();
    this.byTag.clear();
    this.replaceableKeys.clear();
    this.deletedIds.clear();
    this.processedDeletions.clear();
  }
}

function index(map: Map<any, Set<string>>, key: any, id: string): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(id);
}

function union(map: Map<any, Set<string>>, keys: any[]): Set<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const set = map.get(key);
    if (set) for (const id of Array.from(set)) out.add(id);
  }
  return out;
}
