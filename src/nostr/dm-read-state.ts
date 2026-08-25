/**
 * DM read-state (lastSeen per conversation + mark-all watermark) backed by
 * a signed kind-30078 private replaceable event (NIP-44-encrypted to self).
 *
 * Why: a per-conversation watermark used to live in plaintext localStorage
 * under `dm_lastseen_*` and a global watermark under `dm_markall_<pubkey>`.
 * Both were unbounded (one key per conversation the user ever opened) and
 * were a chunk of what pushed the app over the ~5MB quota ceiling. The
 * signed replaceable event gives:
 *   - cross-device sync (open a conversation on another device -> it's read)
 *   - bounded storage (one event, size O(conversations open this session))
 *   - no localStorage growth
 *
 * A per-tab in-memory mirror (this module's `memory` Map) is the synchronous
 * source of truth for reads in this session, so the read path stays cheap
 * and doesn't block on worker hydration.
 */
import { dataLayer } from "@formstr/local-relay";
import { Event, EventTemplate } from "nostr-tools";
import { signerManager } from "../singletons/Signer/SignerManager";

export const DM_READ_STATE_KIND = 30078;
const D_TAG = "dm-read-state";

type ReadState = {
  /** conversationId (sorted pubkeys joined with +) -> last-seen ms */
  lastSeen: Record<string, number>;
  /** account-wide "mark all read" watermark, ms. 0 = unset. */
  markAllTs?: number;
};

const EMPTY: ReadState = { lastSeen: {} };

// Pubkey -> latest in-process view. Read hot path is pure Map lookup.
const memory = new Map<string, ReadState>();

// Legacy plaintext keys this feature used to write; purged lazily post-migration.
const LEGACY_LAST_SEEN_PREFIX = "dm_lastseen_";
const LEGACY_MARK_ALL_PREFIX = "dm_markall_";

type PublishState = {
  state: ReadState;
  dirty: boolean;
  timer: number | null;
  inflight: Promise<void> | null;
};
const publish = new Map<string, PublishState>();

const DEBOUNCE_MS = 250;
const MAX_CONVERSATIONS = 500;

export function getReadState(pubkey: string): ReadState {
  return memory.get(pubkey) ?? EMPTY;
}

/** All timestamps are in Nostr "created_at" seconds (unix). */

export function getLastSeen(
  pubkey: string,
  conversationId: string
): number {
  const s = getReadState(pubkey);
  const own = s.lastSeen[conversationId] ?? 0;
  const all = s.markAllTs ?? 0;
  return Math.max(own, all);
}

export function setLastSeen(
  pubkey: string,
  conversationId: string,
  timestampSec: number
): void {
  const s = clone(getReadState(pubkey));
  const ts = Math.max(0, Math.floor(timestampSec));
  const prev = s.lastSeen[conversationId] ?? 0;
  if (ts <= prev && s.markAllTs === undefined) {
    // No change worth persisting
    return;
  }
  s.lastSeen[conversationId] = ts;
  if (Object.keys(s.lastSeen).length > MAX_CONVERSATIONS) {
    // Drop the smallest entries; the largest is what a user actually cares
    // about, and a full watermark usually covers the rest.
    const entries = Object.entries(s.lastSeen).sort((a, b) => a[1] - b[1]);
    const drop = entries.length - MAX_CONVERSATIONS;
    for (let i = 0; i < drop; i++) delete s.lastSeen[entries[i][0]];
  }
  memory.set(pubkey, s);
  schedulePublish(pubkey, s);
}

export function setMarkAllTs(pubkey: string, timestampSec: number): void {
  const s = clone(getReadState(pubkey));
  s.markAllTs = Math.max(0, Math.floor(timestampSec));
  memory.set(pubkey, s);
  schedulePublish(pubkey, s);
}

function clone(s: ReadState): ReadState {
  return { lastSeen: { ...s.lastSeen }, markAllTs: s.markAllTs };
}

function schedulePublish(pubkey: string, state: ReadState): void {
  let slot = publish.get(pubkey);
  if (!slot) {
    slot = { state, dirty: true, timer: null, inflight: null };
    publish.set(pubkey, slot);
  }
  slot.state = state;
  slot.dirty = true;
  if (slot.timer !== null) window.clearTimeout(slot.timer);
  slot.timer = window.setTimeout(() => {
    slot.timer = null;
    flushPublish(pubkey, slot).catch(() => {
      // Retry once after a short backoff so a transient worker hiccup
      // (hydration race) doesn't lose a user's "mark as read".
      slot.timer = window.setTimeout(() => {
        slot.timer = null;
        slot.dirty = false;
      }, 500);
    });
  }, DEBOUNCE_MS);
}

async function flushPublish(
  pubkey: string,
  slot: PublishState
): Promise<void> {
  if (slot.inflight) {
    await slot.inflight.catch(() => undefined);
    if (!slot.dirty) return;
  }
  const promise = (async () => {
    const signer = await signerManager.getSigner();
    const cipher = await signer.nip44Encrypt!(
      pubkey,
      JSON.stringify(slot.state)
    );
    const template: EventTemplate = {
      kind: DM_READ_STATE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", D_TAG]],
      content: cipher,
    };
    const signed = await signer.signEvent(template);
    await dataLayer.publishEvent(signed);
  })();
  slot.inflight = promise;
  try {
    await promise;
    slot.dirty = false;
  } finally {
    slot.inflight = null;
  }
}

/**
 * Hydrate in-memory state from the local worker's store (or remote fallback
 * the worker manages). Also performs a one-time migration off legacy
 * localStorage read-state keys on first call per pubkey in this tab.
 */
export async function loadReadState(pubkey: string): Promise<ReadState> {
  const merged = { lastSeen: {} as Record<string, number>, markAllTs: 0 };

  // 1. Legacy keys — read then drop so the quota ceiling stops leaking.
  try {
    const markAllRaw = localStorage.getItem(LEGACY_MARK_ALL_PREFIX + pubkey);
    if (markAllRaw) {
      merged.markAllTs = parseInt(markAllRaw, 10) || 0;
      localStorage.removeItem(LEGACY_MARK_ALL_PREFIX + pubkey);
    }
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LEGACY_LAST_SEEN_PREFIX)) continue;
      const conversationId = key.slice(LEGACY_LAST_SEEN_PREFIX.length);
      const ts = parseInt(localStorage.getItem(key) || "0", 10);
      if (ts > (merged.lastSeen[conversationId] ?? 0)) {
        merged.lastSeen[conversationId] = ts;
      }
      toRemove.push(key);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore storage hiccups
  }

  // 2. On-chain event — wins over legacy where they overlap.
  try {
    const event: Event | null = await dataLayer.fetchReplaceable(
      DM_READ_STATE_KIND,
      pubkey
    );
    if (event) {
      const signer = await signerManager.getSigner();
      const cipher = event.content;
      if (cipher) {
        const plain = await signer.nip44Decrypt!(pubkey, cipher);
        const parsed = JSON.parse(plain) as ReadState;
        if (parsed && typeof parsed === "object") {
          for (const [cid, ts] of Object.entries(parsed.lastSeen ?? {})) {
            if (typeof ts === "number" && ts > (merged.lastSeen[cid] ?? 0)) {
              merged.lastSeen[cid] = ts;
            }
          }
          if (typeof parsed.markAllTs === "number") {
            merged.markAllTs = Math.max(merged.markAllTs, parsed.markAllTs);
          }
        }
      }
    }
  } catch {
    // Worker still hydrating / signer locked — the legacy merge above is the
    // best we can do; the next mutation republishes and wins forward.
  }

  // 3. Prefer any in-memory state already set this session (e.g. a recent
  //    local markAsRead that outran the fetch) by taking component-wise max.
  const existing = memory.get(pubkey);
  if (existing) {
    for (const [cid, ts] of Object.entries(existing.lastSeen ?? {})) {
      merged.lastSeen[cid] = Math.max(merged.lastSeen[cid] ?? 0, ts);
    }
    merged.markAllTs = Math.max(
      merged.markAllTs,
      existing.markAllTs ?? 0
    );
  }

  const final: ReadState = {
    lastSeen: merged.lastSeen,
    markAllTs: merged.markAllTs || undefined,
  };
  memory.set(pubkey, final);
  return final;
}

export function clearReadState(pubkey: string): void {
  memory.delete(pubkey);
  const slot = publish.get(pubkey);
  if (slot) {
    if (slot.timer !== null) window.clearTimeout(slot.timer);
    publish.delete(pubkey);
  }
}
