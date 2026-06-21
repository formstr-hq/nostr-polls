import React, {
  createContext,
  ReactNode,
  useCallback,
  useEffect,
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
}

export const DMContext = createContext<DMContextInterface | null>(null);

// Giftwrap events (already NIP-44 encrypted) are safe to cache — no plaintext at rest.
const GW_CACHE_PREFIX = "dm_gw_";
// Legacy key used in earlier versions — purged on mount/logout.
const LEGACY_CACHE_PREFIX = "dm_cache_";
const LAST_SEEN_PREFIX = "dm_lastseen_";
// Per-account "all read up to" watermark. markAllAsRead sets this so messages
// that decrypt or arrive AFTER the click — or conversations not loaded yet at
// click time — are still treated as read on the next load. A per-conversation
// lastSeen alone missed those, so old messages reappeared as unread.
const MARK_ALL_PREFIX = "dm_markall_";
const REACTION_CACHE_PREFIX = "dm_reactions_";
const GW_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedGiftWrap {
  event: Event;
  cachedAt: number;
}

/** Persist the raw (still-encrypted) giftwrap so a reload avoids a relay re-fetch. */
function cacheGiftWrap(wrapId: string, event: Event): void {
  try {
    const entry: CachedGiftWrap = { event, cachedAt: Date.now() };
    localStorage.setItem(GW_CACHE_PREFIX + wrapId, JSON.stringify(entry));
  } catch {
    // localStorage full, ignore
  }
}

/** Return the cached giftwrap Event if present and within TTL, otherwise null. */
function getCachedGiftWrap(wrapId: string): Event | null {
  try {
    const raw = localStorage.getItem(GW_CACHE_PREFIX + wrapId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedGiftWrap;
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > GW_CACHE_TTL_MS) {
      localStorage.removeItem(GW_CACHE_PREFIX + wrapId);
      return null;
    }
    return parsed.event;
  } catch {
    return null;
  }
}

/** Remove giftwrap cache entries older than TTL. Called on mount. */
function pruneExpiredGiftWraps(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(GW_CACHE_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as CachedGiftWrap;
      if (!parsed.cachedAt || Date.now() - parsed.cachedAt > GW_CACHE_TTL_MS) {
        keysToRemove.push(key);
      }
    } catch {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

/** Clear all giftwrap cache entries and any legacy plaintext entries on logout. */
function clearGiftWrapCache(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(GW_CACHE_PREFIX) || key?.startsWith(LEGACY_CACHE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

function getLastSeen(conversationId: string): number {
  try {
    const ts = localStorage.getItem(LAST_SEEN_PREFIX + conversationId);
    return ts ? parseInt(ts, 10) : 0;
  } catch {
    return 0;
  }
}

function setLastSeen(conversationId: string, timestamp: number): void {
  try {
    localStorage.setItem(LAST_SEEN_PREFIX + conversationId, String(timestamp));
  } catch {
    // ignore
  }
}

function getMarkAllTs(pubkey: string): number {
  try {
    const ts = localStorage.getItem(MARK_ALL_PREFIX + pubkey);
    return ts ? parseInt(ts, 10) : 0;
  } catch {
    return 0;
  }
}

function setMarkAllTs(pubkey: string, timestamp: number): void {
  try {
    localStorage.setItem(MARK_ALL_PREFIX + pubkey, String(timestamp));
  } catch {
    // ignore
  }
}

export function DMProvider({ children }: { children: ReactNode }) {
  const { user } = useUserContext();
  const [conversations, setConversations] = useState<Map<string, Conversation>>(
    new Map()
  );

  // Prune stale giftwrap cache entries on mount
  useEffect(() => {
    pruneExpiredGiftWraps();
  }, []);
  const [loading, setLoading] = useState(false);
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

  const addReactionToConversation = useCallback(
    (rumor: Rumor, myPubkey: string) => {
      const pTags = rumor.tags
        .filter((t) => t[0] === "p")
        .map((t) => t[1]);
      const conversationId = getConversationId(rumor.pubkey, pTags);
      const targetMessageId = rumor.tags.find((t) => t[0] === "e")?.[1];
      if (!targetMessageId) return;

      const reaction: DMReaction = {
        emoji: rumor.content,
        pubkey: rumor.pubkey,
        tags: rumor.tags.filter((t) => t[0] === "emoji"),
      };

      // Cache reaction
      try {
        const cacheKey = REACTION_CACHE_PREFIX + conversationId;
        const cached = localStorage.getItem(cacheKey);
        const reactions: Record<string, DMReaction[]> = cached
          ? JSON.parse(cached)
          : {};
        if (!reactions[targetMessageId]) reactions[targetMessageId] = [];
        // Dedup: don't add same pubkey+emoji twice
        if (
          !reactions[targetMessageId].some(
            (r) => r.pubkey === reaction.pubkey && r.emoji === reaction.emoji
          )
        ) {
          reactions[targetMessageId].push(reaction);
          localStorage.setItem(cacheKey, JSON.stringify(reactions));
        }
      } catch {
        // localStorage full, ignore
      }

      setConversations((prev) => {
        const next = new Map(prev);
        const existing = next.get(conversationId);
        if (!existing) return prev;

        const reactionsMap = new Map(existing.reactions);
        const existing_reactions = reactionsMap.get(targetMessageId) || [];
        // Dedup
        if (
          existing_reactions.some(
            (r) => r.pubkey === reaction.pubkey && r.emoji === reaction.emoji
          )
        ) {
          return prev;
        }
        reactionsMap.set(targetMessageId, [...existing_reactions, reaction]);
        next.set(conversationId, { ...existing, reactions: reactionsMap });
        return next;
      });
    },
    []
  );

  const addMessage = useCallback(
    (rumor: Rumor, wrapId: string, myPubkey: string) => {
      // Dedup by rumor.id
      if (seenRumorIds.current.has(rumor.id)) return;
      seenRumorIds.current.add(rumor.id);

      // Handle kind 7 reaction rumors
      if (rumor.kind === 7) {
        addReactionToConversation(rumor, myPubkey);
        return;
      }

      const pTags = rumor.tags
        .filter((t) => t[0] === "p")
        .map((t) => t[1]);
      const conversationId = getConversationId(rumor.pubkey, pTags);
      const participants = conversationId.split("+");

      const msg: DMMessage = {
        id: rumor.id,
        wrapId,
        pubkey: rumor.pubkey,
        content: rumor.content,
        created_at: rumor.created_at,
        tags: rumor.tags,
      };

      // Load cached reactions for this conversation
      let cachedReactions = new Map<string, DMReaction[]>();
      try {
        const cacheKey = REACTION_CACHE_PREFIX + conversationId;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed: Record<string, DMReaction[]> = JSON.parse(cached);
          cachedReactions = new Map(Object.entries(parsed));
        }
      } catch {
        // ignore
      }

      setConversations((prev) => {
        const next = new Map(prev);
        const existing = next.get(conversationId);
        // Read threshold = the later of this conversation's own lastSeen and the
        // account-wide "mark all read" watermark, so a global mark-all covers
        // messages/conversations that hadn't loaded when it was clicked.
        const lastSeen = Math.max(
          getLastSeen(conversationId),
          getMarkAllTs(myPubkey)
        );

        if (existing) {
          if (existing.messages.some((m) => m.id === rumor.id)) return prev;

          const updatedMessages = [...existing.messages, msg].sort(
            (a, b) => a.created_at - b.created_at
          );
          const isUnread =
            rumor.pubkey !== myPubkey && rumor.created_at > lastSeen;
          next.set(conversationId, {
            ...existing,
            messages: updatedMessages,
            lastMessageAt: Math.max(existing.lastMessageAt, rumor.created_at),
            unreadCount: existing.unreadCount + (isUnread ? 1 : 0),
          });
        } else {
          const isUnread =
            rumor.pubkey !== myPubkey && rumor.created_at > lastSeen;
          next.set(conversationId, {
            id: conversationId,
            participants,
            messages: [msg],
            lastMessageAt: rumor.created_at,
            unreadCount: isUnread ? 1 : 0,
            reactions: cachedReactions,
          });
        }
        return next;
      });
    },
    [addReactionToConversation]
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
      // Clear giftwrap cache (and any legacy plaintext entries) on logout
      clearGiftWrapCache();
      return;
    }

    const myPubkey = user.pubkey;
    const privateKey = user.privateKey;

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

    const startSubscription = async () => {
      setLoading(true);

      const handle = dataLayer.observe(
        [{ kinds: [1059], "#p": [myPubkey] }],
        {
          onEvent: async (event: Event) => {
            // Dedup by gift-wrap id before any decryption so a re-observe never
            // re-decrypts (and never re-prompts an external signer for) a wrap
            // we've already handled this session.
            if (seenWrapIds.current.has(event.id)) return;
            seenWrapIds.current.add(event.id);

            // Persist the encrypted giftwrap so a reload can re-decrypt
            // without waiting for the relay to re-deliver it.
            // Only the encrypted blob is stored — no plaintext at rest.
            const eventToDecrypt = getCachedGiftWrap(event.id) ?? event;
            cacheGiftWrap(event.id, event);

            if (privateKey) {
              // Local key: decrypt instantly, no signer prompts
              const rumor = await unwrapGiftWrap(eventToDecrypt, privateKey);
              if (rumor) addMessage(rumor, event.id, myPubkey);
            } else {
              // External signer (Amber / NIP-07 / NIP-46): queue so only one
              // decrypt request is in-flight at a time — avoids bombarding the
              // user with simultaneous approval prompts on startup.
              decryptQueue.current = decryptQueue.current.then(async () => {
                if (decryptionRejected.current) return;
                const rumor = await unwrapGiftWrap(eventToDecrypt, undefined);
                if (rumor) {
                  addMessage(rumor, event.id, myPubkey);
                } else {
                  // null means the signer rejected or failed — stop asking
                  decryptionRejected.current = true;
                }
              });
            }
          },
          onEose: () => {
            setLoading(false);
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
      subRef.current?.unobserve();
      subRef.current = null;
    };
  }, [user, addMessage, refresh]);

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
      const now = Math.floor(Date.now() / 1000);
      setLastSeen(conversationId, now);

      setConversations((prev) => {
        const next = new Map(prev);
        const conv = next.get(conversationId);
        if (conv && conv.unreadCount > 0) {
          next.set(conversationId, { ...conv, unreadCount: 0 });
        }
        return next;
      });
    },
    []
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

  const unreadTotal = Array.from(conversations.values()).reduce(
    (sum, c) => sum + c.unreadCount,
    0
  );

  return (
    <DMContext.Provider
      value={{ conversations, sendMessage, sendReaction, markAsRead, markAllAsRead, unreadTotal, loading }}
    >
      {children}
    </DMContext.Provider>
  );
}
