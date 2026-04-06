import { useEffect, useRef, useMemo, useState } from "react";
import { Event, Filter } from "nostr-tools";
import { nostrRuntime } from "../singletons";
import { SubscriptionHandle } from "../nostrRuntime/types";
import { useRelays } from "./useRelays";
import { dedupeVoteEvents, tallyPollResults } from "../utils/pollTally";
import type { OptionResult } from "../utils/pollTally";

export type { OptionResult } from "../utils/pollTally";

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

  const uniqueResponses = useMemo(
    () => dedupeVoteEvents(responses, difficulty),
    [responses, difficulty]
  );

  const results = useMemo(
    () => tallyPollResults(pollEvent.tags, uniqueResponses),
    [uniqueResponses, pollEvent.tags]
  );

  return { results, totalVotes: uniqueResponses.length };
}
