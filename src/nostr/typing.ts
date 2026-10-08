/**
 * Typing indicators for NIP-17 DMs — privacy v2: wrapped and signer-free.
 *
 * There is no NIP yet (nips issue #2002). v1 shipped raw public kind-20001
 * pings: every relay learned "user X is typing in a conversation with Y"
 * (plaintext p-tags + real-key author), and external signers were prompted
 * on every ping. v2 rides the NIP-59 pipeline so the wire is
 * indistinguishable from ordinary DM traffic:
 *
 *   - a per-peer EPHEMERAL typing key is minted in memory when the user first
 *     types in a session;
 *   - the real key publishes ONE binding DM (kind-14 rumor carrying the
 *     ["typing-key", <ephemeralPk>, <until>] tag — see nip17.ts): silent on
 *     local keys, a single prompt per session on external signers;
 *   - every ping is a kind-20001 rumor sealed + wrapped with the ephemeral
 *     key — all-local signing, zero signer involvement;
 *   - receivers accept pings only from keys covered by a live binding,
 *     attribute them to the bound participant, and delete the wraps right
 *     away (pings are never stored).
 *
 * This also closes the v1 spoofing hole: any peer could publish a public
 * "X is typing" event for any X; a v2 binding is sealed by the real key and
 * can only arrive inside wraps encrypted to the recipient.
 */
import { generateSecretKey, getPublicKey } from "nostr-tools";
import {
  createRumor,
  publishTypingKeyBinding,
  publishLocalSignedWraps,
} from "./nip17";

/** Min interval between pings for the same peer. */
const PING_THROTTLE_MS = 3000;

/** Ping NIP-40 expiration; receivers keep their own snappier visible window. */
const PING_EXPIRY_S = 30;

/**
 * Binding lifetime. On expiry the next keystroke mints a fresh key and
 * re-publishes the binding — one prompt per session, not per ping.
 */
const BINDING_TTL_S = 12 * 60 * 60;

interface TypingSession {
  sk: Uint8Array;
  pk: string;
  /** Epoch seconds until the binding (and this key) expires. */
  boundUntil: number;
}

/** Peer pubkey -> live typing key + binding horizon. */
const sessionKeys = new Map<string, TypingSession>();
/** Peer pubkey -> in-flight mint-and-bind (dedups rapid keystrokes). */
const bindingInflight = new Map<string, Promise<TypingSession>>();
/** Peer pubkey -> { lastSentAt } — ping throttle state. */
const perPeerState = new Map<string, { lastSentAt: number }>();
/**
 * Peers whose binding was refused or failed this session (e.g. the user hit
 * "no" on the one-time signer prompt). Stay quiet for the rest of the
 * session instead of re-asking on every keystroke.
 */
const declined = new Set<string>();

/** Drop all session typing keys/state — call on account switch or logout. */
export function resetTypingSessions(): void {
  sessionKeys.clear();
  bindingInflight.clear();
  perPeerState.clear();
  declined.clear();
}

/**
 * Get (or lazily mint + bind) the ephemeral typing key for `peer`. The
 * binding DM is sealed by the real key via the normal DM pipeline.
 */
function ensureTypingSession(
  peer: string,
  realPk: string,
  privateKey?: string
): Promise<TypingSession> {
  const nowS = Math.floor(Date.now() / 1000);
  const live = sessionKeys.get(peer);
  if (live && live.boundUntil > nowS) return Promise.resolve(live);

  let inflight = bindingInflight.get(peer);
  if (!inflight) {
    inflight = mintAndBind(peer, realPk, privateKey);
    bindingInflight.set(peer, inflight);
    inflight.then(
      () => bindingInflight.delete(peer),
      () => bindingInflight.delete(peer)
    );
  }
  return inflight;
}

async function mintAndBind(
  peer: string,
  realPk: string,
  privateKey?: string
): Promise<TypingSession> {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const boundUntil = Math.floor(Date.now() / 1000) + BINDING_TTL_S;
  await publishTypingKeyBinding(peer, pk, boundUntil, privateKey);
  const session = { sk, pk, boundUntil };
  sessionKeys.set(peer, session);
  return session;
}

/**
 * Publish one typing ping to `peer`. Throttled — call freely on every
 * keystroke. Sealing + wrapping are all-local (ephemeral keys), so this
 * never touches the signer after the once-per-session binding.
 */
export async function sendTypingPing(
  peer: string,
  realPk: string,
  privateKey?: string
): Promise<void> {
  if (declined.has(peer)) return;
  const now = Date.now();
  const st = perPeerState.get(peer);
  if (st) {
    if (now - st.lastSentAt < PING_THROTTLE_MS) return;
    st.lastSentAt = now;
  } else {
    perPeerState.set(peer, { lastSentAt: now });
  }

  try {
    const session = await ensureTypingSession(peer, realPk, privateKey);
    // Kind-20001 rumor, same shape as v1's public pings — but sealed by the
    // ephemeral key and gift-wrapped like any other NIP-17 traffic.
    const rumor = createRumor(session.pk, peer, "", undefined, 20001, [
      ["expiration", String(Math.floor(now / 1000) + PING_EXPIRY_S)],
    ]);
    await publishLocalSignedWraps(session.sk, rumor, [peer], PING_WRAP_TTL_S, PING_WRAP_KIND);
  } catch {
    // Binding refused (signer "no") or publish failed — typing is cosmetic;
    // stay quiet for the session rather than re-prompting every keystroke.
    declined.add(peer);
  }
}
// --- presence (ping-pong) ----------------------------------------------------
//
// Online status rides the same wrapped pipeline as typing: an ephemeral ping
// key (bound once per session by the real key) seals a kind-20001 rumor that
// carries a t="presence" tag. Sharing is strictly opt-in per contact — the
// toggle lives in the chat header, off for everyone by default. The receiver
// observes wraps addressed to it; no consent needed to SEE a peer who opted in.

/** Relay TTL for a presence ping. */
const PRESENCE_PING_EXPIRY_S = 45;

/**
 * Wrap-level NIP-40 TTL for ping wraps so relays evaporate them quickly —
 * the rumor inside expires in seconds; minutes of wrap life covers relay
 * clock skew without piling metadata up forever.
 */
const PING_WRAP_TTL_S = 5 * 60;

/** Wrap kind for pings: NIP-59 ephemeral gift wrap — relays MUST NOT store it. */
const PING_WRAP_KIND = 21059;

function presenceStoreKey(myPk: string): string {
  return "presence:send:" + myPk;
}

/** Peers the user opted into sharing their presence with (default: none). */
export function presenceSendPeers(myPk: string): string[] {
  try {
    const raw = localStorage.getItem(presenceStoreKey(myPk));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(arr)) {
      return arr.filter((x): x is string => typeof x === "string");
    }
  } catch {
    // corrupted store — treat as empty
  }
  return [];
}

export function isPresenceSendEnabled(myPk: string, peerPk: string): boolean {
  return presenceSendPeers(myPk).some((p) => p === peerPk);
}

export function setPresenceSendEnabled(
  myPk: string,
  peerPk: string,
  on: boolean
): void {
  const peers = presenceSendPeers(myPk);
  let next: string[];
  if (on && !peers.some((p) => p === peerPk)) {
    next = peers.concat([peerPk]);
  } else if (!on) {
    next = peers.filter((p) => p !== peerPk);
  } else {
    next = peers;
  }
  try {
    localStorage.setItem(presenceStoreKey(myPk), JSON.stringify(next));
  } catch {
    // storage unavailable (private mode) — toggle is session-scoped then
  }
}

/**
 * Publish one presence ping to `peer` — same ephemeral binding as typing,
 * signer-free beyond the once-per-session binding prompt. Self-skips while
 * the app is hidden: presence means "my app is reachable right now", and the
 * socket pause/resume handling keeps the radio quiet while it isn't.
 */
export async function sendPresencePing(
  peer: string,
  realPk: string,
  privateKey?: string
): Promise<void> {
  if (declined.has(peer)) return;
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    return;
  }
  try {
    const session = await ensureTypingSession(peer, realPk, privateKey);
    const nowS = Math.floor(Date.now() / 1000);
    const rumor = createRumor(session.pk, peer, "", undefined, 20001, [
      ["expiration", String(nowS + PRESENCE_PING_EXPIRY_S)],
      ["t", "presence"],
    ]);
    await publishLocalSignedWraps(session.sk, rumor, [peer], PING_WRAP_TTL_S, PING_WRAP_KIND);
  } catch {
    // Binding refused or publish failed — presence is cosmetic; stay quiet
    // for the session instead of re-prompting on every tick.
    declined.add(peer);
  }
}
