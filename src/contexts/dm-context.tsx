import React, {
  createContext,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Event } from "nostr-tools";
import { useUserContext } from "../hooks/useUserContext";
import { dataLayer, type ObserveHandle, type PublishResult } from "@formstr/local-relay";
import { useRelayRefresh } from "../dataLayer/hooks";
import { postRelayWorkerFrame, nudgeRelaySync } from "../dataLayer/bootstrap";
import {
  unwrapGiftWrap,
  wrapAndSendDM,
  wrapAndSendReaction,
  wrapAndSendFile,
  getConversationId,
  parseTypingKeyRumor,
  isPresencePingRumor,
  Rumor,
} from "../nostr/nip17";
import {
  FileMeta,
  parseFileMeta,
  encryptBlob,
  uploadToBlossom,
  measureImageDim,
} from "../nostr/fileMessage";
import {
  sendTypingPing,
  sendPresencePing,
  presenceSendPeers,
  setPresenceSendEnabled,
  resetTypingSessions,
} from "../nostr/typing";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  setLastSeen,
  setMarkAllTs,
  getLastSeen,
  loadReadState,
  clearReadState,
} from "../nostr/dm-read-state";

export interface DMMessage {
  id: string; // rumor id
  wrapId: string; // gift wrap event id (for dedup/cache key)
  pubkey: string; // sender pubkey
  content: string;
  created_at: number;
  tags: string[][];
  /** Attachment metadata for kind-15 file messages (and legacy imeta kind-14). */
  file?: FileMeta;
}

export interface DMReaction {
  emoji: string;
  pubkey: string; // who reacted
  tags?: string[][]; // for custom emoji support
}

export interface Conversation {
  id: string; // conversationId (sorted pubkeys joined with +)
  participants: string[];
  messages: DMMessage[];
  lastMessageAt: number;
  unreadCount: number;
  reactions: Map<string, DMReaction[]>; // messageId -> reactions
}

export interface SendTracking {
  rumorId: string;
  /** Signed gift wraps — kept so a retry can republish without re-signing. */
  wraps: Event[];
  /** Per-relay delivery outcome reported by the worker. */
  result: PublishResult;
}

interface DMContextInterface {
  conversations: Map<string, Conversation>;
  sendMessage: (
    recipientPubkey: string,
    content: string,
    replyToId?: string
  ) => Promise<SendTracking>;
  sendReaction: (
    recipientPubkey: string,
    emoji: string,
    messageId: string
  ) => Promise<void>;
  markAsRead: (conversationId: string) => void;
  markAllAsRead: () => void;
  unreadTotal: number;
  loading: boolean;
  sendFile: (
    recipientPubkey: string,
    file: File,
    extra?: { waveform?: number[]; duration?: number },
    replyToId?: string
  ) => Promise<SendTracking>;
  notifyTyping: (peerPubkey: string) => void;
  /** peer pubkey -> epoch ms until which their "typing…" state is live. */
  typingPeers: Map<string, number>;
  /** peer pubkey -> epoch ms until which their "online" state is live. */
  presencePeers: Map<string, number>;
  /** Opt MY account into sharing presence with one peer (off by default). */
  setPresenceFor: (peerPubkey: string, on: boolean) => void;
  /** Fetch the next older window of gift wraps (until-cursor pagination). */
  loadOlder: () => void;
  /** True while an older window is being fetched. */
  loadingMore: boolean;
  /** False once a pagination page yielded nothing older. */
  hasMore: boolean;
}

export const DMContext = createContext<DMContextInterface | null>(null);

// --- Out-of-WoT wrap retention (flood control) ---
/** Intro-safety window: out-of-WoT wraps younger than this are kept, so a
 *  first message from a brand-new peer always has time to be seen. */
const COLD_WRAP_GRACE_SECONDS = 72 * 60 * 60;
type ColdWrapEntry = { sender: string | null; createdAt: number };
/**
 * Peers the user demonstrably engages with: non-self participants of
 * conversations that contain at least one self-authored message. Conversation
 * existence alone is NOT warmth — a NIP-17 intro from a stranger builds one.
 */
function engagedPeers(
  conversations: Map<string, Conversation>,
  myPubkey: string
): Set<string> {
  const out = new Set<string>();
  Array.from(conversations.values()).forEach((conv) => {
    if (!conv.messages.some((m) => m.pubkey === myPubkey)) return;
    conv.participants.forEach((p) => {
      if (p !== myPubkey) out.add(p);
    });
  });
  return out;
}

// Legacy keys from earlier versions (plaintext giftwrap cache / localStorage
// reaction cache) — purged on logout so old installs shed the quota bloat.
const LEGACY_CACHE_PREFIX = "dm_cache_";
const GW_LEGACY_PREFIX = "dm_gw_";
const REACTION_LEGACY_PREFIX = "dm_reactions_";
/**
 * Reactions whose parent message hasn't arrived yet (e.g. a kind-7 rumor
 * streamed before its message during a replay). Keyed by conversation id, then
 * by target message id. In-memory only — the wraps themselves are still in the
 * worker's IndexedDB store, so a real reload re-derives everything.
 */
const pendingReactions = new Map<string, Record<string, DMReaction[]>>();

/** Initial gift-wrap window per observe: newest N wraps on boot/refresh. */
const DM_PAGE = 100;
/**
 * How long a received typing ping stays visible. The event's NIP-40 expiration
 * is ~30s (relay shed horizon); the UI cadence should be snappier.
 */
const TYPING_VISIBLE_MS = 6000;

/**
 * Presence pings land every ~30s while the sender's app is visible; 90s of
 * grace (≈3 missed pings) before a peer drops back to offline.
 */
const PRESENCE_ONLINE_MS = 90 * 1000;
/** Re-open all upstream sockets after this long, while foregrounded. */
const KEEPALIVE_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Merge the already-sorted messages array with a small ascending batch without
 * a full re-sort. During a replay burst the per-message `.sort()` did O(n log n)
 * work n times (O(n² log n) total); this merge is O(n + k) per conversation.
 */
function mergeSortedMessages(
  existing: DMMessage[],
  freshSorted: DMMessage[]
): DMMessage[] {
  if (existing.length === 0) return freshSorted;
  if (freshSorted.length === 0) return existing;
  const out: DMMessage[] = new Array(existing.length + freshSorted.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < existing.length && j < freshSorted.length) {
    if (existing[i].created_at <= freshSorted[j].created_at) {
      out[k++] = existing[i++];
    } else {
      out[k++] = freshSorted[j++];
    }
  }
  while (i < existing.length) out[k++] = existing[i++];
  while (j < freshSorted.length) out[k++] = freshSorted[j++];
  return out;
}

/** Purge the legacy localStorage DM caches (giftwrap + reactions) and the
 *  in-flight reaction buffer. Called on logout. */
function clearLegacyDmCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key?.startsWith(LEGACY_CACHE_PREFIX) ||
        key?.startsWith(GW_LEGACY_PREFIX) ||
        key?.startsWith(REACTION_LEGACY_PREFIX)
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
  pendingReactions.clear();
}

export function DMProvider({ children }: { children: ReactNode }) {
  const { user } = useUserContext();
  const [conversations, setConversations] = useState<Map<string, Conversation>>(
    new Map()
  );

  const [loading, setLoading] = useState(false);
  // Pagination UI state: an "older" page is in flight, and older history still
  // exists (a page that yielded zero new wraps flips hasMore off).
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // Typing indicators (ephemeral kind 20001, best-effort): peer -> expiry (ms).
  // A 1s tick prunes expired entries so the UI clears on its own.
  const [typingPeers, setTypingPeers] = useState<Map<string, number>>(
    new Map()
  );
  const typingPeersRef = useRef(typingPeers);
  typingPeersRef.current = typingPeers;
  // Typing v2 bindings: ephemeralPk -> { realPk, until(s) }. The binding DM is
  // sealed by the sender's real key, so this map is the trust anchor that lets
  // wrapped pings attribute themselves to a participant. Session memory only —
  // senders re-key and re-bind on their next session; nothing persists.
  const typingKeyBindingsRef = useRef(
    new Map<string, { realPk: string; until: number }>()
  );
  // Wrapped pings that raced ahead of their binding wrap: ephemeralPk ->
  // held pings, flushed when the binding lands (or dropped on expiry).
  const pendingTypingRef = useRef(
    new Map<
      string,
      Array<{ expiresAtMs: number; wrapId: string; presence: boolean }>
    >()
  );
  // Presence (ping-pong): peer -> epoch ms until which their last wrapped
  // ping keeps them "online". Memory-only, like typing state.
  const [presencePeers, setPresencePeers] = useState<Map<string, number>>(
    () => new Map<string, number>()
  );
  const presencePeersRef = useRef(presencePeers);
  presencePeersRef.current = presencePeers;
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      const cur = typingPeersRef.current;
      let changed = false;
      const next = new Map<string, number>();
      Array.from(cur.entries()).forEach(([pk, exp]) => {
        if (exp > now) next.set(pk, exp);
        else changed = true;
      });
      if (changed) setTypingPeers(next);
    }, 1000);
    return () => clearInterval(t);
  }, []);
  const seenRumorIds = useRef<Set<string>>(new Set());
  // Gift-wrap event ids already processed — dedup BEFORE decrypt so a re-observe
  // (after worker hydration) doesn't re-decrypt known wraps and, for external
  // signers, doesn't re-prompt the user for approval.
  const seenWrapIds = useRef<Set<string>>(new Set());
  // The account the current subscription state belongs to, so a refresh-driven
  // re-observe (same user) preserves conversations while an account switch resets.
  const lastUserKey = useRef<string | null>(null);
  const subRef = useRef<ObserveHandle | null>(null);
  // Bumps once the worker has hydrated its store (or restarted); we re-observe
  // so cached gift wraps that the boot-time subscription EOSE'd past get decrypted.
  const refresh = useRelayRefresh();
  // Serialise external-signer decryption so the user only sees one prompt at a time
  const decryptQueue = useRef<Promise<void>>(Promise.resolve());
  // If the user rejects a decrypt request, stop asking for the rest of the session
  const decryptionRejected = useRef(false);
  // Pagination cursor state (until = oldest wrap created_at seen). The head
  // window stays live beside the cursor window so the live tail keeps flowing —
  // same pattern as the feed's useEvents pagination.
  const oldestWrapTsRef = useRef(0);
  const cursorUntilRef = useRef(0);
  const pageNewRef = useRef(0);
  const loadingMoreRef = useRef(false);
  // Out-of-WoT wrap queue (flood control): wrap id -> { sender, createdAt }.
  // Classified at unwrap time — the sender only becomes visible after
  // decryption, which happens here, never in the worker. Warmth is re-checked
  // at sweep time against the CURRENT follow list + engaged peers, so a boot
  // race (follows not yet loaded) can only delay deletion, never cause one.
  const coldWrapsRef = useRef<Map<string, ColdWrapEntry>>(new Map());
  const followsRef = useRef<Set<string>>(new Set());
  const conversationsRef = useRef<Map<string, Conversation>>(new Map());
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  /** Recompute `unreadCount` for each conversation against the read-state
   *  watermark. Called once after `loadReadState` resolves so a conversation
   *  the user has already read on another device shows as read here too. */
  const applyReadStateToConversations = useCallback((myPubkey: string) => {
    setConversations((prev) => {
      const next = new Map<string, Conversation>();
      let changed = false;
      Array.from(prev.entries()).forEach(([id, conv]) => {
        const lastSeen = getLastSeen(myPubkey, id);
        const unread = conv.messages.filter(
          (m) => m.pubkey !== myPubkey && m.created_at > lastSeen
        ).length;
        if (unread !== conv.unreadCount) {
          next.set(id, { ...conv, unreadCount: unread });
          changed = true;
        } else {
          next.set(id, conv);
        }
      });
      return changed ? next : prev;
    });
  }, []);

  /**
   * Ingest a batch of decrypted rumors with a single setConversations pass.
   * The worker delivers gift wraps one EVENT at a time; without batching, each
   * wrap caused its own render (plus a full re-sort) during the boot replay —
   * the storm behind "opening a chat lags". One call per tick, one render.
   */
  const addMessages = useCallback(
    (entries: Array<{ rumor: Rumor; wrapId: string }>, myPubkey: string) => {
      if (entries.length === 0) return;

      // Dedup outside the updater (same policy as before): one canonical pass
      // over the batch; unseen rumors split into messages vs reactions.
      const messageBatch: Array<{ rumor: Rumor; wrapId: string }> = [];
      const reactionBatch: Rumor[] = [];
      for (const { rumor, wrapId } of entries) {
        if (seenRumorIds.current.has(rumor.id)) continue;
        seenRumorIds.current.add(rumor.id);
        if (rumor.kind === 7) reactionBatch.push(rumor);
        else messageBatch.push({ rumor, wrapId });
      }
      if (messageBatch.length === 0 && reactionBatch.length === 0) return;

      setConversations((prev) => {
        const next = new Map(prev);
        let changed = false;

        // --- messages: group by conversation, sorted-merge into each existing
        // conversation (or create it) in this same pass.
        const incomingByConv = new Map<string, DMMessage[]>();
        for (const { rumor, wrapId } of messageBatch) {
          const pTags = rumor.tags
            .filter((t) => t[0] === "p")
            .map((t) => t[1]);
          const conversationId = getConversationId(rumor.pubkey, pTags);
          const msg: DMMessage = {
            id: rumor.id,
            wrapId,
            pubkey: rumor.pubkey,
            content: rumor.content,
            created_at: rumor.created_at,
            tags: rumor.tags,
            ...(rumor.kind === 15 || rumor.tags.some((t) => t[0] === "imeta")
              ? {
                  file:
                    parseFileMeta(rumor.tags, rumor.kind, rumor.content) ??
                    undefined,
                }
              : {}),
          };
          const list = incomingByConv.get(conversationId);
          // in-batch dedup
          if (list?.some((m) => m.id === msg.id)) continue;
          if (list) list.push(msg);
          else incomingByConv.set(conversationId, [msg]);
        }

        for (const [conversationId, incoming] of Array.from(incomingByConv)) {
          incoming.sort((a, b) => a.created_at - b.created_at); // small batch
          const existing = next.get(conversationId);
          // Read threshold = the later of this conversation's own lastSeen and
          // the account-wide "mark all read" watermark (handled inside the
          // module), so a global mark-all covers messages/conversations that
          // hadn't loaded when it was clicked.
          const lastSeen = getLastSeen(myPubkey, conversationId);

          if (existing) {
            const fresh = incoming.filter(
              (m) => !existing.messages.some((x) => x.id === m.id)
            );
            if (fresh.length === 0) continue;
            const merged = mergeSortedMessages(existing.messages, fresh);
            let unreadCount = existing.unreadCount;
            for (const m of fresh) {
              if (m.pubkey !== myPubkey && m.created_at > lastSeen) unreadCount++;
            }
            next.set(conversationId, {
              ...existing,
              messages: merged,
              lastMessageAt: Math.max(
                existing.lastMessageAt,
                merged[merged.length - 1].created_at
              ),
              unreadCount,
            });
            changed = true;
          } else {
            // Reactions that out-raced this conversation's creation (a kind-7
            // rumor replayed before its parent message) — drain the buffer.
            const buffered = pendingReactions.get(conversationId) ?? null;
            if (buffered) pendingReactions.delete(conversationId);
            let unreadCount = 0;
            for (const m of incoming) {
              if (m.pubkey !== myPubkey && m.created_at > lastSeen) unreadCount++;
            }
            next.set(conversationId, {
              id: conversationId,
              participants: conversationId.split("+"),
              messages: incoming,
              lastMessageAt: incoming[incoming.length - 1].created_at,
              unreadCount,
              reactions: buffered
                ? new Map(Object.entries(buffered))
                : new Map<string, DMReaction[]>(),
            });
            changed = true;
          }
        }

        // --- reactions: bucketed per conversation -> per target message, then
        // applied in one pass. Conversations that don't exist yet buffer, as before.
        const reactionBuckets = new Map<string, Map<string, DMReaction[]>>();
        for (const rumor of reactionBatch) {
          const pTags = rumor.tags
            .filter((t) => t[0] === "p")
            .map((t) => t[1]);
          const conversationId = getConversationId(rumor.pubkey, pTags);
          const targetMessageId = rumor.tags.find((t) => t[0] === "e")?.[1];
          if (!targetMessageId) continue;
          const reaction: DMReaction = {
            emoji: rumor.content,
            pubkey: rumor.pubkey,
            tags: rumor.tags.filter((t) => t[0] === "emoji"),
          };
          let byMsg = reactionBuckets.get(conversationId);
          if (!byMsg) {
            byMsg = new Map();
            reactionBuckets.set(conversationId, byMsg);
          }
          const list = byMsg.get(targetMessageId) ?? [];
          if (
            list.some(
              (r) => r.pubkey === reaction.pubkey && r.emoji === reaction.emoji
            )
          ) {
            continue;
          }
          list.push(reaction);
          byMsg.set(targetMessageId, list);
        }

        for (const [conversationId, byMsg] of Array.from(reactionBuckets)) {
          const existing = next.get(conversationId);
          if (!existing) {
            // Parent message hasn't landed yet — hold here; a later addMessages
            // call (which creates the conversation) drains the buffer.
            const bucket = pendingReactions.get(conversationId) ?? {};
            for (const [targetMessageId, list] of Array.from(byMsg)) {
              const cur = bucket[targetMessageId] ?? [];
              for (const r of list) {
                if (
                  !cur.some((x) => x.pubkey === r.pubkey && x.emoji === r.emoji)
                ) {
                  cur.push(r);
                }
              }
              bucket[targetMessageId] = cur;
            }
            pendingReactions.set(conversationId, bucket);
            continue;
          }
          const reactionsMap = new Map(existing.reactions);
          for (const [targetMessageId, list] of Array.from(byMsg)) {
            const mergedList = [...(reactionsMap.get(targetMessageId) ?? [])];
            for (const r of list) {
              if (
                !mergedList.some(
                  (x) => x.pubkey === r.pubkey && x.emoji === r.emoji
                )
              ) {
                mergedList.push(r);
              }
            }
            reactionsMap.set(targetMessageId, mergedList);
          }
          next.set(conversationId, { ...existing, reactions: reactionsMap });
          changed = true;
        }

        return changed ? next : prev;
      });
    },
    []
  );

  const addMessage = useCallback(
    (rumor: Rumor, wrapId: string, myPubkey: string) => {
      addMessages([{ rumor, wrapId }], myPubkey);
    },
    [addMessages]
  );

  // Subscribe to incoming gift wraps
  useEffect(() => {
    if (!user) {
      setConversations(new Map());
      seenRumorIds.current.clear();
      seenWrapIds.current.clear();
      lastUserKey.current = null;
      decryptionRejected.current = false;
      coldWrapsRef.current.clear();
      followsRef.current.clear();
      subRef.current?.unobserve();
      subRef.current = null;
      // Shed legacy localStorage DM caches + the in-memory reaction buffer
      clearLegacyDmCaches();
      // Drop this tab's in-memory read-state + any pending 30078 publish.
      if (lastUserKey.current) clearReadState(lastUserKey.current);
      return;
    }

    const myPubkey = user.pubkey;
    const privateKey = user.privateKey;

    // Hydrate read-state (lastSeen watermarks) from the signed kind-30078
    // event + one-time migration off legacy localStorage keys. Non-blocking:
    // the first few messages may flash unread until this settles — harmless,
    // and markAsRead from that instant still works (memory is authoritative).
    loadReadState(myPubkey)
      .then(() => {
        // Re-derive unread counts against the freshly-loaded watermark so a
        // conversation that was read on another device reads as read now.
        applyReadStateToConversations(myPubkey);
      })
      .catch(() => {
        // Worker still hydrating — next markAsRead republishes and wins.
      });

    // Reset accumulated state only on a genuine account switch — NOT on a
    // refresh-driven re-observe for the same user (that would drop conversations
    // and force every wrap to be re-decrypted/re-prompted).
    if (lastUserKey.current !== myPubkey) {
      lastUserKey.current = myPubkey;
      setConversations(new Map());
      seenRumorIds.current.clear();
      seenWrapIds.current.clear();
      decryptionRejected.current = false;
      coldWrapsRef.current.clear();
      followsRef.current.clear();
      typingKeyBindingsRef.current.clear();
      pendingTypingRef.current.clear();
      resetTypingSessions();
      const emptyPresence = new Map<string, number>();
      presencePeersRef.current = emptyPresence;
      setPresencePeers(emptyPresence);
    }

    // Follow list feeds the cold-wrap warmth check. One query per session,
    // dropped at EOSE; the sweep re-checks warmth at delete time, so a slow
    // follow fetch can only delay deletion, never cause a wrong one.
    let followsHandle: ObserveHandle | null = null;
    followsHandle = dataLayer.observe(
      [{ authors: [myPubkey], kinds: [3], limit: 1 }],
      {
        onEvent: (e: Event) => {
          const next = new Set<string>();
          e.tags.forEach((t) => {
            if (t[0] === "p" && t[1]) next.add(t[1]);
          });
          followsRef.current = next;
        },
        onEose: () => {
          followsHandle?.unobserve();
          followsHandle = null;
        },
      }
    );

    // Batch the ingest path: accumulate decrypted rumors and flush them into
    // state at most once per 50 ms, so a replay burst costs one render per
    // tick instead of one per wrap.
    let pendingBatch: Array<{ rumor: Rumor; wrapId: string }> = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushPending = () => {
      flushTimer = null;
      if (pendingBatch.length === 0) return;
      const batch = pendingBatch;
      pendingBatch = [];
      addMessages(batch, myPubkey);
      // Replay floods die on sight: cold wraps older than the grace period
      // are swept the moment their batch lands.
      sweepColdWraps();
    };

    const pushPending = (rumor: Rumor, wrapId: string) => {
      pendingBatch.push({ rumor, wrapId });
      if (!flushTimer) flushTimer = setTimeout(flushPending, 50);
    };

    // Drop out-of-WoT wraps: warm (self / followed / engaged peers) are never
    // deleted; everything else is deleted locally once the intro-safety grace
    // elapses. Local-only by design — a kind-5 cannot delete another author's
    // wrap — and re-delivery dedup (seenWrapIds) swallows resurrections, so
    // the sweep is a retention aid rather than an eviction guarantee.
    const sweepColdWraps = () => {
      const now = Math.floor(Date.now() / 1000);
      const warmPeers = engagedPeers(conversationsRef.current, myPubkey);
      const followSet = followsRef.current;
      const drop: string[] = [];
      Array.from(coldWrapsRef.current.entries()).forEach(([id, entry]) => {
        const warm =
          entry.sender !== null &&
          (entry.sender === myPubkey ||
            followSet.has(entry.sender) ||
            warmPeers.has(entry.sender));
        if (warm) {
          coldWrapsRef.current.delete(id);
          return;
        }
        if (now - entry.createdAt >= COLD_WRAP_GRACE_SECONDS) {
          drop.push(id);
          coldWrapsRef.current.delete(id);
        }
      });
      if (drop.length > 0) {
        postRelayWorkerFrame({ kind: "app:remove-events", ids: drop });
      }
    };
    const sweepTimer = setInterval(sweepColdWraps, 10 * 60 * 1000);

    // Presence ping-pong: opt-in per contact (off by default). Pings go out
    // every 30s while the app is visible — presence means "my app is
    // reachable now", so hidden/backgrounded sessions stay silent.
    const sendPresenceTick = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      const peers = presenceSendPeers(myPubkey);
      for (const peer of peers) {
        void sendPresencePing(peer, myPubkey, user?.privateKey);
      }
    };
    const presenceTimer = setInterval(sendPresenceTick, 30 * 1000);
    sendPresenceTick();

    // Foreground keepalive: a socket can die half-open (network switch,
    // relay restart, mobile power-save) without ever firing onclose — the
    // SDK only reconnects on a real close, so subscriptions silently rot and
    // live messages stop arriving. pause() tears down every upstream socket;
    // resume() reopens standing interests and replays the REQs. Hidden tabs
    // skip it (bootstrap already pauses on backgrounding; visibilitychange
    // resumes on return).
    const keepaliveTimer = setInterval(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        nudgeRelaySync();
      }
    }, KEEPALIVE_INTERVAL_MS);

    const startSubscription = async () => {
      setLoading(true);

      const handle = dataLayer.observe(
        [{ kinds: [1059], "#p": [myPubkey], limit: DM_PAGE }],
        {
          onEvent: async (event: Event) => {
            // Dedup by gift-wrap id before any decryption so a re-observe never
            // re-decrypts (and never re-prompts an external signer for) a wrap
            // we've already handled this session.
            if (seenWrapIds.current.has(event.id)) return;
            seenWrapIds.current.add(event.id);

            // Wrapped typing (v2): pings and binding DMs arrive as ordinary
            // kind-1059 wraps. They are consumed in-memory — applied to typing
            // state, never stored, counted, or cold-queued — and their wraps
            // are deleted straight away. Returns true when consumed.
            const applyTypingState = (peer: string, expiresAtMs: number) => {
              if ((typingPeersRef.current.get(peer) ?? 0) >= expiresAtMs) return;
              setTypingPeers((prev) => {
                if ((prev.get(peer) ?? 0) >= expiresAtMs) return prev;
                return new Map(prev).set(peer, expiresAtMs);
              });
            };
            const applyPresenceState = (peer: string, untilMs: number) => {
              if ((presencePeersRef.current.get(peer) ?? 0) >= untilMs) return;
              setPresencePeers((prev) => {
                if ((prev.get(peer) ?? 0) >= untilMs) return prev;
                return new Map(prev).set(peer, untilMs);
              });
            };
            const routeOrStore = (rumor: Rumor, wrapId: string): boolean => {
              const now = Date.now();
              const expiresAt = rumor.created_at * 1000 + TYPING_VISIBLE_MS;
              if (rumor.kind === 20001) {
                // Ephemeral-sealed ping (typing OR opt-in presence): accept
                // only with a live binding, attribute to the bound real
                // pubkey. Typing shows ~6s; presence holds ~90s. Junk is
                // dropped either way.
                const isPresence = isPresencePingRumor(rumor);
                const binding = typingKeyBindingsRef.current.get(rumor.pubkey);
                if (binding && binding.until > now / 1000 && expiresAt > now) {
                  if (isPresence) {
                    applyPresenceState(binding.realPk, now + PRESENCE_ONLINE_MS);
                  } else {
                    applyTypingState(binding.realPk, expiresAt);
                  }
                  postRelayWorkerFrame({
                    kind: "app:remove-events",
                    ids: [wrapId],
                  });
                } else if (expiresAt > now && !binding) {
                  // Binding wrap may still be in flight — hold briefly.
                  const q = pendingTypingRef.current.get(rumor.pubkey);
                  const held = {
                    expiresAtMs: isPresence ? now + PRESENCE_ONLINE_MS : expiresAt,
                    wrapId,
                    presence: isPresence,
                  };
                  if (!q) {
                    pendingTypingRef.current.set(rumor.pubkey, [held]);
                  } else if (q.length < 50) {
                    q.push(held);
                  }
                } else {
                  postRelayWorkerFrame({
                    kind: "app:remove-events",
                    ids: [wrapId],
                  });
                }
                return true;
              }
              const bindingMsg = parseTypingKeyRumor(rumor);
              if (bindingMsg) {
                // Binding announcement (kind-14, typing-key tag): cache it,
                // flush pings that raced ahead, delete the wrap so it is
                // never stored or rendered.
                typingKeyBindingsRef.current.set(bindingMsg.ephemeralPk, {
                  realPk: rumor.pubkey,
                  until: bindingMsg.until,
                });
                const dropIds: string[] = [wrapId];
                const q = pendingTypingRef.current.get(bindingMsg.ephemeralPk);
                if (q) {
                  pendingTypingRef.current.delete(bindingMsg.ephemeralPk);
                  for (const p of q) {
                    if (p.expiresAtMs > now) {
                      if (p.presence) {
                        applyPresenceState(rumor.pubkey, p.expiresAtMs);
                      } else {
                        applyTypingState(rumor.pubkey, p.expiresAtMs);
                      }
                    }
                    dropIds.push(p.wrapId);
                  }
                }
                postRelayWorkerFrame({
                  kind: "app:remove-events",
                  ids: dropIds,
                });
                return true;
              }
              return false;
            };
            // Pagination bookkeeping: track the oldest wrap seen as the cursor;
            // count first-seen wraps at/below the active cursor to decide whether
            // an older page actually exists (hasMore). Skipped for typing and
            // binding wraps — they're transient, not part of the window.
            const trackForPagination = (ev: Event) => {
              if (
                oldestWrapTsRef.current === 0 ||
                ev.created_at < oldestWrapTsRef.current
              ) {
                oldestWrapTsRef.current = ev.created_at;
              }
              if (
                cursorUntilRef.current > 0 &&
                ev.created_at <= cursorUntilRef.current
              ) {
                pageNewRef.current++;
              }
            };

            if (privateKey) {
              // Local key: decrypt instantly, no signer prompts
              const rumor = await unwrapGiftWrap(event, privateKey);
              if (rumor && routeOrStore(rumor, event.id)) {
                // typing ping / binding announcement — consumed in-memory
              } else {
                trackForPagination(event);
                if (rumor) pushPending(rumor, event.id);
                // WoT classification: a null rumor here is a deterministic
                // local-key failure — unclassifiable junk, queued sender-less
                // and dropped by the sweep after the grace window.
                coldWrapsRef.current.set(event.id, {
                  sender: rumor ? rumor.pubkey : null,
                  createdAt: event.created_at,
                });
              }
            } else {
              // External signer (Amber / NIP-07 / NIP-46): queue so only one
              // decrypt request is in-flight at a time — avoids bombarding the
              // user with simultaneous approval prompts on startup.
              decryptQueue.current = decryptQueue.current.then(async () => {
               if (decryptionRejected.current) return;
                 const rumor = await unwrapGiftWrap(event, undefined);
                if (rumor && routeOrStore(rumor, event.id)) {
                  // typing ping / binding announcement — consumed in-memory
                  return;
                }
                trackForPagination(event);
                if (rumor) {
                  pushPending(rumor, event.id);
                  // Classification only — a rejection is ambiguous (user said
                  // no), so failed external unwraps are never queued.
                  coldWrapsRef.current.set(event.id, {
                    sender: rumor.pubkey,
                    createdAt: event.created_at,
                  });
                } else {
                  // null means the signer rejected or failed — stop asking
                  decryptionRejected.current = true;
                }
              });
            }
          },
          onEose: () => {
            if (flushTimer) {
              clearTimeout(flushTimer);
              flushTimer = null;
            }
            flushPending();
            setLoading(false);
            if (cursorUntilRef.current > 0) {
              setHasMore(pageNewRef.current > 0);
              cursorUntilRef.current = 0;
              pageNewRef.current = 0;
              loadingMoreRef.current = false;
              setLoadingMore(false);
            }
          },
        }
      );

      subRef.current = handle;
    };

    startSubscription();

    // Only drop the subscription here — accumulated state (conversations, seen
    // ids) is reset at the top of the effect on an account switch, and on logout
    // by the `!user` branch. This lets a refresh-driven re-observe keep state.
    return () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      // Stop the cold-wrap sweeper with the account's subscription.
      clearInterval(sweepTimer);
      clearInterval(presenceTimer);
      clearInterval(keepaliveTimer);
      // Flush stragglers into state before teardown — the flush closes over
      // the account the batch belongs to.
      flushPending();
      subRef.current?.unobserve();
      subRef.current = null;
    };
  }, [user, addMessages, refresh, applyReadStateToConversations]);

  /**
   * Widen the DM window by one page: keep the live head beside an until-cursor
   * window ending at the oldest wrap seen (inclusive — dedup swallows the
   * overlap). A growing `limit` would re-serve the same newest-N forever once N
   * passes relay caps, so the cursor is the correct mechanism (same rationale
   * as the feed's useEvents.loadOlder).
   */
  const loadOlder = useCallback(() => {
    const handle = subRef.current;
    const cursor = oldestWrapTsRef.current;
    if (!handle || !user || loadingMoreRef.current || cursor === 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    pageNewRef.current = 0;
    cursorUntilRef.current = cursor;
    handle.update([
      { kinds: [1059], "#p": [user.pubkey], limit: DM_PAGE },
      { kinds: [1059], "#p": [user.pubkey], until: cursor, limit: DM_PAGE },
    ]);
  }, [user]);

  const sendMessage = useCallback(
    async (
      recipientPubkey: string,
      content: string,
      replyToId?: string
    ): Promise<SendTracking> => {
      if (!user) throw new Error("Must be logged in to send DMs");

      const { rumor, wraps, result } = await wrapAndSendDM(
        recipientPubkey,
        content,
        user.privateKey,
        replyToId
      );

      // Optimistically add to state immediately
      addMessage(rumor, `local_${rumor.id}`, user.pubkey);

      return { rumorId: rumor.id, wraps, result };
    },
    [user, addMessage]
  );

  const sendReaction = useCallback(
    async (recipientPubkey: string, emoji: string, messageId: string) => {
      if (!user) throw new Error("Must be logged in to react to DMs");

      const rumor = await wrapAndSendReaction(
        recipientPubkey,
        emoji,
        messageId,
        user.privateKey
      );

      // Optimistically add reaction
      addMessage(rumor, `local_reaction_${rumor.id}`, user.pubkey);
    },
    [user, addMessage]
  );

  /**
   * Encrypt + upload + send a file as a NIP-17 kind 15 message. Bytes are
   * AES-GCM-encrypted in memory, uploaded to Blossom (kind 24242 auth), and
   * only the encrypted blob leaves the device. Nothing plaintext touches disk.
   */
  const sendFile = useCallback(
    async (
      recipientPubkey: string,
      file: File,
      extra?: { waveform?: number[]; duration?: number },
      replyToId?: string
    ): Promise<SendTracking> => {
      if (!user) throw new Error("Must be logged in to send files");

      const buf = await file.arrayBuffer();
      const originalSha = bytesToHex(sha256(new Uint8Array(buf)));
      const { cipher, key, nonce } = await encryptBlob(buf);
      const uploaded = await uploadToBlossom(cipher, "application/octet-stream");

      let dim: string | undefined;
      if (file.type.startsWith("image/")) {
        dim = (await measureImageDim(file)) ?? undefined;
      }

      const meta: FileMeta = {
        url: uploaded.url,
        mimeType: file.type || "application/octet-stream",
        alg: "aes-gcm",
        key,
        nonce,
        encryptedSha: uploaded.sha256,
        originalSha,
        size: cipher.length,
        dim,
        duration: extra?.duration,
        waveform: extra?.waveform,
        fileName: file.name,
      };

      const { rumor, wraps, result } = await wrapAndSendFile(
        recipientPubkey,
        meta,
        user.privateKey,
        replyToId
      );

      // Optimistically add — the ingest parser attaches `file` from the tags.
      addMessage(rumor, `local_${rumor.id}`, user.pubkey);
      return { rumorId: rumor.id, wraps, result };
    },
    [user, addMessage]
  );

  const notifyTyping = useCallback(
    (peerPubkey: string) => {
      if (!user) return;
      // fire-and-forget; pings are best-effort. v2: signer-free after the
      // once-per-session binding prompt (all-local ephemeral signing).
      sendTypingPing(peerPubkey, user.pubkey, user.privateKey);
    },
    [user]
  );

  // Toggle MY opt-in to share presence with one peer (persisted locally, off
  // by default). Enabling pings immediately so the peer sees you online
  // without waiting for the next tick.
  const setPresenceFor = useCallback(
    (peerPubkey: string, on: boolean) => {
      if (!user) return;
      setPresenceSendEnabled(user.pubkey, peerPubkey, on);
      if (
        on &&
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        void sendPresencePing(peerPubkey, user.pubkey, user.privateKey);
      }
    },
    [user]
  );

  const markAsRead = useCallback(
    (conversationId: string) => {
      if (!user) return;
      setLastSeen(user.pubkey, conversationId, Math.floor(Date.now() / 1000));

      setConversations((prev) => {
        const next = new Map(prev);
        const conv = next.get(conversationId);
        if (conv && conv.unreadCount > 0) {
          next.set(conversationId, { ...conv, unreadCount: 0 });
        }
        return next;
      });
    },
    [user]
  );

  const markAllAsRead = useCallback(() => {
    if (!user) return;
    const now = Math.floor(Date.now() / 1000);
    // Persist a single account-wide watermark — this is what makes mark-all stick
    // across reloads even for conversations that decrypt/arrive later.
    setMarkAllTs(user.pubkey, now);

    setConversations((prev) => {
      const next = new Map(prev);
      Array.from(next.entries()).forEach(([id, conv]) => {
        if (conv.unreadCount > 0) {
          next.set(id, { ...conv, unreadCount: 0 });
        }
      });
      return next;
    });
  }, [user]);

  const unreadTotal = useMemo(
    () =>
      Array.from(conversations.values()).reduce(
        (sum, c) => sum + c.unreadCount,
        0
      ),
    [conversations]
  );

  const ctxValue = useMemo(
    () => ({
      conversations,
      sendMessage,
      sendReaction,
      markAsRead,
      markAllAsRead,
      unreadTotal,
      loading,
      loadOlder,
      loadingMore,
      hasMore,
      sendFile,
      notifyTyping,
      typingPeers,
      presencePeers,
      setPresenceFor,
    }),
    [
      conversations,
      sendMessage,
      sendReaction,
      markAsRead,
      markAllAsRead,
      unreadTotal,
      loading,
      loadOlder,
      loadingMore,
      hasMore,
      sendFile,
      notifyTyping,
      typingPeers,
      presencePeers,
      setPresenceFor,
    ]
  );

  return <DMContext.Provider value={ctxValue}>{children}</DMContext.Provider>;
}
