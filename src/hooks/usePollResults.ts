import { useEffect, useRef, useMemo, useState } from "react";
import { Event, Filter } from "nostr-tools";
import { nip13 } from "nostr-tools";
import { nostrRuntime } from "../singletons";
import { SubscriptionHandle } from "../nostrRuntime/types";
import { useRelays } from "./useRelays";

export interface OptionResult {
  count: number;
  percentage: number;
  responders: string[];
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
  const subRef = useRef<SubscriptionHandle | null>(null);
  const { relays: userRelays } = useRelays();

  useEffect(() => {
    if (!enabled) return;

    // Tear down any previous subscription (e.g. filterPubkeys changed)
    subRef.current?.unsubscribe();
    setResponses([]);

    const pollRelays = pollEvent.tags
      .filter((t) => t[0] === "relay")
      .map((t) => t[1]);
    const finalRelays = Array.from(new Set([...pollRelays, ...userRelays]));
    const pollExpiration = pollEvent.tags.find((t) => t[0] === "endsAt")?.[1];

    const resultFilter: Filter = {
      "#e": [pollEvent.id],
      kinds: [1070, 1018],
    } as Filter;

    if (difficulty) (resultFilter as any)["#W"] = [difficulty.toString()];
    if (filterPubkeys.length) resultFilter.authors = filterPubkeys;
    if (pollExpiration) resultFilter.until = Number(pollExpiration);

    subRef.current = nostrRuntime.subscribe(finalRelays, [resultFilter], {
      onEvent: (event: Event) => {
        setResponses((prev) => [...prev, event]);
      },
    });

    return () => {
      subRef.current?.unsubscribe();
      subRef.current = null;
    };
  }, [enabled, pollEvent.id, pollEvent.tags, difficulty, filterPubkeys, userRelays]);

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
    const counts = new Map<string, { count: number; responders: string[] }>();
    for (const opt of options) counts.set(opt[1], { count: 0, responders: [] });

    for (const event of uniqueResponses) {
      for (const tag of event.tags) {
        if (tag[0] === "response") {
          const entry = counts.get(tag[1]);
          if (entry && !entry.responders.includes(event.pubkey)) {
            entry.count++;
            entry.responders.push(event.pubkey);
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
