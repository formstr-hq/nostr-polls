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

export interface WorkerHostHooks {
  /** Called when the active account changes (SyncEngine retargets, etc.). */
  onSetAccount?: (pubkey: string | null) => void;
  /** Called when the user's relay set changes. */
  onSetUserRelays?: (relays: string[]) => void;
  /** Maintain a deduped upstream sync for a scope (decoupled from local REQs). */
  onStartSync?: (key: string, filters: Filter[]) => void;
  onStopSync?: (key: string) => void;
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

  private emit(m: FromWorker): void {
    this.channel.post(m);
  }

  private onMessage(m: ToWorker): void {
    switch (m.kind) {
      case "nostr":
        // REQ is LOCAL ONLY — RelayCore replays the store + keeps a live tail.
        // Upstream sync is driven separately via startSync (decoupled).
        this.relayCore.handle(m.msg);
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
