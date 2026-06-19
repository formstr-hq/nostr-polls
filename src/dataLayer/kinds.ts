/**
 * Kind registry — one place that knows how to treat each event kind. Replaces
 * the per-kind rules currently duplicated across feeds (HomeFeed's `dedupeKey`,
 * `isRootNote`, the addressable/replaceable checks, repost/reaction e-tag
 * parsing). The UI requests events by kind+scope and renders via a parallel
 * render registry; this module owns the *data* rules.
 *
 * Adding support for a new kind = one `registerKind` entry (+ a renderer in the
 * UI map) — no new query function, which is the whole point.
 */
import type { Event } from "nostr-tools";
import {
  getReplaceableKey,
  isReplaceableEvent,
} from "../localRelay/core/eventValidation";

export interface KindDef {
  /** Semantic role used for render routing and feed handling. */
  role: "note" | "repost" | "reaction" | "poll" | "article" | "response" | "other";
  /** Stable identity for dedup. Defaults to id (or replaceable key). */
  dedupeKey?: (e: Event) => string;
  /** Top-level feed item? Defaults to true. Notes drop replies. */
  isFeedRoot?: (e: Event) => boolean;
  /** The event this one refers to (repost/reaction/response target). */
  relatesTo?: (e: Event) => string | undefined;
}

const registry = new Map<number, KindDef>();

export function registerKind(kind: number, def: KindDef): void {
  registry.set(kind, def);
}

export function getKindDef(kind: number): KindDef | undefined {
  return registry.get(kind);
}

const firstETag = (e: Event): string | undefined =>
  e.tags.find((t) => t[0] === "e")?.[1];

/** Stable dedup identity: addressable/replaceable collapse to their key. */
export function dedupeKey(e: Event): string {
  const custom = registry.get(e.kind)?.dedupeKey;
  if (custom) return custom(e);
  return isReplaceableEvent(e.kind) ? getReplaceableKey(e) : e.id;
}

/** Whether the event belongs at the top level of a feed. */
export function isFeedRoot(e: Event): boolean {
  const def = registry.get(e.kind);
  return def?.isFeedRoot ? def.isFeedRoot(e) : true;
}

/** The event this one references, if any (for stitching reposts/reactions). */
export function relatesTo(e: Event): string | undefined {
  return registry.get(e.kind)?.relatesTo?.(e);
}

export function roleOf(kind: number): KindDef["role"] {
  return registry.get(kind)?.role ?? "other";
}

// --- default registrations (mirror current app behaviour) ---

registerKind(1, {
  role: "note",
  // Root notes only — a note carrying an "e" tag is a reply.
  isFeedRoot: (e) => !e.tags.some((t) => t[0] === "e"),
});
registerKind(6, { role: "repost", relatesTo: firstETag, isFeedRoot: () => false });
registerKind(7, { role: "reaction", relatesTo: firstETag, isFeedRoot: () => false });
registerKind(1068, { role: "poll" });
registerKind(30023, { role: "article" }); // addressable → default dedupeKey collapses versions
registerKind(1018, { role: "response", relatesTo: firstETag, isFeedRoot: () => false });
registerKind(1070, { role: "response", relatesTo: firstETag, isFeedRoot: () => false });
