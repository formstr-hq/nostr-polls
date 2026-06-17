import { useState, useCallback, useRef, useEffect } from "react";
import { Event, Filter, nip57 } from "nostr-tools";
import { useRelays } from "../../../../hooks/useRelays";
import { nostrRuntime } from "../../../../singletons";

export interface ZapRecord {
  zapEvent: Event;
  senderPubkey: string;
  sats: number;
}

function parseZapRecord(event: Event): ZapRecord {
  let sats = 0;
  const bolt11 = event.tags.find((t) => t[0] === "bolt11")?.[1];
  if (bolt11) {
    try { sats = nip57.getSatoshisAmountFromBolt11(bolt11) ?? 0; } catch {}
  }

  let senderPubkey = event.tags.find((t) => t[0] === "P")?.[1] ?? event.pubkey;
  const description = event.tags.find((t) => t[0] === "description")?.[1];
  if (description) {
    try {
      const req = JSON.parse(description) as Event;
      if (req.pubkey) senderPubkey = req.pubkey;
    } catch {}
  }

  return { zapEvent: event, senderPubkey, sats };
}

const FETCH_TIMEOUT_MS = 8000;

export const useZappedNotes = (user: any) => {
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [version, setVersion] = useState(0);
  const { relays } = useRelays();

  const oldestTimestampRef = useRef<number | null>(null);
  const loadingRef = useRef(false);
  // A fetch that times out keeps its subscription open so late-arriving events
  // (slow/flaky relays) still complete the fetch. Held here to tear down on the
  // next fetch or on unmount.
  const activeHandleRef = useRef<{ unsubscribe: () => void } | null>(null);

  // eventId -> ZapRecord[]
  const zapRecords = useCallback((): Map<string, ZapRecord[]> => {
    if (!user?.follows?.length) return new Map();

    const map = new Map<string, ZapRecord[]>();
    const zapEvents = nostrRuntime.query({ kinds: [9735] });

    for (const event of zapEvents) {
      const eTag = event.tags.find((t) => t[0] === "e")?.[1];
      if (!eTag) continue;

      const record = parseZapRecord(event);
      // Only include zaps sent by contacts
      if (!user.follows.includes(record.senderPubkey)) continue;

      const existing = map.get(eTag) ?? [];
      if (!existing.some((r) => r.zapEvent.id === event.id)) {
        map.set(eTag, [...existing, record]);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.follows, version]);

  const zappedEvents = useCallback((): Map<string, Event> => {
    if (!user?.follows?.length) return new Map();

    const noteIds = Array.from(zapRecords().keys());
    const events = nostrRuntime.query({ kinds: [1], ids: noteIds });

    const map = new Map<string, Event>();
    for (const e of events) map.set(e.id, e);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.follows, version, zapRecords]);

  const fetchZappedNotes = useCallback(async () => {
    if (!user?.follows?.length) { setInitialLoadDone(true); return; }
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadFailed(false);
    setLoading(true);
    // Close any previous subscription kept open after a timeout.
    activeHandleRef.current?.unsubscribe();
    activeHandleRef.current = null;

    const zapFilter: Filter = {
      kinds: [9735],
      "#P": user.follows, // uppercase P = sender pubkey in NIP-57
      limit: 30,
    } as any;

    if (oldestTimestampRef.current !== null) {
      (zapFilter as any).until = oldestTimestampRef.current;
    } else {
      (zapFilter as any).since = Math.floor(Date.now() / 1000) - 30 * 86400;
    }

    const zappedNoteIds: string[] = [];
    let fetchDone = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const finishFetch = (failed = false) => {
      if (fetchDone) return;
      fetchDone = true;
      clearTimeout(timeoutId);
      loadingRef.current = false;
      setLoading(false);
      setInitialLoadDone(true);
      if (failed) {
        setLoadFailed(true);
      } else {
        // Late events may have completed the fetch after a timeout flagged a
        // failure — clear it so the empty/Retry state is replaced by notes.
        setLoadFailed(false);
        setVersion((v) => v + 1);
      }
    };

    const handle = nostrRuntime.subscribe(relays, [zapFilter], {
      onEvent: (event) => {
        const eTag = event.tags.find((t) => t[0] === "e")?.[1];
        if (eTag) zappedNoteIds.push(eTag);
        if (
          oldestTimestampRef.current === null ||
          event.created_at < oldestTimestampRef.current
        ) {
          oldestTimestampRef.current = event.created_at;
        }
      },
      onEose: () => {
        handle.unsubscribe();
        activeHandleRef.current = null;
        const uniqueNoteIds = Array.from(new Set(zappedNoteIds));
        if (uniqueNoteIds.length > 0) {
          const noteHandle = nostrRuntime.subscribe(
            relays,
            [{ kinds: [1], ids: uniqueNoteIds }],
            {
              onEvent: () => {},
              onEose: () => {
                noteHandle.unsubscribe();
                activeHandleRef.current = null;
                finishFetch();
              },
            }
          );
          activeHandleRef.current = noteHandle;
        } else {
          finishFetch();
        }
      },
    });

    activeHandleRef.current = handle;

    // On timeout, keep the subscription open so relays that connect after our
    // 8s budget can still complete the fetch (the eventual EOSE runs the
    // note-fetch stage and renders). We only stop the spinner and surface the
    // empty/Retry state here — crucially we do NOT mark fetchDone, so that
    // later completion isn't blocked. The handle is closed on the next fetch,
    // on completion, or on unmount.
    timeoutId = setTimeout(() => {
      loadingRef.current = false;
      setLoading(false);
      setInitialLoadDone(true);
      setLoadFailed(true);
    }, FETCH_TIMEOUT_MS);
  }, [user?.follows, relays]);

  // Close any subscription kept open past a timeout when the hook unmounts.
  useEffect(() => {
    return () => {
      activeHandleRef.current?.unsubscribe();
      activeHandleRef.current = null;
    };
  }, []);

  const refreshZappedNotes = useCallback(() => {
    oldestTimestampRef.current = null;
    loadingRef.current = false;
    setVersion(0);
    setInitialLoadDone(false);
    setLoadFailed(false);
    fetchZappedNotes();
  }, [fetchZappedNotes]);

  return {
    zappedEvents: zappedEvents(),
    zapRecords: zapRecords(),
    fetchZappedNotes,
    refreshZappedNotes,
    loading,
    loadFailed,
    initialLoadDone,
  };
};
