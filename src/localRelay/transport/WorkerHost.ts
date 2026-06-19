/**
 * WorkerHost — worker-side glue. Wires a RelayCore to a Channel: NIP-01 frames
 * from the client drive RelayCore; RelayCore's emitted frames go back over the
 * channel. Owns the SignerPort and routes `signResult` to it, and handles
 * `setAccount` control frames. The actual Worker entry file is a thin shell that
 * constructs this with real platform pieces (selfChannel + IndexedDBStorage).
 */
import type { Event, Filter } from "../core/types";
import { EventDB } from "../core/EventDB";
import { RelayCore } from "../core/RelayCore";
import { Channel } from "./channel";
import { SignerPort } from "./SignerPort";
import { FromWorker, ToWorker } from "./frames";
import type { RelayPublishOutcome, RelayHealth } from "../sync/RelayPool";

export interface WorkerHostHooks {
  /** Active account changed (retarget scope). */
  onSetAccount?: (pubkey: string | null) => void;
  /** The user's relay set changed (policy input for the worker's routing). */
  onSetUserRelays?: (relays: string[]) => void;
  /** A standing interest was registered/updated — the worker decides upstream. */
  onObserve?: (subId: string, filters: Filter[], sync: boolean) => void;
  /** A standing interest was dropped — the worker reconciles its connections. */
  onUnobserve?: (subId: string) => void;
  /** A client published an event: store it locally + send upstream with tracking. */
  onPublish?: (pubId: string, event: Event) => void;
  /** Report live relay connection health (read-only observation). */
  onRelayHealth?: (reqId: string) => void;
  /** Lifecycle hints; the worker decides how to respond. */
  onPause?: () => void;
  onResume?: () => void;
}

export class WorkerHost {
  readonly relayCore: RelayCore;
  readonly signerPort: SignerPort;

  constructor(
    private channel: Channel,
    private db: EventDB,
    private hooks: WorkerHostHooks = {}
  ) {
    this.relayCore = new RelayCore(db, (msg) => this.emit({ kind: "nostr", msg }));
    this.signerPort = new SignerPort(channel);
    channel.onMessage((m) => this.onMessage(m as ToWorker));
    this.emit({ kind: "ready" });
  }

  /** Batch-ingest verified upstream events (called by the SyncEngine). */
  ingest(events: Event[]): void {
    this.relayCore.handle(["INGEST", events]);
  }

  /** Send a publish's per-relay outcomes back to the client. */
  postPublishResult(pubId: string, results: RelayPublishOutcome[]): void {
    this.emit({ kind: "publishResult", pubId, results });
  }

  /** Send relay health back to the client. */
  postRelayHealth(reqId: string, relays: RelayHealth[]): void {
    this.emit({ kind: "relayHealth", reqId, relays });
  }

  private emit(m: FromWorker): void {
    this.channel.post(m);
  }

  private onMessage(m: ToWorker): void {
    switch (m.kind) {
      case "observe":
        // Local subscription (cache replay + live tail) for this interest...
        this.relayCore.handle(["REQ", m.subId, ...m.filters]);
        // ...and hand the interest to the worker's autonomous sync (if requested).
        this.hooks.onObserve?.(m.subId, m.filters, m.sync);
        break;
      case "unobserve":
        this.relayCore.handle(["CLOSE", m.subId]);
        this.hooks.onUnobserve?.(m.subId);
        break;
      case "publish":
        // Store + OK locally (so local subs see it instantly), then send upstream
        // with per-relay tracking that resolves into a publishResult.
        this.relayCore.handle(["EVENT", m.event]);
        this.hooks.onPublish?.(m.pubId, m.event);
        break;
      case "ingest":
        // Local store only (no OK, no upstream) — optimistic adds / imports.
        this.relayCore.handle(["INGEST", m.events]);
        break;
      case "relayHealth":
        this.hooks.onRelayHealth?.(m.reqId);
        break;
      case "setAccount":
        this.hooks.onSetAccount?.(m.pubkey);
        break;
      case "setUserRelays":
        this.hooks.onSetUserRelays?.(m.relays);
        break;
      case "pause":
        this.hooks.onPause?.();
        break;
      case "resume":
        this.hooks.onResume?.();
        break;
      case "signResult":
        this.signerPort.resolve(m.reqId, m.event);
        break;
    }
  }
}
