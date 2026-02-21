import {
  Event,
  EventTemplate,
  UnsignedEvent,
  nip44,
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} from "nostr-tools";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { defaultRelays } from "./index";
import { pool, nostrRuntime } from "../singletons";
import { signerManager } from "../singletons/Signer/SignerManager";

// A rumor is an unsigned event with an id
export type Rumor = UnsignedEvent & { id: string };

export interface RelayPublish {
  relay: string;
  promise: Promise<string>;
}

export interface SendResult {
  rumor: Rumor;
  /** Per-relay publish promises (deduped union of recipient + sender relays). */
  publishes: RelayPublish[];
  /** Original signed gift wraps — stored so retry can republish without re-signing. */
  retryWraps: { event: Event; relays: string[] }[];
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
    const event = await nostrRuntime.fetchOne(defaultRelays, {
      kinds: [10050],
      authors: [pubkey],
    });

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
  pool.publish(defaultRelays, signed);
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
function createRumor(
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
  recipientPubkey: string
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

  const wrapEvent: UnsignedEvent = {
    kind: 1059,
    created_at: randomTimestamp(),
    tags: [["p", recipientPubkey]],
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
  recipientPubkey: string
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

  const wrapTemplate: UnsignedEvent = {
    kind: 1059,
    created_at: randomTimestamp(),
    tags: [["p", recipientPubkey]],
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

  // Fetch inbox relays — persist only for the sender (logged-in user)
  const [recipientInbox, senderInbox] = await Promise.all([
    fetchInboxRelays(recipientPubkey),
    fetchInboxRelays(senderPubkey, true),
  ]);

  // Create the rumor (unsigned kind 14)
  const rumor = createRumor(senderPubkey, recipientPubkey, content, replyToId);

  const recipientRelays = Array.from(new Set([...recipientInbox, ...defaultRelays]));
  const senderRelays = Array.from(new Set([...senderInbox, ...defaultRelays]));

  let wraps: { event: Event; relays: string[] }[];

  if (privateKey) {
    const privkeyBytes = hexToBytes(privateKey);
    const wrapForRecipient = createGiftWrapLocal(privkeyBytes, rumor, recipientPubkey);
    const wrapForSender = createGiftWrapLocal(privkeyBytes, rumor, senderPubkey);
    wraps = [
      { event: wrapForRecipient, relays: recipientRelays },
      { event: wrapForSender,    relays: senderRelays },
    ];
  } else {
    if (!signer.nip44Encrypt) {
      throw new Error(
        "Your signer does not support NIP-44 encryption, which is required for DMs."
      );
    }
    const recipientWrap = await createGiftWrapForSigner(signer, rumor, recipientPubkey);
    const senderWrap = await createGiftWrapForSigner(signer, rumor, senderPubkey);
    wraps = [
      { event: recipientWrap, relays: recipientRelays },
      { event: senderWrap,    relays: senderRelays },
    ];
  }

  // Fire off all publishes — don't await, return promises for UI tracking.
  // Deduplicate by relay URL so we get one promise per unique relay.
  const relayMap = new Map<string, RelayPublish>();
  for (const { event, relays } of wraps) {
    const promises = pool.publish(relays, event);
    relays.forEach((relay, i) => {
      if (!relayMap.has(relay)) {
        relayMap.set(relay, { relay, promise: promises[i] });
      }
    });
  }

  return { rumor, publishes: Array.from(relayMap.values()), retryWraps: wraps };
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

  const [recipientInbox, senderInbox] = await Promise.all([
    fetchInboxRelays(recipientPubkey),
    fetchInboxRelays(senderPubkey, true),
  ]);

  // Create a kind 7 reaction rumor with e-tag for target message
  const rumor = createRumor(
    senderPubkey,
    recipientPubkey,
    emoji,
    undefined,
    7,
    [["e", targetMessageId]]
  );

  const recipientRelays = Array.from(new Set([...recipientInbox, ...defaultRelays]));
  const senderRelays = Array.from(new Set([...senderInbox, ...defaultRelays]));

  if (privateKey) {
    const privkeyBytes = hexToBytes(privateKey);

    const wrapForRecipient = createGiftWrapLocal(
      privkeyBytes,
      rumor,
      recipientPubkey
    );
    const wrapForSender = createGiftWrapLocal(
      privkeyBytes,
      rumor,
      senderPubkey
    );

    await Promise.allSettled(pool.publish(recipientRelays, wrapForRecipient));
    await Promise.allSettled(pool.publish(senderRelays, wrapForSender));
  } else {
    if (!signer.nip44Encrypt) {
      throw new Error(
        "Your signer does not support NIP-44 encryption, which is required for DM reactions."
      );
    }

    const recipientWrap = await createGiftWrapForSigner(
      signer,
      rumor,
      recipientPubkey
    );
    await Promise.allSettled(pool.publish(recipientRelays, recipientWrap));

    const senderWrap = await createGiftWrapForSigner(
      signer,
      rumor,
      senderPubkey
    );
    await Promise.allSettled(pool.publish(senderRelays, senderWrap));
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
 * Compute a conversation ID from participant pubkeys.
 * Sorts all participants and joins with "+".
 */
export function getConversationId(myPubkey: string, pTags: string[]): string {
  const participants = Array.from(new Set([myPubkey, ...pTags]));
  return participants.sort().join("+");
}
