/**
 * SignerPort — worker side of the NIP-42 sign RPC. The Worker can't reach the
 * Capacitor/`window.nostr` signer (main-thread only), so when a relay challenges
 * with AUTH the SyncEngine asks the SignerPort to sign; it posts a `signRequest`
 * to the main thread and resolves when the matching `signResult` returns.
 */
import type { Event } from "../core/types";
import type { EventTemplate } from "nostr-tools";
import { Channel } from "./channel";

export class SignerPort {
  private pending = new Map<string, (event: Event | null) => void>();
  private counter = 0;

  constructor(private channel: Channel, private timeoutMs = 15_000) {}

  /** Request a signature from the main thread. Resolves null on refusal/timeout. */
  sign(template: EventTemplate): Promise<Event | null> {
    const reqId = `sign${this.counter++}`;
    return new Promise((resolve) => {
      let settled = false;
      const done = (event: Event | null) => {
        if (settled) return;
        settled = true;
        this.pending.delete(reqId);
        resolve(event);
      };
      this.pending.set(reqId, done);
      this.channel.post({ kind: "signRequest", reqId, template });
      setTimeout(() => done(null), this.timeoutMs);
    });
  }

  /** Called by WorkerHost when a `signResult` arrives. */
  resolve(reqId: string, event: Event | null): void {
    this.pending.get(reqId)?.(event);
  }
}
