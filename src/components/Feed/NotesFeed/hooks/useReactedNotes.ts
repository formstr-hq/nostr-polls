import { useState, useCallback, useRef, useEffect } from "react";
import { Event } from "nostr-tools";
import { dataLayer, type ObserveHandle } from "@formstr/local-relay";
import { collectOnce } from "../../../../dataLayer/collect";

/**
 * "Reacted" feed — notes that the user's contacts have reacted to (kind 7).
 *
 * Two stages the worker can't express as a single scope: (1) observe the
 * contacts' reactions, (2) pull the referenced notes by id. We keep app-local
 * maps fed by the data layer's streaming `observe` (there is no synchronous
 * store query) and fetch the referenced notes with a debounced one-shot
 * collection. The worker still owns every connection.
 */
export const useReactedNotes = (user: any) => {
  const [loading, setLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [reactionMap, setReactionMap] = useState<Map<string, Event>>(new Map());
  const [noteMap, setNoteMap] = useState<Map<string, Event>>(new Map());

  const reactionsRef = useRef(new Map<string, Event>());
  const notesRef = useRef(new Map<string, Event>());
  const wantedIdsRef = useRef(new Set<string>());
  const handleRef = useRef<ObserveHandle | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleNoteFetch = useCallback(() => {
    if (noteTimerRef.current) return;
    noteTimerRef.current = setTimeout(async () => {
      noteTimerRef.current = null;
      const ids = Array.from(wantedIdsRef.current).filter((id) => !notesRef.current.has(id));
      if (!ids.length) return;
      const events = await collectOnce([{ kinds: [1], ids }]);
      for (const e of events) notesRef.current.set(e.id, e);
      if (events.length) setNoteMap(new Map(notesRef.current));
    }, 300);
  }, []);

  const fetchReactedNotes = useCallback(() => {
    if (!user?.follows?.length) {
      setInitialLoadDone(true);
      return;
    }
    setLoading(true);
    handleRef.current?.unobserve();
    handleRef.current = dataLayer.observe(
      [{ kinds: [7], authors: user.follows, limit: 100 }],
      {
        onEvent: (e) => {
          reactionsRef.current.set(e.id, e);
          const noteId = e.tags.find((t) => t[0] === "e")?.[1];
          if (noteId) {
            wantedIdsRef.current.add(noteId);
            scheduleNoteFetch();
          }
          setReactionMap(new Map(reactionsRef.current));
        },
        onEose: () => {
          setLoading(false);
          setInitialLoadDone(true);
          scheduleNoteFetch();
        },
      }
    );
  }, [user?.follows, scheduleNoteFetch]);

  useEffect(() => {
    return () => {
      handleRef.current?.unobserve();
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    };
  }, []);

  const refreshReactedNotes = useCallback(() => {
    fetchReactedNotes();
  }, [fetchReactedNotes]);

  return {
    reactedEvents: noteMap,
    reactionEvents: reactionMap,
    fetchReactedNotes,
    refreshReactedNotes,
    loading,
    loadFailed: false,
    initialLoadDone,
  };
};
