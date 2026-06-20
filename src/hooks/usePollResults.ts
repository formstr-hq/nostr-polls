import { useEffect, useRef, useMemo, useState } from "react";
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
 * The subscription is lazy — it only starts when `enabled` becomes true,
 * so polls that are scrolled past without interaction incur no relay load.
 */
export function usePollResults(
  pollEvent: Event,
  difficulty: number,
  filterPubkeys: string[],
  enabled: boolean
): { results: Map<string, OptionResult>; totalVotes: number } {
  const [responses, setResponses] = useState<Event[]>([]);
  const subRef = useRef<ObserveHandle | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // Tear down any previous subscription (e.g. filterPubkeys changed)
    subRef.current?.unobserve();
    setResponses([]);

    const pollExpiration = pollEvent.tags.find((t) => t[0] === "endsAt")?.[1];

    const resultFilter: Filter = {
      "#e": [pollEvent.id],
      kinds: [1070, 1018],
    } as Filter;

    if (difficulty) (resultFilter as any)["#W"] = [difficulty.toString()];
    if (filterPubkeys.length) resultFilter.authors = filterPubkeys;
    if (pollExpiration) resultFilter.until = Number(pollExpiration);

    subRef.current = dataLayer.observe([resultFilter], {
      onEvent: (event: Event) => {
        setResponses((prev) => [...prev, event]);
      },
    });

    return () => {
      subRef.current?.unobserve();
      subRef.current = null;
    };
  }, [enabled, pollEvent.id, pollEvent.tags, difficulty, filterPubkeys]);

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

  return { results, totalVotes: uniqueResponses.length };
}
