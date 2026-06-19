/**
 * Socket — the only network primitive the pool depends on. A thin interface over
 * WebSocket so the entire pool (connection lifecycle, EOSE aggregation, dedup,
 * backoff) is unit-testable with a FakeSocket and never needs a real server.
 *
 * Runs in a Worker — uses the global `WebSocket`, no DOM.
 */
export interface Socket {
  send(data: string): void;
  close(): void;
  /** 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED (WebSocket.readyState values). */
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export type SocketFactory = (url: string) => Socket;

/** Real factory wrapping the platform WebSocket. */
export const webSocketFactory: SocketFactory = (url: string): Socket => {
  const ws = new WebSocket(url);
  const socket: Socket = {
    get readyState() {
      return ws.readyState;
    },
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (e) => socket.onmessage?.(typeof e.data === "string" ? e.data : "");
  ws.onclose = () => socket.onclose?.();
  ws.onerror = () => socket.onerror?.();
  return socket;
};
