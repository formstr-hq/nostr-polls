/**
 * RelayConnection — a single upstream relay. Owns one Socket, speaks NIP-01,
 * survives drops with exponential backoff + jitter, and resubscribes active REQs
 * on reconnect. Pure logic over the Socket interface → fully testable with
 * FakeSocket.
 *
 * It does NOT verify signatures or store events — it just parses frames and
 * forwards them to the pool. Verification + storage happen above (SyncEngine →
 * RelayCore.ingest), keeping this layer crypto-free.
 *
 * NIP-42 AUTH: an `onAuth` hook is accepted for later wiring; the happy path
 * (no auth required) works without it.
 */
import type { Event, Filter } from "../core/types";

export interface RelayConnectionHandlers {
  onEvent: (subId: string, event: Event, relay: string) => void;
  /** Relay signalled end-of-stored-events for this sub. */
  onEose: (subId: string, relay: string) => void;
  /** Relay closed this sub (e.g. auth-required) — counts as "done" upstream. */
  onClosed: (subId: string, relay: string, message: string) => void;
  onOk?: (eventId: string, ok: boolean, message: string, relay: string) => void;
}

export interface RelayConnectionOptions {
  autoReconnect?: boolean;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

import type { Socket, SocketFactory } from "./Socket";

export class RelayConnection {
  private socket: Socket | null = null;
  private sendQueue: unknown[] = [];
  private activeReqs = new Map<string, Filter[]>();
  private backoffAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;
  private readonly opts: Required<RelayConnectionOptions>;

  constructor(
    readonly url: string,
    private factory: SocketFactory,
    private handlers: RelayConnectionHandlers,
    options: RelayConnectionOptions = {}
  ) {
    this.opts = {
      autoReconnect: options.autoReconnect ?? true,
      baseBackoffMs: options.baseBackoffMs ?? 1000,
      maxBackoffMs: options.maxBackoffMs ?? 30_000,
    };
  }

  get connected(): boolean {
    return this.socket?.readyState === 1;
  }

  /** Socket exists and is still in the CONNECTING handshake. */
  get connecting(): boolean {
    return this.socket?.readyState === 0;
  }

  /** Waiting on a backoff timer to reconnect after a drop. */
  get reconnecting(): boolean {
    return this.reconnectTimer !== null;
  }

  connect(): void {
    if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return;
    this.closedByUs = false;
    const socket = this.factory(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.backoffAttempts = 0;
      // Resubscribe everything that was active before the (re)connect.
      for (const [subId, filters] of Array.from(this.activeReqs.entries())) {
        this.write(["REQ", subId, ...filters]);
      }
      // Flush anything queued while connecting.
      const queued = this.sendQueue;
      this.sendQueue = [];
      for (const msg of queued) this.write(msg);
    };
    socket.onmessage = (data) => this.onMessage(data);
    socket.onclose = () => this.onDrop();
    socket.onerror = () => {
      /* close handler drives reconnect; error alone is informational */
    };
  }

  req(subId: string, filters: Filter[]): void {
    // REQs live in activeReqs and are (re)sent on open/reconnect from there —
    // never via the send queue, or they'd be transmitted twice.
    this.activeReqs.set(subId, filters);
    if (this.connected) this.write(["REQ", subId, ...filters]);
    else this.connect();
  }

  close(subId: string): void {
    const existed = this.activeReqs.delete(subId);
    // Only emit CLOSE if the REQ was actually on the wire; if we never opened,
    // dropping it from activeReqs is enough (open won't resubscribe it).
    if (existed && this.connected) this.write(["CLOSE", subId]);
  }

  publish(event: Event): void {
    this.enqueue(["EVENT", event]);
  }

  /** Permanently close this connection (no reconnect). */
  destroy(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.activeReqs.clear();
    try {
      this.socket?.close();
    } catch {
      /* already gone */
    }
    this.socket = null;
  }

  /** Queue non-REQ messages (publishes) until the socket is open. REQs do NOT
   * use this path — they're resent from activeReqs on open. */
  private enqueue(msg: unknown): void {
    if (this.connected) {
      this.write(msg);
    } else {
      this.sendQueue.push(msg);
      this.connect();
    }
  }

  private write(msg: unknown): void {
    try {
      this.socket?.send(JSON.stringify(msg));
    } catch {
      // Send failed — queue for the next open and let reconnect handle it.
      this.sendQueue.push(msg);
    }
  }

  private onMessage(data: string): void {
    let msg: any[];
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg)) return;
    switch (msg[0]) {
      case "EVENT":
        this.handlers.onEvent(msg[1], msg[2], this.url);
        break;
      case "EOSE":
        this.handlers.onEose(msg[1], this.url);
        break;
      case "CLOSED":
        this.handlers.onClosed(msg[1], this.url, msg[2] ?? "");
        break;
      case "OK":
        this.handlers.onOk?.(msg[1], !!msg[2], msg[3] ?? "", this.url);
        break;
      // NOTICE / AUTH: ignored for now (AUTH hook lands with NIP-42 wiring).
    }
  }

  private onDrop(): void {
    this.socket = null;
    if (this.closedByUs || !this.opts.autoReconnect) return;
    const delay = this.nextBackoff();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private nextBackoff(): number {
    const exp = Math.min(
      this.opts.maxBackoffMs,
      this.opts.baseBackoffMs * 2 ** this.backoffAttempts
    );
    this.backoffAttempts++;
    // Full jitter so a fleet of relays doesn't reconnect in lockstep.
    return Math.random() * exp;
  }
}
