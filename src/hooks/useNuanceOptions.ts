import { useState, useEffect, useRef, useMemo } from "react";
import { Event } from "nostr-tools";
import { nostrRuntime } from "../singletons";
import { useRelays } from "./useRelays";

const HEX_64 = /^[0-9a-f]{64}$/;

export interface NuanceOption {
  /** Human-readable text of the nuance */
  text: string;
  /** Number of voters who expressed or co-signed this nuance */
  count: number;
  /** Event ID of the original kind:1018 that first expressed this nuance */
  sourceEventId: string;
}

function isHex64(value: string): boolean {
  return HEX_64.test(value);
}

/**
 * Given all kind:1018 events for a poll and a specific optionId,
 * extracts, deduplicates, and sorts nuance options by popularity.
 *
 * Co-sign handling: if a nuance tag value is a 64-char hex string,
 * it is treated as a reference to another kind:1018 whose nuance
 * the voter agrees with. The referenced event's nuance text is used.
 * If the referenced event cannot be resolved, the co-sign is excluded.
 */
function buildNuanceOptions(events: Event[], optionId: string): NuanceOption[] {
  // Only events that voted for this specific option
  const sameOptionEvents = events.filter((e) =>
    e.tags.some((t) => t[0] === "response" && t[1] === optionId)
  );

  // Build a lookup: eventId -> freeform nuance text
  // Only original (non-co-sign) nuances are indexed here
  const eventTextMap = new Map<string, string>();
  for (const ev of sameOptionEvents) {
    const nuance = ev.tags.find((t) => t[0] === "nuance")?.[1];
    if (nuance && nuance.trim() && !isHex64(nuance)) {
      eventTextMap.set(ev.id, nuance.trim());
    }
  }

  // Tally: nuance text -> { count, sourceEventId }
  const counts = new Map<string, { count: number; sourceEventId: string }>();

  for (const ev of sameOptionEvents) {
    const nuance = ev.tags.find((t) => t[0] === "nuance")?.[1];
    if (!nuance || !nuance.trim()) continue;

    let text: string;
    let sourceEventId: string;

    if (isHex64(nuance)) {
      // Co-sign: resolve to the original freeform nuance
      const resolved = eventTextMap.get(nuance);
      if (!resolved) continue; // referenced event not found — exclude
      text = resolved;
      sourceEventId = nuance; // ID of the original event
    } else {
      text = nuance.trim();
      sourceEventId = ev.id;
    }

    const entry = counts.get(text);
    if (entry) {
      entry.count++;
    } else {
      counts.set(text, { count: 1, sourceEventId });
    }
  }

  return Array.from(counts.entries())
    .map(([text, { count, sourceEventId }]) => ({ text, count, sourceEventId }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Fetches kind:1018 vote events for a poll and extracts nuance options
 * for a specific option, sorted by popularity.
 *
 * Only activates when `enabled` is true (lazy — triggered at nuance step).
 */
export function useNuanceOptions(
  pollEvent: Event,
  optionId: string | null,
  enabled: boolean
): { options: NuanceOption[]; loading: boolean } {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const subRef = useRef<{ unsubscribe: () => void } | null>(null);
  const { relays: userRelays } = useRelays();

  useEffect(() => {
    if (!enabled || !optionId) {
      setEvents([]);
      setLoading(false);
      return;
    }

    subRef.current?.unsubscribe();
    setEvents([]);
    setLoading(true);

    const pollRelays = pollEvent.tags
      .filter((t) => t[0] === "relay")
      .map((t) => t[1]);
    const finalRelays = Array.from(new Set([...pollRelays, ...userRelays]));

    subRef.current = nostrRuntime.subscribe(
      finalRelays,
      [{ kinds: [1018], "#e": [pollEvent.id] }],
      {
        onEvent: (ev: Event) =>
          setEvents((prev) => {
            // deduplicate by ID
            if (prev.some((e) => e.id === ev.id)) return prev;
            return [...prev, ev];
          }),
        onEose: () => setLoading(false),
      }
    );

    return () => {
      subRef.current?.unsubscribe();
      subRef.current = null;
    };
  }, [enabled, optionId, pollEvent.id, pollEvent.tags, userRelays]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(
    () => buildNuanceOptions(events, optionId ?? ""),
    [events, optionId]
  );

  return { options, loading };
}
