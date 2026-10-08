/**
 * Typing indicators for NIP-17 DMs. There is NO NIP for this yet (nips issue
 * #2002 collects proposals); ecosystem momentum is converging on ephemeral
 * kind 20001 p-tagged at the peer, with NIP-40 `expiration`. Best-effort by
 * design — a lost ping shows nothing, which is the correct failure mode.
 *
 * Sending: throttle to one ping per 3s while the user is typing (each ping
 * carries `expiration` ~30s; receivers clear UI state on their own cadence).
 * Receiving (dm-context): ephemeral kind 20001 arrives UNWRAPPED — it is read
 * directly on the DM subscription (kinds 1059+20001 keeps the worker's
 * DM-relay routing) and never goes through gift-wrap unwrapping.
 */
import { EventTemplate } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { signerManager } from "../singletons/Signer/SignerManager";

/** Min interval between pings for the same peer. */
const PING_THROTTLE_MS = 3000;

const perPeerState = new Map<string, { lastSentAt: number }>();

/**
 * Publish one typing ping to `recipientPubkey`. Throttled — call freely on
 * every keystroke. Ephemeral kind 20001, p-tagged at the recipient, with a
 * short NIP-40 expiration so relays and receivers can shed it.
 */
export async function sendTypingPing(recipientPubkey: string): Promise<void> {
  const now = Date.now();
  const st = perPeerState.get(recipientPubkey);
  if (st && now - st.lastSentAt < PING_THROTTLE_MS) return;
  if (st) st.lastSentAt = now;
  else perPeerState.set(recipientPubkey, { lastSentAt: now });

  try {
    const signer = await signerManager.getSigner();
    const template: EventTemplate = {
      kind: 20001,
      created_at: Math.floor(now / 1000),
      tags: [
        ["p", recipientPubkey],
        ["expiration", String(Math.floor(now / 1000) + 30)],
      ],
      content: "",
    };
    const signed = await signer.signEvent(template);
    // Best-effort: a failed/timeout ping is silently OK — typing is cosmetic.
    void dataLayer.publishEvent(signed).catch(() => undefined);
  } catch {
    // signer unavailable — typing pings are best-effort, drop silently
  }
}