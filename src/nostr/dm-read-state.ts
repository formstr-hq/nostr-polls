/**
 * DM read-state (lastSeen per conversation + mark-all watermark) backed by
 * a signed kind-30078 private replaceable event (NIP-44-encrypted to self).
 *
 * Why: a per-conversation watermark used to live in plaintext localStorage
 * under `dm_lastseen_*` and a global watermark under `dm_markall_<pubkey>`.
 * Both were unbounded and were a chunk of what pushed the app over the ~5MB
 * quota ceiling. The signed replaceable event gives cross-device sync and
 * bounded storage.
 *
 * A per-tab in-memory mirror (this module's `memory` Map) is the synchronous
 * source of truth for reads in this session, so the read path stays cheap.
 *
 * Safety rules (this is private, cross-device state — losing it resurfaces
 * months-old messages as "new"):
 *  - Reads are scoped by the `d` tag. Kind 30078 is NIP-78 generic app data
 *    shared with every other client, so (kind, pubkey) alone can return
 *    another app's event.
 *  - Watermarks only move forward: before every publish we re-read the
 *    latest remote state and take the component-wise max, so a stale tab or
 *    device can never overwrite a newer one with a subset.
 *  - Nothing is published until the remote state has been read successfully
 *    (found, or confirmed absent). A decrypt/signer failure leaves the
 *    remote event untouched.
 *  - Legacy localStorage keys are only deleted after a publish that carries
 *    their values has succeeded.
 *  - A failed publish stays dirty and is retried with backoff (bounded, so an
 *    external signer that keeps rejecting isn't re-prompted forever).
 */
import { dataLayer } from "@formstr/local-relay";
import { Event, EventTemplate } from "nostr-tools";
import { signerManager } from "../singletons/Signer/SignerManager";
import { collectOnce } from "../dataLayer/collect";

export const DM_READ_STATE_KIND = 30078;
export const DM_READ_STATE_D_TAG = "dm-read-state";

type ReadState = {
  /** conversationId (sorted pubkeys joined with +) -> last-seen, unix seconds */
  lastSeen: Record<string, number>;
  /** account-wide "mark all read" watermark, unix seconds. 0/undefined = unset. */
  markAllTs?: number;
};

export type LoadStatus = "found" | "not-found" | "failed";

const EMPTY: ReadState = { lastSeen: {} };

// Pubkey -> latest in-process view. Read hot path is pure Map lookup.
const memory = new Map<string, ReadState>();

// Legacy plaintext keys this feature used to write.
const LEGACY_LAST_SEEN_PREFIX = "dm_lastseen_";
const LEGACY_MARK_ALL_PREFIX = "dm_markall_";

type Slot = {
  /** Remote state has been read (found or confirmed absent) — publishing is safe. */
  loaded: boolean;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  inflight: Promise<void> | null;
  /** Consecutive failed publish attempts since the last success/mutation. */
  failures: number;
  /** Legacy localStorage keys to drop once a publish carrying them succeeds. */
  legacyKeys: string[];
};
const slots = new Map<string, Slot>();

const DEBOUNCE_MS = 250;
const RETRY_DELAYS_MS = [2000, 8000, 30000];
const MAX_CONVERSATIONS = 500;

function slotFor(pubkey: string): Slot {
  let slot = slots.get(pubkey);
  if (!slot) {
    slot = {
      loaded: false,
      dirty: false,
      timer: null,
      inflight: null,
      failures: 0,
      legacyKeys: [],
    };
    slots.set(pubkey, slot);
  }
  return slot;
}

/** Accept seconds; tolerate an accidental ms value. */
function toSeconds(ts: unknown): number {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return 0;
  return Math.floor(ts > 1e12 ? ts / 1000 : ts);
}

function clone(s: ReadState): ReadState {
  return { lastSeen: { ...s.lastSeen }, markAllTs: s.markAllTs };
}

/** Component-wise max of two states. Never lowers a watermark. */
function mergeStates(a: ReadState, b: ReadState): ReadState {
  const lastSeen: Record<string, number> = { ...a.lastSeen };
  for (const [cid, ts] of Object.entries(b.lastSeen)) {
    lastSeen[cid] = Math.max(lastSeen[cid] ?? 0, ts);
  }
  const markAllTs = Math.max(a.markAllTs ?? 0, b.markAllTs ?? 0);
  return capConversations({ lastSeen, markAllTs: markAllTs || undefined });
}

function capConversations(s: ReadState): ReadState {
  const entries = Object.entries(s.lastSeen);
  if (entries.length <= MAX_CONVERSATIONS) return s;
  // Keep the most recent; a mark-all watermark usually covers the rest.
  entries.sort((a, b) => b[1] - a[1]);
  return {
    lastSeen: Object.fromEntries(entries.slice(0, MAX_CONVERSATIONS)),
    markAllTs: s.markAllTs,
  };
}

function sanitize(raw: unknown): ReadState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { lastSeen?: unknown; markAllTs?: unknown };
  const lastSeen: Record<string, number> = {};
  if (r.lastSeen && typeof r.lastSeen === "object") {
    for (const [cid, ts] of Object.entries(r.lastSeen as Record<string, unknown>)) {
      const s = toSeconds(ts);
      if (s > 0) lastSeen[cid] = s;
    }
  }
  const markAllTs = toSeconds(r.markAllTs);
  return { lastSeen, markAllTs: markAllTs || undefined };
}

export function getReadState(pubkey: string): ReadState {
  return memory.get(pubkey) ?? EMPTY;
}

/** All timestamps are in Nostr "created_at" seconds (unix). */
export function getLastSeen(pubkey: string, conversationId: string): number {
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
  const ts = toSeconds(timestampSec);
  const current = getReadState(pubkey);
  if (ts <= (current.lastSeen[conversationId] ?? 0)) return;
  const s = clone(current);
  s.lastSeen[conversationId] = ts;
  memory.set(pubkey, capConversations(s));
  markDirty(pubkey);
}

export function setMarkAllTs(pubkey: string, timestampSec: number): void {
  const ts = toSeconds(timestampSec);
  const current = getReadState(pubkey);
  if (ts <= (current.markAllTs ?? 0)) return;
  const s = clone(current);
  s.markAllTs = ts;
  memory.set(pubkey, s);
  markDirty(pubkey);
}

function markDirty(pubkey: string): void {
  const slot = slotFor(pubkey);
  slot.dirty = true;
  // A fresh user action earns a fresh retry budget.
  slot.failures = 0;
  schedule(pubkey, DEBOUNCE_MS);
}

function schedule(pubkey: string, delayMs: number): void {
  const slot = slotFor(pubkey);
  // Until the remote state is known, keep mutations in memory only —
  // publishing now could replace a richer remote event with a subset.
  if (!slot.loaded) return;
  if (slot.timer !== null) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => {
    slot.timer = null;
    void runFlush(pubkey);
  }, delayMs);
}

async function runFlush(pubkey: string): Promise<void> {
  const slot = slots.get(pubkey);
  if (!slot) return;
  try {
    await flushPublish(pubkey, slot);
    slot.failures = 0;
  } catch {
    slot.dirty = true;
    const delay = RETRY_DELAYS_MS[slot.failures];
    slot.failures++;
    // Budget exhausted: stay dirty in memory; the next mutation (or the
    // next load) restarts the cycle. Avoids looping signer prompts.
    if (delay !== undefined && slots.get(pubkey) === slot) {
      schedule(pubkey, delay);
    }
  }
}

/**
 * Read our own read-state event (d-scoped). Cache first, then network.
 * `failed` means we could not tell what's there (decrypt/signer error) —
 * callers must not publish over it.
 */
async function fetchRemote(
  pubkey: string
): Promise<{ status: LoadStatus; state?: ReadState }> {
  const filters = [
    {
      kinds: [DM_READ_STATE_KIND],
      authors: [pubkey],
      "#d": [DM_READ_STATE_D_TAG],
    },
  ];
  let events: Event[];
  try {
    const local = await collectOnce(filters, { localOnly: true });
    const net = await collectOnce(filters, { localOnly: false });
    events = [...local, ...net];
  } catch {
    return { status: "failed" };
  }
  // Defensive: re-check scoping in case a relay ignores the tag filter.
  const ours = events.filter(
    (e) =>
      e.kind === DM_READ_STATE_KIND &&
      e.pubkey === pubkey &&
      e.tags.some((t) => t[0] === "d" && t[1] === DM_READ_STATE_D_TAG)
  );
  if (ours.length === 0) return { status: "not-found" };
  ours.sort((a, b) => b.created_at - a.created_at);
  const latest = ours[0];
  if (!latest.content) return { status: "found", state: { lastSeen: {} } };

  let plain: string;
  try {
    const signer = await signerManager.getSigner();
    if (!signer.nip44Decrypt) return { status: "failed" };
    plain = await signer.nip44Decrypt(pubkey, latest.content);
  } catch {
    // Signer locked / rejected / unavailable — transient, don't overwrite.
    return { status: "failed" };
  }
  let parsed: ReadState | null = null;
  try {
    parsed = sanitize(JSON.parse(plain));
  } catch {
    parsed = null;
  }
  // Decrypted but unparseable is permanent corruption — safe to replace.
  return { status: "found", state: parsed ?? { lastSeen: {} } };
}

async function flushPublish(pubkey: string, slot: Slot): Promise<void> {
  if (slot.inflight) {
    await slot.inflight.catch(() => undefined);
  }
  if (!slot.dirty || !slot.loaded) return;

  const promise = (async () => {
    // Merge-before-publish: another device may have moved watermarks forward.
    const remote = await fetchRemote(pubkey);
    if (remote.status === "failed") throw new Error("read-state: remote unreadable");
    if (remote.state) {
      memory.set(pubkey, mergeStates(getReadState(pubkey), remote.state));
    }

    // Snapshot what this publish carries; later mutations re-dirty the slot.
    slot.dirty = false;
    const snapshot = clone(getReadState(pubkey));
    const legacyCarried = slot.legacyKeys.slice();

    try {
      const signer = await signerManager.getSigner();
      if (!signer.nip44Encrypt) throw new Error("read-state: signer lacks nip44");
      const cipher = await signer.nip44Encrypt(pubkey, JSON.stringify(snapshot));
      const template: EventTemplate = {
        kind: DM_READ_STATE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", DM_READ_STATE_D_TAG]],
        content: cipher,
      };
      const signed = await signer.signEvent(template);
      const result = await dataLayer.publishEvent(signed);
      if (result && result.ok === false) {
        throw new Error("read-state: no relay accepted the publish");
      }
    } catch (err) {
      slot.dirty = true;
      throw err;
    }

    // Values now live in the signed event — legacy copies can go.
    removeLegacyKeys(legacyCarried);
    slot.legacyKeys = slot.legacyKeys.filter((k) => !legacyCarried.includes(k));
  })();

  slot.inflight = promise;
  try {
    await promise;
  } finally {
    slot.inflight = null;
  }
}

function readLegacy(pubkey: string): { state: ReadState; keys: string[] } {
  const state: ReadState = { lastSeen: {} };
  const keys: string[] = [];
  try {
    const markAllKey = LEGACY_MARK_ALL_PREFIX + pubkey;
    const markAllRaw = localStorage.getItem(markAllKey);
    if (markAllRaw !== null) {
      const ts = toSeconds(parseInt(markAllRaw, 10));
      if (ts) state.markAllTs = ts;
      keys.push(markAllKey);
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LEGACY_LAST_SEEN_PREFIX)) continue;
      const conversationId = key.slice(LEGACY_LAST_SEEN_PREFIX.length);
      // Legacy lastSeen keys weren't namespaced by account; only adopt
      // conversations this account is part of.
      if (conversationId.split("+").includes(pubkey)) {
        const ts = toSeconds(parseInt(localStorage.getItem(key) || "0", 10));
        if (ts > (state.lastSeen[conversationId] ?? 0)) {
          state.lastSeen[conversationId] = ts;
        }
        keys.push(key);
      }
    }
  } catch {
    // ignore storage hiccups
  }
  return { state, keys };
}

function removeLegacyKeys(keys: string[]): void {
  try {
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

/**
 * Hydrate in-memory state from our d-scoped event, folding in any legacy
 * localStorage watermarks. Returns the load status: on `failed` the in-memory
 * state is still usable for this session but nothing will be published until
 * a later load succeeds.
 */
export async function loadReadState(
  pubkey: string
): Promise<{ state: ReadState; status: LoadStatus }> {
  const slot = slotFor(pubkey);
  const legacy = readLegacy(pubkey);

  const remote = await fetchRemote(pubkey);

  let merged = mergeStates(getReadState(pubkey), legacy.state);
  if (remote.state) merged = mergeStates(merged, remote.state);
  // Don't let a late load clobber a session that was cleared meanwhile.
  if (slots.get(pubkey) !== slot) return { state: merged, status: remote.status };
  memory.set(pubkey, merged);

  if (legacy.keys.length > 0) {
    const set = new Set([...slot.legacyKeys, ...legacy.keys]);
    slot.legacyKeys = Array.from(set);
    // Anything legacy that the remote doesn't already cover must be published.
    if (!remote.state || !covers(remote.state, legacy.state)) slot.dirty = true;
    else {
      // Already persisted remotely — safe to drop now.
      removeLegacyKeys(legacy.keys);
      slot.legacyKeys = slot.legacyKeys.filter((k) => !legacy.keys.includes(k));
    }
  }

  if (remote.status !== "failed") {
    slot.loaded = true;
    if (slot.dirty) {
      slot.failures = 0;
      schedule(pubkey, DEBOUNCE_MS);
    }
  }
  return { state: merged, status: remote.status };
}

/** True when `a` already has every watermark of `b` at or beyond b's value. */
function covers(a: ReadState, b: ReadState): boolean {
  if ((b.markAllTs ?? 0) > (a.markAllTs ?? 0)) return false;
  for (const [cid, ts] of Object.entries(b.lastSeen)) {
    if (Math.max(a.lastSeen[cid] ?? 0, a.markAllTs ?? 0) < ts) return false;
  }
  return true;
}

export function clearReadState(pubkey: string): void {
  memory.delete(pubkey);
  const slot = slots.get(pubkey);
  if (slot) {
    if (slot.timer !== null) clearTimeout(slot.timer);
    slots.delete(pubkey);
  }
}

// Best-effort flush when the tab is being hidden/closed so a read made just
// before backgrounding isn't lost to the debounce window.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const flushAll = () => {
    slots.forEach((slot, pubkey) => {
      if (slot.dirty && slot.loaded && !slot.inflight) {
        if (slot.timer !== null) {
          clearTimeout(slot.timer);
          slot.timer = null;
        }
        void runFlush(pubkey);
      }
    });
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
  window.addEventListener("pagehide", flushAll);
}

/** Test-only: reset module state. */
export function __resetForTests(): void {
  slots.forEach((s) => s.timer !== null && clearTimeout(s.timer));
  slots.clear();
  memory.clear();
}
