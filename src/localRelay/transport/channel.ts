/**
 * Channel — the postMessage abstraction between main thread and Worker. Both
 * sides program against this interface, so the whole client/host protocol can be
 * tested over an in-memory pipe (`createChannelPair`) with no real Worker.
 */
export interface Channel {
  post(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
  close(): void;
}

/** Main-thread side: wraps a Worker. */
export function workerChannel(worker: Worker): Channel {
  let handler: ((m: unknown) => void) | null = null;
  worker.onmessage = (e: MessageEvent) => handler?.(e.data);
  return {
    post: (m) => worker.postMessage(m),
    onMessage: (h) => {
      handler = h;
    },
    close: () => worker.terminate(),
  };
}

/** Worker side: wraps the worker global scope (`self`). */
export function selfChannel(scope: {
  postMessage: (m: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
}): Channel {
  let handler: ((m: unknown) => void) | null = null;
  scope.onmessage = (e: MessageEvent) => handler?.(e.data);
  return {
    post: (m) => scope.postMessage(m),
    onMessage: (h) => {
      handler = h;
    },
    close: () => {},
  };
}

/**
 * Two linked in-memory channels for tests. A message posted on one is delivered
 * to the other's handler on a microtask (mimicking postMessage async-ness), and
 * round-trips through structuredClone-ish JSON so tests catch non-serializable
 * payloads.
 */
export function createChannelPair(): { client: Channel; worker: Channel } {
  let clientHandler: ((m: unknown) => void) | null = null;
  let workerHandler: ((m: unknown) => void) | null = null;
  const clone = (m: unknown) => JSON.parse(JSON.stringify(m));

  const client: Channel = {
    post: (m) => {
      const copy = clone(m);
      Promise.resolve().then(() => workerHandler?.(copy));
    },
    onMessage: (h) => {
      clientHandler = h;
    },
    close: () => {},
  };
  const worker: Channel = {
    post: (m) => {
      const copy = clone(m);
      Promise.resolve().then(() => clientHandler?.(copy));
    },
    onMessage: (h) => {
      workerHandler = h;
    },
    close: () => {},
  };
  return { client, worker };
}
