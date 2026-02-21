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
import { nostrRuntime } from "../singletons";
import {
  fetchInboxRelays,
  unwrapGiftWrap,
  wrapAndSendDM,
  wrapAndSendReaction,
  getConversationId,
  Rumor,
  RelayPublish,
} from "../nostr/nip17";
import { defaultRelays } from "../nostr";

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
  publishes: RelayPublish[];
  retryWraps: { event: Event; relays: string[] }[];
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

const CACHE_PREFIX = "dm_cache_";
const LAST_SEEN_PREFIX = "dm_lastseen_";
const REACTION_CACHE_PREFIX = "dm_reactions_";

function getCachedRumor(wrapId: string): DMMessage | null {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + wrapId);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function setCachedRumor(wrapId: string, msg: DMMessage): void {
  try {
    localStorage.setItem(CACHE_PREFIX + wrapId, JSON.stringify(msg));
  } catch {
    // localStorage full, ignore
  }
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

export function DMProvider({ children }: { children: ReactNode }) {
  const { user } = useUserContext();
  const [conversations, setConversations] = useState<Map<string, Conversation>>(
    new Map()
  );
  const [loading, setLoading] = useState(false);
  const seenRumorIds = useRef<Set<string>>(new Set());
  const subRef = useRef<{ unsubscribe: () => void } | null>(null);

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

      // Cache decrypted message
      setCachedRumor(wrapId, msg);

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
        const lastSeen = getLastSeen(conversationId);

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
      subRef.current?.unsubscribe();
      subRef.current = null;
      return;
    }

    const myPubkey = user.pubkey;
    const privateKey = user.privateKey;

    const startSubscription = async () => {
      setLoading(true);

      const inboxRelays = await fetchInboxRelays(myPubkey);
      // Use both inbox relays and default relays to catch messages
      const relaysToUse = Array.from(new Set([...inboxRelays, ...defaultRelays]));

      const handle = nostrRuntime.subscribe(
        relaysToUse,
        [{ kinds: [1059], "#p": [myPubkey] }],
        {
          onEvent: async (event: Event) => {
            // Check cache first
            const cached = getCachedRumor(event.id);
            if (cached) {
              const fakeRumor: Rumor = {
                id: cached.id,
                pubkey: cached.pubkey,
                content: cached.content,
                created_at: cached.created_at,
                tags: cached.tags,
                kind: (cached as any).kind || 14,
              };
              addMessage(fakeRumor, event.id, myPubkey);
              return;
            }

            // Decrypt the gift wrap
            const rumor = await unwrapGiftWrap(event, privateKey);
            if (rumor) {
              addMessage(rumor, event.id, myPubkey);
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

    return () => {
      subRef.current?.unsubscribe();
      subRef.current = null;
    };
  }, [user, addMessage]);

  const sendMessage = useCallback(
    async (
      recipientPubkey: string,
      content: string,
      replyToId?: string
    ): Promise<SendTracking> => {
      if (!user) throw new Error("Must be logged in to send DMs");

      const { rumor, publishes, retryWraps } = await wrapAndSendDM(
        recipientPubkey,
        content,
        user.privateKey,
        replyToId
      );

      // Optimistically add to state immediately
      addMessage(rumor, `local_${rumor.id}`, user.pubkey);

      return { rumorId: rumor.id, publishes, retryWraps };
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
    const now = Math.floor(Date.now() / 1000);

    setConversations((prev) => {
      const next = new Map(prev);
      Array.from(next.entries()).forEach(([id, conv]) => {
        if (conv.unreadCount > 0) {
          setLastSeen(id, now);
          next.set(id, { ...conv, unreadCount: 0 });
        }
      });
      return next;
    });
  }, []);

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
