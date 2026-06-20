import { useState, useCallback, useRef, useEffect } from "react";
import { Event, nip57 } from "nostr-tools";
import { dataLayer, type ObserveHandle } from "@formstr/local-relay";
import { collectOnce } from "../../../../dataLayer/collect";

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

/**
 * "Zapped" feed — notes that the user's contacts have zapped (kind 9735).
 *
 * Same two-stage shape as the reacted feed: observe the contacts' zap receipts,
 * then pull the referenced notes by id via a debounced one-shot collection. The
 * app keeps local maps fed by the data layer's streaming `observe`; the worker
 * owns every connection.
 */
export const useZappedNotes = (user: any) => {
  const [loading, setLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [recordMap, setRecordMap] = useState<Map<string, ZapRecord[]>>(new Map());
  const [noteMap, setNoteMap] = useState<Map<string, Event>>(new Map());

  const recordsRef = useRef(new Map<string, ZapRecord[]>());
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

  const fetchZappedNotes = useCallback(() => {
    if (!user?.follows?.length) {
      setInitialLoadDone(true);
      return;
    }
    setLoading(true);
    handleRef.current?.unobserve();
    handleRef.current = dataLayer.observe(
      [{ kinds: [9735], "#P": user.follows, limit: 100 } as any],
      {
        onEvent: (e) => {
          const eTag = e.tags.find((t) => t[0] === "e")?.[1];
          if (!eTag) return;
          const record = parseZapRecord(e);
          // Only include zaps sent by contacts
          if (!user.follows.includes(record.senderPubkey)) return;
          const existing = recordsRef.current.get(eTag) ?? [];
          if (!existing.some((r) => r.zapEvent.id === e.id)) {
            recordsRef.current.set(eTag, [...existing, record]);
            setRecordMap(new Map(recordsRef.current));
          }
          wantedIdsRef.current.add(eTag);
          scheduleNoteFetch();
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

  const refreshZappedNotes = useCallback(() => {
    fetchZappedNotes();
  }, [fetchZappedNotes]);

  return {
    zappedEvents: noteMap,
    zapRecords: recordMap,
    fetchZappedNotes,
    refreshZappedNotes,
    loading,
    loadFailed: false,
    initialLoadDone,
  };
};
