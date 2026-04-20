import { NOSTR_EVENT_KINDS } from "../constants/nostr";
import type { Option } from "../interfaces";

export type UnsignedPollEventTemplate = {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
};

export type BuildUnsignedPollEventParams = {
  content: string;
  options: Option[];
  relays: string[];
  topics: string[];
  mentionTags: string[][];
  quoteTags: string[][];
  poW?: number | null;
  pollType?: string | null;
  expiration?: number | null;
  createdAt?: number;
};

/**
 * Builds the unsigned poll event template used before signing (kind 1068).
 * Mirrors {@link PollTemplateForm} publish payload shape.
 */
export function buildUnsignedPollEvent(
  params: BuildUnsignedPollEventParams
): UnsignedPollEventTemplate {
  const {
    content,
    options,
    relays,
    topics,
    mentionTags,
    quoteTags,
    poW,
    pollType,
    expiration,
    createdAt = Math.floor(Date.now() / 1000),
  } = params;

  const pollEvent: UnsignedPollEventTemplate = {
    kind: NOSTR_EVENT_KINDS.POLL,
    content,
    tags: [
      ...options.map((option) => ["option", option[0], option[1]] as string[]),
      ...relays.map((relay) => ["relay", relay] as string[]),
      ...topics.map((tag) => ["t", tag] as string[]),
      ...mentionTags,
      ...quoteTags,
    ],
    created_at: createdAt,
  };

  if (poW) pollEvent.tags.push(["PoW", poW.toString()]);
  if (pollType) pollEvent.tags.push(["polltype", pollType]);
  if (expiration) pollEvent.tags.push(["endsAt", expiration.toString()]);

  return pollEvent;
}
