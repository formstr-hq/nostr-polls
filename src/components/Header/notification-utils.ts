import { Event, nip57 } from "nostr-tools";

export type ParsedNotification = {
  type: "poll-response" | "comment" | "reaction" | "zap" | "repost" | "highlight" | "unknown";
  pollId?: string;
  postId?: string;
  /** For NIP-22 (kind 1111) comments: the kind of the root being commented on (from the "K" tag). */
  rootKind?: number;
  fromPubkey: string | null;
  content?: string;
  reaction?: string;
  sats?: number | null;
};

export function parseNotification(ev: Event): ParsedNotification {
  const getTag = (k: string) => ev.tags.find((t) => t[0] === k)?.[1] ?? null;

  // Check who sent it
  const fromPubkey = ev.pubkey ?? null;

  // POLL RESPONSE
  if (ev.kind === 1018) {
    return {
      type: "poll-response",
      pollId: getTag("e") || undefined,
      fromPubkey,
      content: ev.content,
    };
  }

  // Helper: pick the most specific "e" tag (reply > last non-root > last)
  const pickETag = (tagName = 'e') => {
    const eTags = ev.tags.filter(t => t[0] === tagName);
    return (
      eTags.find(t => t[3] === 'reply') ??
      eTags.filter(t => t[3] !== 'root' && t[3] !== 'mention').pop() ??
      eTags[eTags.length - 1]
    );
  };

  // COMMENT — kind 1 reply or kind 1111 NIP-22 generic comment
  if ((ev.kind === 1 || ev.kind === 1111) && getTag("p")) {
    // For NIP-22 (1111), root/reply use uppercase E/e tags
    const postTag = ev.kind === 1111
      ? (pickETag('e') ?? pickETag('E'))
      : pickETag('e');
    // NIP-22 carries the root's kind in a "K" tag (e.g. "1068" for a poll).
    const rootKindRaw = ev.kind === 1111 ? getTag("K") : null;
    const rootKind = rootKindRaw != null ? Number(rootKindRaw) : undefined;
    return {
      type: "comment",
      fromPubkey,
      postId: postTag?.[1] ?? undefined,
      rootKind: Number.isFinite(rootKind) ? rootKind : undefined,
      content: ev.content,
    };
  }

  // REPOST — kind 6 (note repost) or kind 16 (generic repost)
  if (ev.kind === 6 || ev.kind === 16) {
    const postTag = pickETag('e');
    return {
      type: "repost",
      fromPubkey,
      postId: postTag?.[1] ?? undefined,
    };
  }

  // REACTION
  if (ev.kind === 7) {
    // Use the last "e" tag (the specific event being reacted to), not the first (thread root)
    const postTag = pickETag('e');
    return {
      type: "reaction",
      fromPubkey,
      postId: postTag?.[1] ?? undefined,
      reaction: ev.content,
    };
  }

  // HIGHLIGHT — kind 9802 (NIP-84): someone highlighted text from one of your posts
  if (ev.kind === 9802) {
    const postTag = pickETag('e');
    return {
      type: "highlight",
      fromPubkey,
      postId: postTag?.[1] ?? undefined,
      content: ev.content, // the highlighted text
    };
  }

  // POLL (kind 1068) or ARTICLE (kind 30023) tagging the user — treat as a mention/comment
  if (ev.kind === 1068 || ev.kind === 30023) {
    return {
      type: "comment",
      fromPubkey,
      content: ev.content,
    };
  }

  // ZAP
  if (ev.kind === 9735) {
    let sats: number | null = null;
    const bolt11Tag = ev.tags.find((t) => t[0] === "bolt11")?.[1];
    const requestEvent = ev.tags.find((t) => t[0] === "description")?.[1];

    if (bolt11Tag) {
      try {
        sats = nip57.getSatoshisAmountFromBolt11(bolt11Tag);
      } catch (e) {
        console.error("Failed to parse bolt11 invoice", e, ev);
      }
    }

    // The zapped note is carried as an "e" tag on the receipt. Fall back to the
    // embedded zap request's "e" tag if the receipt didn't copy it through.
    let postId: string | undefined = pickETag("e")?.[1];

    // Get sender pubkey from the zap request
    let senderPubkey = fromPubkey;
    if (requestEvent) {
      try {
        const reqObj = JSON.parse(requestEvent) as Event;
        senderPubkey = reqObj.pubkey;
        if (!postId) {
          postId = reqObj.tags?.find((t) => t[0] === "e")?.[1];
        }
      } catch (e) {
        console.error("Failed to parse zap request event", e, ev);
      }
    }

    return {
      type: "zap",
      sats,
      postId: postId ?? undefined,
      fromPubkey: senderPubkey,
    };
  }

  return {
    type: "unknown",
    fromPubkey,
  };
}
