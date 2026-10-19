// Resolves shareable nostr references directly from relays.
//
// Kept separate from the HTTP server so the server stays about serving and
// injecting, and so the relay/caching policy lives in one place.

import { nip19, SimplePool } from "nostr-tools";

const pool = new SimplePool();

const DEFAULT_RELAYS =
  "wss://relay.formstr.app,wss://relay.damus.io,wss://relay.primal.net,wss://nos.lol,wss://relay.nostr.wirednet.jp,wss://nostr-01.yakihonne.com,wss://nostr21.com";

const relays = () =>
  (process.env.NOSTR_RELAYS ?? DEFAULT_RELAYS)
    .split(",")
    .map((relay) => relay.trim())
    .filter(Boolean);

const relayTimeoutMs = () => Number(process.env.RELAY_TIMEOUT_MS || 10000);
const cacheTtlMs = () => Number(process.env.PREVIEW_CACHE_MS || 86400000);
const cacheMax = () => Number(process.env.PREVIEW_CACHE_MAX || 5000);

const cache = new Map();
const inFlight = new Map();

const ADDRESSABLE_MIN = 30000;
const ADDRESSABLE_MAX = 40000;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?[^\s]*)?$/i;
const URL_RE = /https?:\/\/[^\s]+/g;

const tagValue = (event, name) =>
  event.tags.find((tag) => tag[0] === name)?.[1];

const truncate = (value, max) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const firstImageUrl = (content) =>
  (String(content).match(URL_RE) ?? []).find((url) => IMAGE_EXT.test(url));

const extractImage = (event) => {
  for (const tag of event.tags) {
    if (tag[0] !== "imeta") continue;
    const url = tag.slice(1).find((part) => part.startsWith("url "));
    if (url) return url.slice(4);
  }
  return tagValue(event, "image") ?? firstImageUrl(event.content);
};

const encodeReference = (event) => {
  const identifier = tagValue(event, "d");
  if (
    identifier !== undefined &&
    event.kind >= ADDRESSABLE_MIN &&
    event.kind < ADDRESSABLE_MAX
  ) {
    return nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier,
    });
  }
  return nip19.neventEncode({
    id: event.id,
    kind: event.kind,
    author: event.pubkey,
  });
};

const buildPoll = (event) => {
  const endsAt = tagValue(event, "endsAt");
  return {
    question: event.content,
    type: tagValue(event, "polltype") ?? "singlechoice",
    options: event.tags
      .filter((tag) => tag[0] === "option" && tag[1] !== undefined)
      .map((tag) => ({ id: tag[1], label: tag[2] ?? tag[1] })),
    ...(endsAt !== undefined ? { endsAt: Number(endsAt) } : {}),
  };
};

export const buildPreview = (event) => {
  const preview = {
    kind: event.kind,
    id: event.id,
    author: event.pubkey,
    created_at: event.created_at,
    reference: encodeReference(event),
  };

  switch (event.kind) {
    case 1068:
      preview.title = event.content || "Poll";
      preview.content = event.content;
      preview.poll = buildPoll(event);
      break;
    case 30023:
      preview.title = tagValue(event, "title");
      preview.summary = tagValue(event, "summary");
      preview.image = tagValue(event, "image") ?? firstImageUrl(event.content);
      preview.content = event.content;
      if (tagValue(event, "published_at") !== undefined) {
        preview.published_at = Number(tagValue(event, "published_at"));
      }
      break;
    default:
      preview.title = tagValue(event, "subject");
      preview.summary = truncate(event.content, 280);
      preview.content = event.content;
      preview.image = extractImage(event);
      break;
  }

  return preview;
};

const fetchEvent = (hints, filter) => {
  const targets = hints && hints.length > 0 ? hints : relays();
  if (targets.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.close();
      resolve(event);
    };

    const sub = pool.subscribeMany(targets, filter, {
      onevent: (event) => finish(event),
    });
    const timer = setTimeout(() => finish(null), relayTimeoutMs());
  });
};

const resolveEvent = async (identifier) => {
  let decoded;
  try {
    decoded = nip19.decode(identifier);
  } catch {
    return null;
  }

  switch (decoded.type) {
    case "naddr": {
      const { kind, pubkey, identifier: d, relays: hints } = decoded.data;
      return fetchEvent(hints, {
        kinds: [kind],
        authors: [pubkey],
        "#d": [d],
      });
    }
    case "nevent":
      return fetchEvent(decoded.data.relays, {
        ids: [decoded.data.id],
        limit: 1,
      });
    case "note":
      return fetchEvent(undefined, { ids: [decoded.data], limit: 1 });
    default:
      return null;
  }
};

/**
 * Resolve an identifier to a normalized preview. Returns null for identifiers
 * we cannot decode, or that no relay answered before the timeout.
 */
export const resolvePreview = async (identifier) => {
  const cached = cache.get(identifier);
  if (cached && cached.expiresAt > Date.now()) return cached.preview;

  const pending = inFlight.get(identifier);
  if (pending) return pending;

  const promise = resolveEvent(identifier)
    .then((event) => {
      if (!event) return null;
      const preview = buildPreview(event);
      cache.set(identifier, {
        preview,
        expiresAt: Date.now() + cacheTtlMs(),
      });
      while (cache.size > cacheMax()) {
        cache.delete(cache.keys().next().value);
      }
      return preview;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(identifier));

  inFlight.set(identifier, promise);
  return promise;
};
