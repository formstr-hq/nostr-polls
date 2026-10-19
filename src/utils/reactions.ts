import { Event, EventTemplate } from "nostr-tools";

/**
 * Amethyst-style quick reactions shown in the compact reaction popover. They
 * are plain Unicode emoji, so every NIP-25 client (Amethyst included) renders
 * them; "More reactions" opens the full picker for anything else.
 */
export const QUICK_REACTIONS = ["❤️", "👍", "😂", "🚀", "🎉", "🤔"] as const;

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
