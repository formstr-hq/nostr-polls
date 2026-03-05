// src/hooks/useMyTopicsFeed.ts

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Event } from "nostr-tools";
import { pool, nostrRuntime } from "../singletons";
import { useRelays } from "./useRelays";
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

  const [notes, setNotes] = useState<Map<string, TopicNote>>(new Map());
  const [feedMode, setFeedMode] = useState<FeedMode>("global");
  const [showAnyway, setShowAnyway] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
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

  const { headerProgress } = useFeedScroll();
  const isScrolledDown = headerProgress > 0;
  const isScrolledDownRef = useRef(false);
  useEffect(() => { isScrolledDownRef.current = isScrolledDown; }, [isScrolledDown]);

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

    // force rerender
    setNotes((prev) => new Map(prev));
    setModerationVersion((v) => v + 1);
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
      setNotes((prev) => new Map(prev));
      setModerationVersion((v) => v + 1);
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

  useEffect(() => {
    if (!relays.length || myTopics.size === 0) {
      setLoading(false);
      return;
    }

    const topics = Array.from(myTopics);

    const sub = nostrRuntime.subscribe(
      relays,
      [
        { kinds: [1], "#t": topics, limit: 200 },
        { kinds: [OFFTOPIC_KIND], "#t": topics, limit: 500 },
        { kinds: [5], "#k": [String(OFFTOPIC_KIND)], limit: 500 },
      ],
      {
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

            if (isScrolledDownRef.current) {
              pendingNotesRef.current.set(event.id, { event, topics });
              setPendingCount((c) => c + 1);
            } else {
              setNotes((prev) => {
                const next = new Map(prev);
                next.set(event.id, { event, topics });
                return next;
              });
            }
            setLoading(false);
          }
        },
      }
    );
    const timeout = setTimeout(() => setLoading(false), 10000);

    return () => {
      sub.unsubscribe();
      clearTimeout(timeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relays, myTopics]);

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

      await pool.publish(relays, signed);

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
      const events = await nostrRuntime.fetchOne(relays, {
        kinds: [OFFTOPIC_KIND],
        authors: [user.pubkey],
        "#t": topicValues,
      });
      if (events) {
        processModerationEvent(events);
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

    await pool.publish(relays, signed);

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
    moderatorsByTopic,
    selectedModsByTopic,
    setSelectedModeratorsForTopic,
    pendingCount,
    mergeNewNotes,
  };
}
