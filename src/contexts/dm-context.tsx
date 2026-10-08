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
import {
  unwrapGiftWrap,
  wrapAndSendDM,
  wrapAndSendReaction,
  getConversationId,
  Rumor,
} from "../nostr/nip17";
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
  /** Fetch the next older window of gift wraps (until-cursor pagination). */
  loadOlder: () => void;
  /** True while an older window is being fetched. */
  loadingMore: boolean;
  /** False once a pagination page yielded nothing older. */
  hasMore: boolean;
}

export const DMContext = createContext<DMContextInterface | null>(null);

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
    }

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
    };

    const pushPending = (rumor: Rumor, wrapId: string) => {
      pendingBatch.push({ rumor, wrapId });
      if (!flushTimer) flushTimer = setTimeout(flushPending, 50);
    };

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
            // Pagination bookkeeping: track the oldest wrap seen as the cursor;
            // count first-seen wraps at/below the active cursor to decide whether
            // an older page actually exists (hasMore).
            if (
              oldestWrapTsRef.current === 0 ||
              event.created_at < oldestWrapTsRef.current
            ) {
              oldestWrapTsRef.current = event.created_at;
            }
            if (
              cursorUntilRef.current > 0 &&
              event.created_at <= cursorUntilRef.current
            ) {
              pageNewRef.current++;
            }

            if (privateKey) {
              // Local key: decrypt instantly, no signer prompts
              const rumor = await unwrapGiftWrap(event, privateKey);
              if (rumor) pushPending(rumor, event.id);
            } else {
              // External signer (Amber / NIP-07 / NIP-46): queue so only one
              // decrypt request is in-flight at a time — avoids bombarding the
              // user with simultaneous approval prompts on startup.
              decryptQueue.current = decryptQueue.current.then(async () => {
               if (decryptionRejected.current) return;
                 const rumor = await unwrapGiftWrap(event, undefined);
                if (rumor) {
                  pushPending(rumor, event.id);
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
  }, [user, addMessages]);

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
    ]
  );

  return <DMContext.Provider value={ctxValue}>{children}</DMContext.Provider>;
}
