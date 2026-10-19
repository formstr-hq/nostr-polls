import { Event, EventTemplate } from "nostr-tools";

/**
 * Amethyst-style quick reactions shown in the compact reaction popover. They
 * are plain Unicode emoji, so every NIP-25 client (Amethyst included) renders
 * them; "More reactions" opens the full picker for anything else.
 */
export const DEFAULT_QUICK_REACTIONS = [
  "❤️",
  "👍",
  "😂",
  "🚀",
  "🎉",
  "🤔",
] as const;

/** How many emoji fit in the compact row. */
export const QUICK_REACTION_LIMIT = DEFAULT_QUICK_REACTIONS.length;

const QUICK_REACTIONS_STORAGE_PREFIX = "pollerama:quickReactions:";

function quickReactionsStorageKey(pubkey?: string): string {
  return QUICK_REACTIONS_STORAGE_PREFIX + (pubkey || "anon");
}

/**
 * Dedupe and cap a reaction list. The most recent choice goes first, so a new
 * emoji picked from the full picker pushes into the row and the oldest default
 * drops off the end.
 */
export function mergeQuickReactions(reactions: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const reaction of reactions) {
    if (typeof reaction !== "string") continue;
    // Normalize NIP-25 "+"/"-" so the row and its persisted form always use the
    // emoji the UI displays.
    const emoji = displayReaction(reaction.trim());
    if (!emoji || seen.has(emoji)) continue;
    seen.add(emoji);
    out.push(emoji);
    if (out.length >= QUICK_REACTION_LIMIT) break;
  }
  return out;
}

/**
 * Read this account's quick-reaction row. Falls back to the defaults when
 * nothing has been chosen yet (or storage is unavailable/corrupt).
 */
export function loadQuickReactions(pubkey?: string): string[] {
  try {
    const raw = localStorage.getItem(quickReactionsStorageKey(pubkey));
    if (!raw) return [...DEFAULT_QUICK_REACTIONS];
    const parsed = JSON.parse(raw);
    const merged = mergeQuickReactions(Array.isArray(parsed) ? parsed : []);
    return merged.length ? merged : [...DEFAULT_QUICK_REACTIONS];
  } catch {
    return [...DEFAULT_QUICK_REACTIONS];
  }
}

/**
 * Persist a quick-reaction row (deduped/capped by mergeQuickReactions).
 */
export function saveQuickReactions(
  pubkey: string | undefined,
  reactions: readonly unknown[]
): string[] {
  const next = mergeQuickReactions(reactions);
  try {
    localStorage.setItem(quickReactionsStorageKey(pubkey), JSON.stringify(next));
  } catch {
    // Persisting is best-effort; the in-memory row still updates.
  }
  return next;
}

/**
 * Promote `emoji` to the front of this account's quick-reaction row and persist
 * it. Called whenever a reaction is added — including from the full picker —
 * which is what makes "More reactions" choices show up in the quick row next
 * time.
 */
export function rememberQuickReaction(
  pubkey: string | undefined,
  emoji: string
): string[] {
  return saveQuickReactions(pubkey, [emoji, ...loadQuickReactions(pubkey)]);
}

/**
 * Remove one emoji from this account's quick-reaction row. This only edits the
 * row — removing the reaction from a post is a separate tap on that post.
 */
export function removeQuickReaction(
  pubkey: string | undefined,
  emoji: string
): string[] {
  const shown = displayReaction(emoji);
  return saveQuickReactions(
    pubkey,
    loadQuickReactions(pubkey).filter((reaction) => reaction !== shown)
  );
}

/** Restore the default row (and drop the account's custom choices). */
export function resetQuickReactions(pubkey?: string): string[] {
  try {
    localStorage.removeItem(quickReactionsStorageKey(pubkey));
  } catch {
    // best-effort
  }
  return [...DEFAULT_QUICK_REACTIONS];
}

/**
 * NIP-25 defines "+" as a like and "-" as a dislike. Amethyst and several other
 * clients publish those short forms, so normalize them to the emoji the UI
 * shows. Keeping this in one place also lets "tap ❤️" remove a "+" reaction
 * instead of stacking a second, visually identical one.
 */
export function displayReaction(content: string): string {
  return content === "+" ? "❤️" : content === "-" ? "👎" : content;
}

/**
 * Build a NIP-25 kind-7 reaction template that interoperates with Amethyst and
 * other clients:
 * - `e` targets the event (with an optional relay hint),
 * - `p` tags the target author so their client can notify them,
 * - `k` records the target kind,
 * - `a` is added for addressable targets (articles, music, …), where the event
 *   id alone is not the canonical reference.
 */
export function buildReactionTemplate(
  target: Event,
  emoji: string,
  relayHint?: string,
  createdAt: number = Math.floor(Date.now() / 1000)
): EventTemplate {
  const tags: string[][] = [
    ["e", target.id, relayHint ?? ""],
    ["p", target.pubkey],
    ["k", String(target.kind)],
  ];

  if (target.kind >= 30000 && target.kind < 40000) {
    const d = target.tags.find((t) => t[0] === "d")?.[1];
    if (d !== undefined) {
      tags.push(["a", `${target.kind}:${target.pubkey}:${d}`]);
    }
  }

  return {
    kind: 7,
    content: emoji,
    tags,
    created_at: createdAt,
  };
}
