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
  /** Called when the active account changes (SyncEngine retargets, etc.). */
  onSetAccount?: (pubkey: string | null) => void;
  /** Called when the user's relay set changes. */
  onSetUserRelays?: (relays: string[]) => void;
  /** Maintain a deduped upstream sync for a scope (decoupled from local REQs). */
  onStartSync?: (key: string, filters: Filter[]) => void;
  onStopSync?: (key: string) => void;
  /** A client published an event: store it locally + send upstream with tracking. */
  onPublish?: (pubId: string, event: Event, relays?: string[]) => void;
  /** Force-reset specific relay connections (before a retry). */
  onResetRelays?: (relays: string[]) => void;
  /** Report live relay connection health. */
  onRelayHealth?: (reqId: string) => void;
  /** One-shot read: local + bounded upstream, then reply with queryResult. */
  onQuery?: (reqId: string, filters: Filter[]) => void;
  /** One-shot bounded backfill. */
  onFetchPage?: (filters: Filter[]) => void;
  /** Lifecycle: close all sockets / reconnect. */
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

  /** Send a one-shot query's results back to the client. */
  postQueryResult(reqId: string, events: Event[]): void {
    this.emit({ kind: "queryResult", reqId, events });
  }

  private emit(m: FromWorker): void {
    this.channel.post(m);
  }

  private onMessage(m: ToWorker): void {
    switch (m.kind) {
      case "nostr":
        // REQ/CLOSE/EVENT are LOCAL ONLY here — RelayCore replays the store +
        // keeps a live tail. Upstream sync is driven via startSync, and upstream
        // publishing via the dedicated `publish` frame (both decoupled).
        this.relayCore.handle(m.msg);
        break;
      case "publish":
        // Store + OK locally (so local subs see it instantly), then send upstream
        // with per-relay tracking that resolves into a publishResult.
        this.relayCore.handle(["EVENT", m.event]);
        this.hooks.onPublish?.(m.pubId, m.event, m.relays);
        break;
      case "resetRelays":
        this.hooks.onResetRelays?.(m.relays);
        break;
      case "relayHealth":
        this.hooks.onRelayHealth?.(m.reqId);
        break;
      case "query":
        this.hooks.onQuery?.(m.reqId, m.filters);
        break;
      case "ingest":
        // Local store only (no OK, no upstream) — optimistic adds / imports.
        this.relayCore.handle(["INGEST", m.events]);
        break;
      case "setAccount":
        this.hooks.onSetAccount?.(m.pubkey);
        break;
      case "setUserRelays":
        this.hooks.onSetUserRelays?.(m.relays);
        break;
      case "startSync":
        this.hooks.onStartSync?.(m.key, m.filters);
        break;
      case "stopSync":
        this.hooks.onStopSync?.(m.key);
        break;
      case "fetchPage":
        this.hooks.onFetchPage?.(m.filters);
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
