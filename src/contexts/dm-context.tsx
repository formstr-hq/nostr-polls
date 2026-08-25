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

      // If the conversation exists, attach directly; otherwise buffer it so the
      // conversation (created later from its parent message) picks it up.
      setConversations((prev) => {
        const existing = prev.get(conversationId);
        if (!existing) {
          // Parent message hasn't landed yet — hold here; `addMessage`
          // (which creates the conversation) drains the buffer.
          const bucket = pendingReactions.get(conversationId) ?? {};
          const list = bucket[targetMessageId] ?? [];
          if (
            !list.some(
              (r) => r.pubkey === reaction.pubkey && r.emoji === reaction.emoji
            )
          ) {
            list.push(reaction);
            bucket[targetMessageId] = list;
            pendingReactions.set(conversationId, bucket);
          }
          return prev;
        }

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
        const next = new Map(prev);
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

      // Reactions that out-raced this conversation's creation (a kind-7 rumor
      // replayed before its parent message) — drain them now.
      const buffered = pendingReactions.get(conversationId) ?? null;
      if (buffered) pendingReactions.delete(conversationId);
      const initialReactions: Map<string, DMReaction[]> | null = buffered
        ? new Map(Object.entries(buffered))
        : null;

      setConversations((prev) => {
        const next = new Map(prev);
        const existing = next.get(conversationId);
        // Read threshold = the later of this conversation's own lastSeen and
        // the account-wide "mark all read" watermark (handled inside the
        // module), so a global mark-all covers messages/conversations that
        // hadn't loaded when it was clicked.
        const lastSeen = getLastSeen(myPubkey, conversationId);

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
            reactions: initialReactions ?? new Map<string, DMReaction[]>(),
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

            if (privateKey) {
              // Local key: decrypt instantly, no signer prompts
              const rumor = await unwrapGiftWrap(event, privateKey);
              if (rumor) addMessage(rumor, event.id, myPubkey);
            } else {
              // External signer (Amber / NIP-07 / NIP-46): queue so only one
              // decrypt request is in-flight at a time — avoids bombarding the
              // user with simultaneous approval prompts on startup.
              decryptQueue.current = decryptQueue.current.then(async () => {
               if (decryptionRejected.current) return;
                 const rumor = await unwrapGiftWrap(event, undefined);
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
  }, [user, addMessage, refresh, applyReadStateToConversations]);

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
