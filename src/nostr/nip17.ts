import {
  Event,
  EventTemplate,
  UnsignedEvent,
  nip44,
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} from "nostr-tools";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { dataLayer, type PublishResult } from "@formstr/local-relay";
import { signerManager } from "../singletons/Signer/SignerManager";
import { buildFileTags, FileMeta } from "./fileMessage";

// A rumor is an unsigned event with an id
export type Rumor = UnsignedEvent & { id: string };

export interface SendResult {
  rumor: Rumor;
  /** Signed gift wraps (recipient + sender) — kept so retry can republish without re-signing. */
  wraps: Event[];
  /** Per-relay delivery outcome from the worker, merged across both wraps. */
  result: PublishResult;
}

/**
 * Merge the per-relay outcomes of several `publishEvent` results into one,
 * deduping by relay (a relay shared by the recipient + sender wrap appears
 * once, keeping its best outcome). The worker owns relay selection; this is
 * purely for the DM send-status UI.
 */
export function mergePublishResults(results: PublishResult[]): PublishResult {
  const byRelay = new Map<string, PublishResult["relayResults"][number]>();
  for (const res of results) {
    for (const r of res.relayResults) {
      const existing = byRelay.get(r.relay);
      // Prefer an "accepted" outcome over any non-accepted one.
      if (!existing || (existing.status !== "accepted" && r.status === "accepted")) {
        byRelay.set(r.relay, r);
      }
    }
  }
  const relayResults = Array.from(byRelay.values());
  const accepted = relayResults.filter((r) => r.status === "accepted").length;
  return {
    ok: accepted > 0,
    accepted,
    total: relayResults.length,
    relayResults,
  };
}

interface CachedRelays {
  relays: string[];
  created_at: number;
}

const INBOX_RELAY_LS_PREFIX = "inbox_relays_";

// Session-scoped in-memory layer on top of localStorage
const inboxRelayCache = new Map<string, string[]>();

function readRelayStore(pubkey: string): CachedRelays | null {
  try {
    const raw = localStorage.getItem(INBOX_RELAY_LS_PREFIX + pubkey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRelayStore(pubkey: string, data: CachedRelays): void {
  try {
    localStorage.setItem(INBOX_RELAY_LS_PREFIX + pubkey, JSON.stringify(data));
  } catch {
    // localStorage full, ignore
  }
}

/**
 * Fetch from network and update caches if the event is newer than knownAt.
 * When persist=true, also writes to localStorage (only for the logged-in user).
 */
async function fetchRelaysFromNetwork(
  pubkey: string,
  knownAt: number,
  persist: boolean
): Promise<string[]> {
  try {
    const event = await dataLayer.fetchReplaceable(10050, pubkey);

    if (event) {
      const relays = event.tags
        .filter((t) => t[0] === "relay")
        .map((t) => t[1]);
      if (relays.length > 0 && event.created_at > knownAt) {
        inboxRelayCache.set(pubkey, relays);
        if (persist) writeRelayStore(pubkey, { relays, created_at: event.created_at });
        return relays;
      }
    }
  } catch (e) {
    console.error("Error fetching inbox relays:", e);
  }

  // Network gave nothing newer — return whatever is already cached or fall back
  if (inboxRelayCache.has(pubkey)) return inboxRelayCache.get(pubkey)!;

  const fallback = ["wss://relay.damus.io/"];
  inboxRelayCache.set(pubkey, fallback);
  if (persist) writeRelayStore(pubkey, { relays: fallback, created_at: 0 });
  return fallback;
}

/**
 * Fetch inbox relays (kind 10050) for a pubkey.
 *
 * persist=true should only be passed for the logged-in user's own pubkey —
 * it enables localStorage persistence across sessions (stale-while-revalidate).
 * For recipient pubkeys, only the in-memory session cache is used.
 *
 *   1. In-memory hit       → instant
 *   2. localStorage hit    → instant + background revalidation (persist only)
 *   3. Cold start          → await network
 */
export async function fetchInboxRelays(
  pubkey: string,
  persist = false
): Promise<string[]> {
  // 1. In-memory hit
  if (inboxRelayCache.has(pubkey)) {
    return inboxRelayCache.get(pubkey)!;
  }

  // 2. localStorage hit (logged-in user only) — serve stale, revalidate in background
  if (persist) {
    const stored = readRelayStore(pubkey);
    if (stored) {
      inboxRelayCache.set(pubkey, stored.relays);
      fetchRelaysFromNetwork(pubkey, stored.created_at, persist); // fire-and-forget
      return stored.relays;
    }
  }

  // 3. Cold start — must wait for network
  return fetchRelaysFromNetwork(pubkey, 0, persist);
}

/**
 * Publish kind 10050 inbox relay list for the current user.
 */
export async function publishInboxRelays(relays: string[]): Promise<void> {
  const signer = await signerManager.getSigner();
  const event: EventTemplate = {
    kind: 10050,
    created_at: Math.floor(Date.now() / 1000),
    tags: relays.map((r) => ["relay", r]),
    content: "",
  };
  const signed = await signer.signEvent(event);
  dataLayer.publishEvent(signed);
}

/**
 * Generate a random timestamp within the past 2 days per NIP-59.
 */
function randomTimestamp(): number {
  const twoDays = 2 * 24 * 60 * 60;
  return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * twoDays);
}

/**
 * Compute a deterministic rumor ID from an unsigned event.
 */
function computeRumorId(rumor: UnsignedEvent): string {
  const serialized = JSON.stringify([
    0,
    rumor.pubkey,
    rumor.created_at,
    rumor.kind,
    rumor.tags,
    rumor.content,
  ]);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}

/**
 * Create a rumor (unsigned event). Defaults to kind 14 (DM).
 */
export function createRumor(
  senderPubkey: string,
  recipientPubkey: string,
  content: string,
  replyToId?: string,
  kind: number = 14,
  extraTags: string[][] = []
): Rumor {
  const tags: string[][] = [["p", recipientPubkey]];
  if (replyToId) {
    tags.push(["e", replyToId, "", "reply"]);
  }
  tags.push(...extraTags);

  const unsigned: UnsignedEvent = {
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
    pubkey: senderPubkey,
  };

  return {
    ...unsigned,
    id: computeRumorId(unsigned),
  };
}

/**
 * Create a gift wrap with a local private key (LocalSigner path).
 * Implements NIP-59: rumor -> seal (kind 13) -> gift wrap (kind 1059).
 */
function createGiftWrapLocal(
  senderPrivkey: Uint8Array,
  rumor: Rumor,
  recipientPubkey: string,
  wrapExpiryS?: number
): Event {
  // Step 1: Create seal (kind 13) - encrypt rumor with sender's key for recipient
  const rumorJson = JSON.stringify(rumor);
  const sealConvKey = nip44.getConversationKey(senderPrivkey, recipientPubkey);
  const encryptedRumor = nip44.encrypt(rumorJson, sealConvKey);

  const sealEvent: UnsignedEvent = {
    kind: 13,
    created_at: randomTimestamp(),
    tags: [],
    content: encryptedRumor,
    pubkey: getPublicKey(senderPrivkey),
  };
  const seal = finalizeEvent(sealEvent, senderPrivkey);

  // Step 2: Create gift wrap (kind 1059) with ephemeral key
  const ephemeralKey = generateSecretKey();
  const ephemeralPubkey = getPublicKey(ephemeralKey);

  const sealJson = JSON.stringify(seal);
  const wrapConvKey = nip44.getConversationKey(ephemeralKey, recipientPubkey);
  const encryptedSeal = nip44.encrypt(sealJson, wrapConvKey);

  const wrapTags: string[][] = [["p", recipientPubkey]];
  if (wrapExpiryS) {
    wrapTags.push(["expiration", String(Math.floor(Date.now() / 1000) + wrapExpiryS)]);
  }

  const wrapEvent: UnsignedEvent = {
    kind: 1059,
    created_at: randomTimestamp(),
    tags: wrapTags,
    content: encryptedSeal,
    pubkey: ephemeralPubkey,
  };

  return finalizeEvent(wrapEvent, ephemeralKey);
}

/**
 * Create a gift wrap using external signer for seal, ephemeral key for wrap.
 */
async function createGiftWrapForSigner(
  signer: {
    signEvent: (e: EventTemplate) => Promise<Event>;
    nip44Encrypt?: (pk: string, txt: string) => Promise<string>;
  },
  rumor: Rumor,
  recipientPubkey: string,
  wrapExpiryS?: number
): Promise<Event> {
  if (!signer.nip44Encrypt) {
    throw new Error("Signer does not support NIP-44 encryption");
  }

  // Step 1: Encrypt rumor content into a seal
  const rumorJson = JSON.stringify(rumor);
  const encryptedRumor = await signer.nip44Encrypt(recipientPubkey, rumorJson);

  // Step 2: Create and sign the seal (kind 13)
  const sealTemplate: EventTemplate = {
    kind: 13,
    created_at: randomTimestamp(),
    tags: [],
    content: encryptedRumor,
  };
  const seal = await signer.signEvent(sealTemplate);

  // Step 3: Create gift wrap with ephemeral key (kind 1059)
  const ephemeralKey = generateSecretKey();
  const ephemeralPubkey = getPublicKey(ephemeralKey);

  const sealJson = JSON.stringify(seal);
  const conversationKey = nip44.getConversationKey(
    ephemeralKey,
    recipientPubkey
  );
  const encryptedSeal = nip44.encrypt(sealJson, conversationKey);

  const wrapTags: string[][] = [["p", recipientPubkey]];
  if (wrapExpiryS) {
    wrapTags.push(["expiration", String(Math.floor(Date.now() / 1000) + wrapExpiryS)]);
  }

  const wrapTemplate: UnsignedEvent = {
    kind: 1059,
    created_at: randomTimestamp(),
    tags: wrapTags,
    content: encryptedSeal,
    pubkey: ephemeralPubkey,
  };

  return finalizeEvent(wrapTemplate, ephemeralKey);
}

/**
 * Unwrap a gift wrap (kind 1059) locally with a private key.
 */
function unwrapGiftWrapLocal(
  wrap: Event,
  recipientPrivkey: Uint8Array
): Rumor {
  // Step 1: Decrypt the gift wrap to get the seal
  const wrapConvKey = nip44.getConversationKey(recipientPrivkey, wrap.pubkey);
  const sealJson = nip44.decrypt(wrap.content, wrapConvKey);
  const seal: Event = JSON.parse(sealJson);

  // Step 2: Decrypt the seal to get the rumor
  const sealConvKey = nip44.getConversationKey(recipientPrivkey, seal.pubkey);
  const rumorJson = nip44.decrypt(seal.content, sealConvKey);
  const rumor: Rumor = JSON.parse(rumorJson);

  return rumor;
}

/**
 * Relay-side NIP-40 TTL for gift wraps of real DM traffic (kind 14/15/7):
 * NIP-17 recommends wraps expire on relays days-to-months out. The local
 * cache keeps wraps for a year regardless — relays are transport, local is
 * the durable record. Ping wraps evaporate far faster (typing.ts).
 */
export const NIP17_WRAP_TTL_S = 30 * 24 * 60 * 60;

/**
 * Shared NIP-59 wrap-and-publish core. Takes a ready rumor (kind 14 text,
 * kind 15 file, kind 7 reaction), wraps it to the recipient + the sender on
 * both LocalSigner and external-signer paths, publishes via the worker (which
 * routes each wrap by its #p tag), and merges per-relay outcomes.
 */
async function wrapAndPublishRumor(
  rumor: Rumor,
  recipientPubkey: string,
  privateKey?: string
): Promise<SendResult> {
  const signer = await signerManager.getSigner();
  const senderPubkey = await signer.getPublicKey();

  let wraps: Event[];

  if (privateKey) {
    const privkeyBytes = hexToBytes(privateKey);
    const wrapForRecipient = createGiftWrapLocal(privkeyBytes, rumor, recipientPubkey, NIP17_WRAP_TTL_S);
    const wrapForSender = createGiftWrapLocal(privkeyBytes, rumor, senderPubkey, NIP17_WRAP_TTL_S);
    wraps = [wrapForRecipient, wrapForSender];
  } else {
    if (!signer.nip44Encrypt) {
      throw new Error(
        "Your signer does not support NIP-44 encryption, which is required for DMs."
      );
    }
    const recipientWrap = await createGiftWrapForSigner(signer, rumor, recipientPubkey, NIP17_WRAP_TTL_S);
    const senderWrap = await createGiftWrapForSigner(signer, rumor, senderPubkey, NIP17_WRAP_TTL_S);
    wraps = [recipientWrap, senderWrap];
  }

  // The worker routes each gift wrap to the recipient's (and sender's) inbox
  // relays based on its #p tag — the app no longer selects relays. We await the
  // per-relay outcomes so the UI can show delivery status.
  const results = await Promise.all(wraps.map((w) => dataLayer.publishEvent(w)));

  return { rumor, wraps, result: mergePublishResults(results) };
}

/**
 * Wrap and send a DM using NIP-17 protocol.
 * Handles both LocalSigner (has privateKey) and external signer paths.
 */
export async function wrapAndSendDM(
  recipientPubkey: string,
  content: string,
  privateKey?: string,
  replyToId?: string
): Promise<SendResult> {
  const signer = await signerManager.getSigner();
  const senderPubkey = await signer.getPublicKey();

  // Create the rumor (unsigned kind 14)
  const rumor = createRumor(senderPubkey, recipientPubkey, content, replyToId);

  return wrapAndPublishRumor(rumor, recipientPubkey, privateKey);
}

/**
 * Wrap and send a file attachment (NIP-17 kind 15) encrypted per NIP-59.
 * `fileMeta` must already be fully populated: the blob uploaded (encrypted)
 * to Blossom with `url` + `encryptedSha`, plus `key`/`nonce` and hashes —
 * see fileMessage.ts.
 */
export async function wrapAndSendFile(
  recipientPubkey: string,
  fileMeta: FileMeta,
  privateKey?: string,
  replyToId?: string
): Promise<SendResult> {
  const signer = await signerManager.getSigner();
  const senderPubkey = await signer.getPublicKey();

  // Kind 15 rumor: content = the encrypted blob's URL, tags carry the
  // NIP-94-style decryption contract (file-type/encryption-algorithm/keys/…).
  const rumor = createRumor(
    senderPubkey,
    recipientPubkey,
    fileMeta.url,
    replyToId,
    15,
    buildFileTags(fileMeta)
  );

  return wrapAndPublishRumor(rumor, recipientPubkey, privateKey);
}

/**
 * Wrap and send a reaction to a DM message using NIP-17 gift wrapping.
 * Creates a kind 7 rumor with the emoji as content and an e-tag pointing to the target message.
 */
export async function wrapAndSendReaction(
  recipientPubkey: string,
  emoji: string,
  targetMessageId: string,
  privateKey?: string
): Promise<Rumor> {
  const signer = await signerManager.getSigner();
  const senderPubkey = await signer.getPublicKey();

  // Create a kind 7 reaction rumor with e-tag for target message
  const rumor = createRumor(
    senderPubkey,
    recipientPubkey,
    emoji,
    undefined,
    7,
    [["e", targetMessageId]]
  );

  if (privateKey) {
    const privkeyBytes = hexToBytes(privateKey);

    const wrapForRecipient = createGiftWrapLocal(
      privkeyBytes,
      rumor,
      recipientPubkey,
      NIP17_WRAP_TTL_S
    );
    const wrapForSender = createGiftWrapLocal(
      privkeyBytes,
      rumor,
      senderPubkey,
      NIP17_WRAP_TTL_S
    );

    await dataLayer.publishEvent(wrapForRecipient);
    await dataLayer.publishEvent(wrapForSender);
  } else {
    if (!signer.nip44Encrypt) {
      throw new Error(
        "Your signer does not support NIP-44 encryption, which is required for DM reactions."
      );
    }

    const recipientWrap = await createGiftWrapForSigner(
      signer,
      rumor,
      recipientPubkey,
      NIP17_WRAP_TTL_S
    );
    await dataLayer.publishEvent(recipientWrap);

    const senderWrap = await createGiftWrapForSigner(
      signer,
      rumor,
      senderPubkey,
      NIP17_WRAP_TTL_S
    );
    await dataLayer.publishEvent(senderWrap);
  }

  return rumor;
}

/**
 * Unwrap a gift wrap (kind 1059) to extract the rumor.
 * Handles both LocalSigner and external signer paths.
 */
export async function unwrapGiftWrap(
  wrap: Event,
  privateKey?: string
): Promise<Rumor | null> {
  try {
    if (privateKey) {
      // LocalSigner path: direct decryption with private key
      const privkeyBytes = hexToBytes(privateKey);
      const rumor = unwrapGiftWrapLocal(wrap, privkeyBytes);
      return rumor;
    } else {
      // External signer path: manual decryption via signer
      const signer = await signerManager.getSigner();
      if (!signer.nip44Decrypt) {
        throw new Error("Signer does not support NIP-44 decryption");
      }

      // Step 1: Decrypt the gift wrap to get the seal
      const sealJson = await signer.nip44Decrypt(wrap.pubkey, wrap.content);
      const seal: Event = JSON.parse(sealJson);

      // Step 2: Decrypt the seal to get the rumor
      const rumorJson = await signer.nip44Decrypt(seal.pubkey, seal.content);
      const rumor: Rumor = JSON.parse(rumorJson);

      // Verify seal.pubkey matches rumor.pubkey
      if (seal.pubkey !== rumor.pubkey) {
        console.warn("Seal pubkey does not match rumor pubkey, discarding");
        return null;
      }

      return rumor;
    }
  } catch (e) {
    console.error("Failed to unwrap gift wrap:", e);
    return null;
  }
}

/**
 * Tag marking a typing-key binding inside a kind-14 rumor:
 * ["typing-key", <ephemeralPk>, <untilEpochSecs>]. The rumor is sealed by the
 * sender's REAL key, so the binding authenticates the ephemeral typing key to
 * the conversation participants (see typing.ts for the full protocol).
 */
export const TYPING_KEY_TAG = "typing-key";

export interface TypingBinding {
  /** The ephemeral key allowed to emit typing pings for the sender. */
  ephemeralPk: string;
  /** Epoch seconds after which the binding (and its pings) expire. */
  until: number;
}

/** Defensive cap on a binding's horizon — senders ask for ~12h. */
const MAX_BINDING_HORIZON_S = 24 * 60 * 60;

/**
 * Parse a typing-key binding rumor; null when this is any other kind-14.
 * Used on the receive side to route binding DMs away from message storage.
 */
export function parseTypingKeyRumor(rumor: Rumor): TypingBinding | null {
  if (rumor.kind !== 14) return null;
  let tag: string[] | undefined;
  for (const t of rumor.tags) {
    if (t[0] === TYPING_KEY_TAG) {
      tag = t;
      break;
    }
  }
  if (!tag || !tag[1] || !tag[2]) return null;
  if (!/^[0-9a-f]{64}$/.test(tag[1])) return null;
  const until = parseInt(tag[2], 10);
  const nowS = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(until) || until <= nowS) return null;
  return {
    ephemeralPk: tag[1],
    until: Math.min(until, nowS + MAX_BINDING_HORIZON_S),
  };
}

/**
 * Publish the typing-key binding DM through the normal NIP-17 pipeline:
 * kind-14 rumor sealed by the REAL key (silent on local keys; a single
 * prompt on external signers), wrapped + routed like any other DM.
 */
export async function publishTypingKeyBinding(
  recipientPubkey: string,
  ephemeralPk: string,
  until: number,
  privateKey?: string
): Promise<void> {
  const signer = await signerManager.getSigner();
  const senderPubkey = await signer.getPublicKey();
  const rumor = createRumor(senderPubkey, recipientPubkey, "", undefined, 14, [
    [TYPING_KEY_TAG, ephemeralPk, String(until)],
  ]);
  await wrapAndPublishRumor(rumor, recipientPubkey, privateKey);
}

/**
 * Seal + wrap a rumor signed by a LOCAL (ephemeral) key — no signer prompts.
 * Used by typing pings (see typing.ts): the seal is signed by `signingKey`
 * itself; each recipient wrap gets a fresh NIP-59 ephemeral key. Merged
 * per-relay outcomes returned; typing callers treat sends as best-effort.
 */
export async function publishLocalSignedWraps(
  signingKey: Uint8Array,
  rumor: Rumor,
  recipients: string[],
  wrapExpiryS?: number
): Promise<PublishResult> {
  const wraps = recipients.map((r) =>
    createGiftWrapLocal(signingKey, rumor, r, wrapExpiryS)
  );
  const results = await Promise.all(wraps.map((w) => dataLayer.publishEvent(w)));
  return mergePublishResults(results);
}

/**
 * True for a wrapped presence ping: kind-20001 rumor carrying t="presence".
 * Distinguished from typing pings so receivers can apply the longer online
 * window instead of the 6s typing flash.
 */
export function isPresencePingRumor(rumor: Rumor): boolean {
  if (rumor.kind !== 20001) return false;
  for (const t of rumor.tags) {
    if (t[0] === "t" && t[1] === "presence") return true;
  }
  return false;
}

/**
 * Compute a conversation ID from participant pubkeys.
 * Sorts all participants and joins with "+".
 */
export function getConversationId(myPubkey: string, pTags: string[]): string {
  const participants = Array.from(new Set([myPubkey, ...pTags]));
  return participants.sort().join("+");
}
