import { Event, verifyEvent } from "nostr-tools";

export const KIND_REPOST = 6;

export type FeedItem =
  | { type: "event"; event: Event; sortTime: number }
  | { type: "repost"; note: Event; reposts: Event[]; sortTime: number };

// Stable identity for an event. Addressable (30000-39999) and replaceable
// (10000-19999, plus 0/3) events keep the same coordinate across edits, so the
// same article republished — or different versions returned by different relays
// — must collapse to one entry. Everything else is unique by id.
const isAddressableOrReplaceable = (kind: number) =>
  (kind >= 30000 && kind < 40000) ||
  (kind >= 10000 && kind < 20000) ||
  kind === 0 ||
  kind === 3;

export const dedupeKey = (event: Event): string => {
  if (isAddressableOrReplaceable(event.kind)) {
    const d = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    return `${event.kind}:${event.pubkey}:${d}`;
  }
  return event.id;
};

// NIP-18 stringifies the original event into a kind-6 repost's `content`. It's
// untrusted input, so only accept it if it's a well-formed, correctly signed
// event whose id matches the repost's `e` tag and whose kind is allowed.
const parseEmbedded = (
  repost: Event,
  originalId: string,
  allowedKinds: number[]
): Event | undefined => {
  if (!repost.content) return undefined;
  try {
    const embedded = JSON.parse(repost.content) as Event;
    if (
      embedded?.id === originalId &&
      allowedKinds.includes(embedded.kind) &&
      verifyEvent(embedded)
    ) {
      return embedded;
    }
  } catch {
    // malformed repost content — may still resolve via a direct copy
  }
  return undefined;
};

/**
 * Folds kind-6 reposts into a list of events. Reposts of the same note collapse
 * to one entry (with all reposters); a note that's also present directly shows
 * once with a "reposted by" header, ordered by the most recent repost. Reposts
 * whose original can't be recovered (not embedded, not present directly) are
 * dropped. Non-repost events pass through ordered by created_at.
 */
export const buildFeedItems = (
  events: Event[],
  allowedOriginalKinds: number[]
): FeedItem[] => {
  const reposts = events.filter((e) => e.kind === KIND_REPOST);
  const others = events.filter((e) => e.kind !== KIND_REPOST);

  const groups = new Map<string, { note?: Event; reposts: Event[] }>();
  for (const r of reposts) {
    const originalId = r.tags.find((t) => t[0] === "e")?.[1];
    if (!originalId) continue;
    const g = groups.get(originalId) || { reposts: [] };
    g.reposts.push(r);
    if (!g.note) g.note = parseEmbedded(r, originalId, allowedOriginalKinds);
    groups.set(originalId, g);
  }

  const directByKey = new Map<string, Event>();
  for (const e of others) directByKey.set(dedupeKey(e), e);

  const items: FeedItem[] = [];
  const consumed = new Set<string>();

  groups.forEach((g, originalId) => {
    const note = directByKey.get(originalId) || g.note;
    if (!note) return;
    consumed.add(originalId);
    const latestRepost = Math.max(...g.reposts.map((r) => r.created_at));
    items.push({
      type: "repost",
      note,
      reposts: g.reposts,
      sortTime: Math.max(note.created_at, latestRepost),
    });
  });

  for (const e of others) {
    if (consumed.has(dedupeKey(e))) continue;
    items.push({ type: "event", event: e, sortTime: e.created_at });
  }

  return items.sort((a, b) => b.sortTime - a.sortTime);
};
