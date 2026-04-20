import type { Event } from "nostr-tools";
import { nip13 } from "nostr-tools";

export interface OptionResult {
  count: number;
  percentage: number;
  responders: string[];
}

/**
 * Keeps the latest valid vote per pubkey, optionally filtering by PoW difficulty on the vote id.
 */
export function dedupeVoteEvents(
  responses: Event[],
  difficulty: number
): Event[] {
  const map = new Map<string, Event>();
  for (const event of responses) {
    if (difficulty && nip13.getPow(event.id) < difficulty) continue;
    const existing = map.get(event.pubkey);
    if (!existing || event.created_at > existing.created_at) {
      map.set(event.pubkey, event);
    }
  }
  return Array.from(map.values());
}

/**
 * Tallies `response` tags from deduplicated vote events against poll `option` tags.
 */
export function tallyPollResults(
  pollTags: string[][],
  uniqueResponses: Event[]
): Map<string, OptionResult> {
  const options = pollTags.filter((t) => t[0] === "option");
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
}

/** Option id(s) with the highest vote count (ties preserved). */
export function leadingOptionIds(
  results: Map<string, OptionResult>
): string[] {
  const values = Array.from(results.values());
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    max = Math.max(max, values[i].count);
  }
  if (max === 0) return [];
  return Array.from(results.entries())
    .filter(([, r]) => r.count === max)
    .map(([id]) => id);
}
