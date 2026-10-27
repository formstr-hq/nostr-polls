import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { Event, Filter } from "nostr-tools";
import { nip13 } from "nostr-tools";
import { dataLayer, type ObserveHandle } from "@formstr/local-relay";

export interface OptionResult {
  count: number;
  percentage: number;
  responders: string[];
  /** Maps responder pubkey → their vote event ID, for relay lookups */
  responderEventIds: Map<string, string>;
}

/**
 * Subscribes to vote events for a poll and returns per-option results.
 *
 * Results are CACHE-FIRST: a local-only read runs as soon as the poll renders,
 * so the bars are already populated when the user taps "Results" (whenever the
 * votes were previously seen by this client). The networked subscription only
 * starts on demand. Both paths keep prior results — toggling the panel never
 * blanks the bars back to 0% while a read is in flight.
 */
export function usePollResults(
  pollEvent: Event,
  difficulty: number,
  filterPubkeys: string[],
  enabled: boolean
): { results: Map<string, OptionResult>; totalVotes: number; loading: boolean } {
  const [responses, setResponses] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const subRef = useRef<ObserveHandle | null>(null);

  const append = useCallback((event: Event) => {
    setResponses((prev) => {
      if (prev.some((e) => e.id === event.id)) return prev;
      return [...prev, event];
    });
    setLoading(false);
  }, []);

  const buildFilter = useCallback((): Filter => {
    const pollExpiration = pollEvent.tags.find((t) => t[0] === "endsAt")?.[1];
    const resultFilter: Filter = {
      "#e": [pollEvent.id],
      kinds: [1070, 1018],
    } as Filter;

    if (difficulty) (resultFilter as any)["#W"] = [difficulty.toString()];
    if (filterPubkeys.length) resultFilter.authors = filterPubkeys;
    if (pollExpiration) resultFilter.until = Number(pollExpiration);
    return resultFilter;
  }, [pollEvent.id, pollEvent.tags, difficulty, filterPubkeys]);

  // Reset when the row is reused for a different poll.
  useEffect(() => {
    setResponses([]);
    setLoading(false);
  }, [pollEvent.id]);

  // Cache-first preload: paint results from the local store the moment the poll
  // is on screen, without touching the network. Closed at local EOSE so it does
  // not keep a live subscription per visible poll.
  useEffect(() => {
    let handle: ObserveHandle | null = null;
    handle = dataLayer.observe(
      [buildFilter()],
      {
        onEvent: append,
        onEose: () => handle?.unobserve(),
      },
      { localOnly: true }
    );
    return () => handle?.unobserve();
  }, [buildFilter, append]);

  // Networked read, on demand only.
  useEffect(() => {
    if (!enabled) return;

    setLoading(true);
    subRef.current?.unobserve();
    subRef.current = dataLayer.observe(
      [buildFilter()],
      {
        onEvent: append,
        onEose: () => setLoading(false),
      },
      // A results click is a user action: don't sit behind every standing feed
      // subscription in each relay's REQ queue.
      { urgent: true }
    );

    return () => {
      subRef.current?.unobserve();
      subRef.current = null;
    };
  }, [enabled, buildFilter, append]);

  // A request that never gets an answer must not leave the panel spinning
  // forever; the bars still show whatever the cache contributed.
  useEffect(() => {
    if (!enabled || !loading) return;
    const timer = setTimeout(() => setLoading(false), 5000);
    return () => clearTimeout(timer);
  }, [enabled, loading]);

  const options = useMemo(
    () => pollEvent.tags.filter((t) => t[0] === "option"),
    [pollEvent.tags]
  );

  // Deduplicate: keep only the latest valid response per pubkey
  const uniqueResponses = useMemo(() => {
    const map = new Map<string, Event>();
    for (const event of responses) {
      if (difficulty && nip13.getPow(event.id) < difficulty) continue;
      const existing = map.get(event.pubkey);
      if (!existing || event.created_at > existing.created_at) {
        map.set(event.pubkey, event);
      }
    }
    return Array.from(map.values());
  }, [responses, difficulty]);

  const results = useMemo(() => {
    const counts = new Map<string, { count: number; responders: string[]; responderEventIds: Map<string, string> }>();
    for (const opt of options) counts.set(opt[1], { count: 0, responders: [], responderEventIds: new Map() });

    for (const event of uniqueResponses) {
      for (const tag of event.tags) {
        if (tag[0] === "response") {
          const entry = counts.get(tag[1]);
          if (entry && !entry.responders.includes(event.pubkey)) {
            entry.count++;
            entry.responders.push(event.pubkey);
            entry.responderEventIds.set(event.pubkey, event.id);
          }
        }
      }
    }

    const total = Array.from(counts.values()).reduce((s, v) => s + v.count, 0);
    const out = new Map<string, OptionResult>();
    Array.from(counts.entries()).forEach(([id, v]) => {
      out.set(id, {
        ...v,
        percentage: total > 0 ? (v.count / total) * 100 : 0,
      });
    });
    return out;
  }, [uniqueResponses, options]);

  return {
    results,
    totalVotes: uniqueResponses.length,
    // Only surface "loading" while there is nothing to show. Streaming more
    // votes into an already-populated panel must not replace it with a spinner.
    loading: enabled && loading && uniqueResponses.length === 0,
  };
}
