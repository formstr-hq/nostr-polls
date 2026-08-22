// src/hooks/useMyTopicsFeed.ts

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Event } from "nostr-tools";
import { dataLayer, type ObserveHandle } from "@formstr/local-relay";
import { collectOnce } from "../dataLayer/collect";
import { useRelays } from "./useRelays";
import { useRelayRefresh } from "../dataLayer/hooks";
import { isRelayHydrated } from "../dataLayer/relayRefresh";
import { useUserContext } from "./useUserContext";
import { signEvent } from "../nostr";
import {
  loadModeratorPrefs,
  saveModeratorPrefs,
} from "../utils/localStorage";
import { useFeedScroll } from "../contexts/FeedScrollContext";

export const OFFTOPIC_KIND = 1011;

type TopicModeration = {
  offTopicNotes: Map<string, Map<string, string>>; // noteId -> (moderatorPubkey -> moderationEventId)
  blockedUsers: Map<string, Map<string, string>>; // targetPubkey -> (moderatorPubkey -> moderationEventId)
};

type TopicNote = {
  event: Event;
  topics: string[];
};

type FeedMode = "unfiltered" | "global" | "contacts";

export function useMyTopicsFeed(myTopics: Set<string>) {
  const { relays } = useRelays();
  const { user, requestLogin } = useUserContext();
  const relayRefresh = useRelayRefresh();

  const [notes, setNotes] = useState<Map<string, TopicNote>>(new Map());
  const [feedMode, setFeedMode] = useState<FeedMode>("global");
  const [showAnyway, setShowAnyway] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [moderationVersion, setModerationVersion] = useState(0);
  const [selectedModsByTopic, setSelectedModsByTopic] = useState<
    Map<string, string[]>
  >(new Map());
  const [pendingCount, setPendingCount] = useState(0);

  const moderationByTopic = useRef<Map<string, TopicModeration>>(new Map());
  const seenNotes = useRef<Set<string>>(new Set());
  const seenModeration = useRef<Set<string>>(new Set());
  const deletedModerationIds = useRef<Set<string>>(new Set());
  const pendingNotesRef = useRef<Map<string, TopicNote>>(new Map());
  const initialLoadDoneRef = useRef(false);

  const { getScrollTop } = useFeedScroll();

  /* ------------------ streaming update coalescing ------------------ */
  // During initial load a topic can stream hundreds of notes plus hundreds of
  // moderation/deletion events. Committing a setState per event re-runs
  // resolvedNotes and re-reconciles the virtualized feed hundreds of times,
  // freezing the app. Instead we buffer note inserts and a "moderation dirty"
  // flag in refs and flush them at most once per frame-ish window.
  const noteBufferRef = useRef<Map<string, TopicNote>>(new Map());
  const moderationDirtyRef = useRef(false);
  const flushTimer = useRef<number | null>(null);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current !== null) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      if (noteBufferRef.current.size > 0) {
        const buffered = noteBufferRef.current;
        noteBufferRef.current = new Map();
        setNotes((prev) => {
          const next = new Map(prev);
          buffered.forEach((v, k) => next.set(k, v));
          return next;
        });
      }
      if (moderationDirtyRef.current) {
        moderationDirtyRef.current = false;
        // resolvedNotes / moderatorsByTopic recompute off moderationVersion.
        setModerationVersion((v) => v + 1);
      }
    }, 150);
  }, []);

  /* ------------------ moderation processing ------------------ */

  const processModerationEvent = (event: Event) => {
    if (seenModeration.current.has(event.id)) return;
    seenModeration.current.add(event.id);

    if (deletedModerationIds.current.has(event.id)) return;

    const topicTags = event.tags
      .filter((t) => t[0] === "t")
      .map((t) => t[1]);
    const eTags = event.tags
      .filter((t) => t[0] === "e")
      .map((t) => t[1]);
    const pTags = event.tags
      .filter((t) => t[0] === "p")
      .map((t) => t[1]);

    for (const topic of topicTags) {
      if (!myTopics.has(topic)) continue;

      if (!moderationByTopic.current.has(topic)) {
        moderationByTopic.current.set(topic, {
          offTopicNotes: new Map(),
          blockedUsers: new Map(),
        });
      }

      const mod = moderationByTopic.current.get(topic)!;

      for (const noteId of eTags) {
        if (!mod.offTopicNotes.has(noteId)) {
          mod.offTopicNotes.set(noteId, new Map());
        }
        mod.offTopicNotes.get(noteId)!.set(event.pubkey, event.id);
      }

      for (const pubkey of pTags) {
        if (!mod.blockedUsers.has(pubkey)) {
          mod.blockedUsers.set(pubkey, new Map());
        }
        mod.blockedUsers.get(pubkey)!.set(event.pubkey, event.id);
      }
    }

    // Coalesce the rerender; resolvedNotes recomputes off moderationVersion.
    moderationDirtyRef.current = true;
    scheduleFlush();
  };

  const processDeletionEvent = (event: Event) => {
    const targetIds = new Set(
      event.tags.filter((t) => t[0] === "e").map((t) => t[1])
    );

    let changed = false;

    // Scan all topics' moderation data for targeted event IDs
    moderationByTopic.current.forEach((mod) => {
      mod.offTopicNotes.forEach((moderators) => {
        moderators.forEach((eventId, pubkey) => {
          if (targetIds.has(eventId) && pubkey === event.pubkey) {
            moderators.delete(pubkey);
            changed = true;
          }
        });
      });
      mod.blockedUsers.forEach((moderators) => {
        moderators.forEach((eventId, pubkey) => {
          if (targetIds.has(eventId) && pubkey === event.pubkey) {
            moderators.delete(pubkey);
            changed = true;
          }
        });
      });
    });

    targetIds.forEach((id) => deletedModerationIds.current.add(id));

    if (changed) {
      moderationDirtyRef.current = true;
      scheduleFlush();
    }
  };

  /* ------------------ derive moderators by topic ------------------ */

  const moderatorsByTopic = useMemo(() => {
    const result = new Map<string, string[]>();
    moderationByTopic.current.forEach((mod, topic) => {
      const modSet = new Set<string>();
      mod.offTopicNotes.forEach((moderators) => {
        moderators.forEach((eventId, pubkey) => {
          if (!deletedModerationIds.current.has(eventId)) {
            modSet.add(pubkey);
          }
        });
      });
      mod.blockedUsers.forEach((moderators) => {
        moderators.forEach((eventId, pubkey) => {
          if (!deletedModerationIds.current.has(eventId)) {
            modSet.add(pubkey);
          }
        });
      });
      if (modSet.size > 0) {
        result.set(topic, Array.from(modSet));
      }
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderationVersion]);

  // Initialize selected moderators from localStorage when moderators change
  useEffect(() => {
    setSelectedModsByTopic((prev) => {
      const next = new Map(prev);
      let changed = false;
      moderatorsByTopic.forEach((mods, topic) => {
        if (!next.has(topic)) {
          next.set(topic, loadModeratorPrefs(topic, mods));
          changed = true;
        } else {
          // Add any new moderators that appeared
          const current = next.get(topic)!;
          const newMods = mods.filter((m) => !current.includes(m));
          if (newMods.length > 0) {
            next.set(topic, [...current, ...newMods]);
            changed = true;
          }
        }
      });
      return changed ? next : prev;
    });
  }, [moderatorsByTopic]);

  const setSelectedModeratorsForTopic = useCallback(
    (topic: string, selected: string[]) => {
      setSelectedModsByTopic((prev) => {
        const next = new Map(prev);
        next.set(topic, selected);
        return next;
      });
      saveModeratorPrefs(topic, selected);
    },
    []
  );

  /* ------------------ subscriptions ------------------ */

  const subRef = useRef<ObserveHandle | null>(null);

  const startSubscription = useCallback((fresh?: boolean) => {
    if (!relays.length || myTopics.size === 0) {
      setLoading(false);
      return;
    }

    if (subRef.current) {
      subRef.current.unobserve();
      subRef.current = null;
    }

    const topics = Array.from(myTopics);

    if (!fresh) initialLoadDoneRef.current = false;

    const since7d = Math.floor(Date.now() / 1000) - 7 * 86400;
    const sub = dataLayer.observe(
      [
        { kinds: [1], "#t": topics, since: since7d, limit: 200 },
        { kinds: [OFFTOPIC_KIND], "#t": topics, limit: 500 },
        { kinds: [5], "#k": [String(OFFTOPIC_KIND)], limit: 500 },
      ],
      {
        onEose: () => {
          // A pre-hydration EOSE means the store was still loading, not
          // actually empty — the relayRefresh-dep restart (below) retries once
          // hydration completes, so hold off on clearing the spinner here.
          // The hard timeout further down still fires regardless.
          if (!isRelayHydrated()) return;
          initialLoadDoneRef.current = true;
          if (fresh) {
            setRefreshing(false);
          } else {
            setLoading(false);
          }
        },
        onEvent: (event) => {
          /* ---- deletion events ---- */
          if (event.kind === 5) {
            processDeletionEvent(event);
            return;
          }

          /* ---- moderation events ---- */
          if (event.kind === OFFTOPIC_KIND) {
            processModerationEvent(event);
            return;
          }

          /* ---- notes ---- */
          if (event.kind === 1) {
            if (seenNotes.current.has(event.id)) return;
            seenNotes.current.add(event.id);

            const topics = event.tags
              .filter((t) => t[0] === "t" && myTopics.has(t[1]))
              .map((t) => t[1]);

            if (topics.length === 0) return;

            if (initialLoadDoneRef.current && getScrollTop() > 0) {
              pendingNotesRef.current.set(event.id, { event, topics });
              setPendingCount((c) => c + 1);
            } else {
              // Buffer and flush in batches to avoid a setState-per-note storm.
              noteBufferRef.current.set(event.id, { event, topics });
              scheduleFlush();
            }
          }
        },
      }
    );

    subRef.current = sub;

    const timeout = setTimeout(() => {
      if (fresh) setRefreshing(false);
      else setLoading(false);
    }, 10000);

    return () => {
      sub.unobserve();
      clearTimeout(timeout);
      if (flushTimer.current !== null) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      noteBufferRef.current.clear();
      moderationDirtyRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relays, myTopics, relayRefresh]);

  useEffect(() => {
    const cleanup = startSubscription();
    return cleanup;
  }, [startSubscription]);

  const refreshNotes = useCallback(() => {
    setPendingCount(0);
    pendingNotesRef.current.clear();
    setRefreshing(true);
    // Temporarily treat incoming events as direct (not pending) during refresh
    initialLoadDoneRef.current = false;
    startSubscription(true);
  }, [startSubscription]);

  /* ------------------ moderation resolution ------------------ */

  const resolvedNotes = useMemo(() => {
    return Array.from(notes.values())
      .map(({ event, topics }) => {
        let hidden = false;
        let moderators = new Set<string>();
        let moderatedTopics = new Set<string>();
        let myOffTopicTopics: string[] = [];
        let myBlockedUserTopics: string[] = [];

        for (const topic of topics) {
          const mod = moderationByTopic.current.get(topic);
          if (!mod) continue;

          const offTopic = mod.offTopicNotes.get(event.id);
          const blocked = mod.blockedUsers.get(event.pubkey);

          // Track topics where current user has active (non-deleted) off-topic moderations
          if (user && offTopic) {
            const myEventId = offTopic.get(user.pubkey);
            if (myEventId && !deletedModerationIds.current.has(myEventId)) {
              myOffTopicTopics.push(topic);
            }
          }

          // Track topics where current user has active (non-deleted) blocked-user moderations
          if (user && blocked) {
            const myEventId = blocked.get(user.pubkey);
            if (myEventId && !deletedModerationIds.current.has(myEventId)) {
              myBlockedUserTopics.push(topic);
            }
          }

          if (feedMode !== "unfiltered") {
            // Collect active (non-deleted) moderator pubkeys
            const relevantMods = new Set<string>();
            if (offTopic) {
              offTopic.forEach((eventId, pubkey) => {
                if (!deletedModerationIds.current.has(eventId)) {
                  relevantMods.add(pubkey);
                }
              });
            }
            if (blocked) {
              blocked.forEach((eventId, pubkey) => {
                if (!deletedModerationIds.current.has(eventId)) {
                  relevantMods.add(pubkey);
                }
              });
            }

            // Filter by selected moderators for this topic
            const selectedForTopic = selectedModsByTopic.get(topic);

            let visibleMods = Array.from(relevantMods);

            // Apply contacts filter
            if (feedMode === "contacts" && user?.follows) {
              visibleMods = visibleMods.filter((m) =>
                user.follows!.includes(m)
              );
            }

            // Apply per-topic moderator selection
            if (selectedForTopic) {
              visibleMods = visibleMods.filter((m) =>
                selectedForTopic.includes(m)
              );
            }

            if (visibleMods.length > 0) {
              hidden = true;
              moderatedTopics.add(topic);
              visibleMods.forEach((m) => moderators.add(m));
            }
          }
        }

        if (showAnyway.has(event.id)) hidden = false;

        return {
          event,
          topics,
          hidden,
          moderators,
          moderatedTopics,
          myOffTopicTopics,
          myBlockedUserTopics,
        };
      })
      .sort((a, b) => b.event.created_at - a.event.created_at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, feedMode, showAnyway, user?.follows, selectedModsByTopic, user, moderationVersion]);

  /* ------------------ merge pending notes ------------------ */

  const mergeNewNotes = useCallback(() => {
    setNotes((prev) => {
      const next = new Map(prev);
      pendingNotesRef.current.forEach((value, key) => next.set(key, value));
      pendingNotesRef.current.clear();
      return next;
    });
    setPendingCount(0);
  }, []);

  /* ------------------ actions ------------------ */

  const toggleShowAnyway = (noteId: string) => {
    setShowAnyway((prev) => {
      const next = new Set(prev);
      next.has(noteId) ? next.delete(noteId) : next.add(noteId);
      return next;
    });
  };

  const publishModeration = async (
    type: "off-topic" | "remove-user",
    note: Event,
    topics: string[]
  ) => {
    if (!user) {
      requestLogin();
      return;
    }

    for (const topic of topics) {
      const tags =
        type === "off-topic"
          ? [
              ["t", topic],
              ["e", note.id],
            ]
          : [
              ["t", topic],
              ["p", note.pubkey],
            ];

      const signed = await signEvent({
        kind: OFFTOPIC_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content:
          type === "off-topic"
            ? "Marked as off-topic"
            : "Removed user from topic",
      });

      await dataLayer.publishEvent(signed);

      // Optimistic local update
      if (!moderationByTopic.current.has(topic)) {
        moderationByTopic.current.set(topic, {
          offTopicNotes: new Map(),
          blockedUsers: new Map(),
        });
      }
      const mod = moderationByTopic.current.get(topic)!;
      if (type === "off-topic") {
        if (!mod.offTopicNotes.has(note.id))
          mod.offTopicNotes.set(note.id, new Map());
        mod.offTopicNotes.get(note.id)!.set(user.pubkey, signed.id);
      } else {
        if (!mod.blockedUsers.has(note.pubkey))
          mod.blockedUsers.set(note.pubkey, new Map());
        mod.blockedUsers.get(note.pubkey)!.set(user.pubkey, signed.id);
      }
    }

    // Force re-render for immediate UI feedback
    setNotes((prev) => new Map(prev));
    setModerationVersion((v) => v + 1);

    // Refetch own moderation events to ensure consistency
    try {
      const topicValues = Array.from(new Set(topics));
      const collected = await collectOnce([
        {
          kinds: [OFFTOPIC_KIND],
          authors: [user.pubkey],
          "#t": topicValues,
        },
      ]);
      for (const event of collected) {
        processModerationEvent(event);
      }
    } catch (e) {
      console.error("Failed to refetch moderation events:", e);
    }
  };

  const publishUnmoderation = async (
    type: "off-topic" | "remove-user",
    note: Event,
    topics: string[]
  ) => {
    if (!user) {
      requestLogin();
      return;
    }

    const moderationEventIds: string[] = [];

    for (const topic of topics) {
      const mod = moderationByTopic.current.get(topic);
      if (!mod) continue;

      let eventId: string | undefined;
      if (type === "off-topic") {
        eventId = mod.offTopicNotes.get(note.id)?.get(user.pubkey);
      } else {
        eventId = mod.blockedUsers.get(note.pubkey)?.get(user.pubkey);
      }

      if (eventId && !deletedModerationIds.current.has(eventId)) {
        moderationEventIds.push(eventId);
      }
    }

    if (moderationEventIds.length === 0) return;

    const tags: string[][] = [
      ...moderationEventIds.map((id) => ["e", id]),
      ["k", String(OFFTOPIC_KIND)],
    ];

    const signed = await signEvent({
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: "Undo moderation",
    });

    await dataLayer.publishEvent(signed);

    // Optimistic local update
    for (const id of moderationEventIds) {
      deletedModerationIds.current.add(id);
    }

    // Remove from moderation maps
    for (const topic of topics) {
      const mod = moderationByTopic.current.get(topic);
      if (!mod) continue;

      if (type === "off-topic") {
        mod.offTopicNotes.get(note.id)?.delete(user.pubkey);
      } else {
        mod.blockedUsers.get(note.pubkey)?.delete(user.pubkey);
      }
    }

    setNotes((prev) => new Map(prev));
    setModerationVersion((v) => v + 1);
  };

  return {
    notes: resolvedNotes,
    feedMode,
    setFeedMode,
    toggleShowAnyway,
    publishModeration,
    publishUnmoderation,
    loading,
    refreshing,
    refreshNotes,
    moderatorsByTopic,
    selectedModsByTopic,
    setSelectedModeratorsForTopic,
    pendingCount,
    mergeNewNotes,
  };
}
