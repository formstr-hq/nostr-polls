import { Event } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { collectOnce } from "../../dataLayer/collect";

jest.mock("@formstr/local-relay", () => ({
  dataLayer: { fetchReplaceable: jest.fn() },
}));

jest.mock("../../dataLayer/collect", () => ({
  collectOnce: jest.fn(),
}));

const mockFetchReplaceable = dataLayer.fetchReplaceable as jest.Mock;
const mockCollectOnce = collectOnce as jest.Mock;

import {
  fetchPaytoEvent,
  invalidatePaytoCache,
  registerPaytoOwnPubkey,
} from "../payto";

const SELF = "a".repeat(64);
const OTHER = "b".repeat(64);
const THIRD = "c".repeat(64);

function makeEvent(pubkey: string, address = "4" + "z".repeat(94)): Event {
  return {
    id: `${pubkey.slice(0, 8)}${"0".repeat(56)}`,
    sig: "s".repeat(128),
    pubkey,
    created_at: 1234567890,
    kind: 10133,
    content: "",
    tags: [["payto", "monero", address]],
  } as unknown as Event;
}

let pubkeyCounter = 0;
/** A unique pubkey per test so module-level memos never leak across tests. */
function uniquePubkey(): string {
  const n = pubkeyCounter++;
  return n.toString(16).padStart(64, "0");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Route collectOnce calls by filter: 10002 warm, scoped 10133, authorless 10133. */
function routeCollect(handlers: {
  relayList?: Event[];
  scoped?: Event[];
  authorless?: Event[];
}) {
  mockCollectOnce.mockImplementation((filters: any[]) => {
    const filter = filters[0];
    if (filter.kinds?.includes(10002)) return Promise.resolve(handlers.relayList ?? []);
    if (filter.authors?.length) return Promise.resolve(handlers.scoped ?? []);
    return Promise.resolve(handlers.authorless ?? []);
  });
}

describe("fetchPaytoEvent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerPaytoOwnPubkey(null);
    mockFetchReplaceable.mockResolvedValue(null);
  });

  it("returns a store-cached event without touching the network", async () => {
    const pk = uniquePubkey();
    const event = makeEvent(pk);
    mockFetchReplaceable.mockResolvedValue(event);

    await expect(fetchPaytoEvent(pk)).resolves.toBe(event);
    expect(mockCollectOnce).not.toHaveBeenCalled();
  });

  it("memoizes a hit and does not re-read the store", async () => {
    const pk = uniquePubkey();
    const event = makeEvent(pk);
    mockFetchReplaceable.mockResolvedValue(event);

    await fetchPaytoEvent(pk);
    await fetchPaytoEvent(pk);
    expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);
  });

  it("re-probes after a memoized miss outlives its TTL", async () => {
    const pk = uniquePubkey();
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);

    await expect(fetchPaytoEvent(pk)).resolves.toBeNull();
    expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);

    // Still inside the miss TTL: memoized null is returned.
    nowSpy.mockReturnValue(1_000_000 + 10_000);
    await fetchPaytoEvent(pk);
    expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);

    // Past the TTL: the store is probed again.
    nowSpy.mockReturnValue(1_000_000 + 31_000);
    await fetchPaytoEvent(pk);
    expect(mockFetchReplaceable).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it("forceRefetch bypasses a memoized hit", async () => {
    const pk = uniquePubkey();
    const event = makeEvent(pk);
    mockFetchReplaceable.mockResolvedValue(event);

    await fetchPaytoEvent(pk);
    await fetchPaytoEvent(pk, { forceRefetch: true });
    expect(mockFetchReplaceable).toHaveBeenCalledTimes(2);
  });

  it("warm-steps the author relay list before an outbox read for others", async () => {
    const pk = uniquePubkey();
    const event = makeEvent(pk);
    routeCollect({ relayList: [], scoped: [event] });

    await expect(fetchPaytoEvent(pk)).resolves.toBe(event);

    const kinds = mockCollectOnce.mock.calls.map((c) => c[0][0].kinds[0]);
    expect(kinds).toContain(10002);
    expect(kinds).toContain(10133);
    // The scoped leg must carry the author filter.
    const scopedCall = mockCollectOnce.mock.calls.find(
      (c) => c[0][0].authors?.length
    );
    expect(scopedCall[0][0].authors).toEqual([pk]);
  });

  it("self-read resolves from the scoped leg and skips the warm step", async () => {
    const pk = uniquePubkey();
    registerPaytoOwnPubkey(pk);
    const event = makeEvent(pk);
    routeCollect({ scoped: [event], authorless: [] });

    await expect(fetchPaytoEvent(pk)).resolves.toBe(event);

    const kinds = mockCollectOnce.mock.calls.map((c) => c[0][0].kinds[0]);
    expect(kinds).not.toContain(10002); // self path never warms
    expect(mockCollectOnce).toHaveBeenCalledTimes(2); // scoped + authorless race
  });

  it("self-read falls back to the author-less leg", async () => {
    const pk = uniquePubkey();
    registerPaytoOwnPubkey(pk);
    const event = makeEvent(pk);
    routeCollect({ scoped: [], authorless: [makeEvent(THIRD), event] });

    await expect(fetchPaytoEvent(pk)).resolves.toBe(event);
  });

  it("self author-less leg ignores other authors' events", async () => {
    const pk = uniquePubkey();
    registerPaytoOwnPubkey(pk);
    routeCollect({ scoped: [], authorless: [makeEvent(OTHER)] });

    await expect(fetchPaytoEvent(pk)).resolves.toBeNull();
  });

  it("self-read races both legs concurrently", async () => {
    const pk = uniquePubkey();
    registerPaytoOwnPubkey(pk);
    const scoped = deferred<Event[]>();
    const authorless = deferred<Event[]>();
    mockCollectOnce.mockImplementation((filters: any[]) =>
      filters[0].authors?.length ? scoped.promise : authorless.promise
    );

    const result = fetchPaytoEvent(pk);
    // Let the store probe settle so both legs are issued.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockCollectOnce).toHaveBeenCalledTimes(2);

    authorless.resolve([]);
    scoped.resolve([makeEvent(pk)]);
    await expect(result).resolves.toMatchObject({ pubkey: pk });
  });

  it("dedupes concurrent non-forced calls into one in-flight read", async () => {
    const pk = uniquePubkey();
    routeCollect({ scoped: [makeEvent(pk)] });

    const p1 = fetchPaytoEvent(pk);
    const p2 = fetchPaytoEvent(pk);
    await Promise.all([p1, p2]);

    // One store probe, and only the non-self leg set (warm 10002 + scoped 10133).
    expect(mockFetchReplaceable).toHaveBeenCalledTimes(1);
    expect(mockCollectOnce).toHaveBeenCalledTimes(2);
  });

  it("resolves null when the store probe throws", async () => {
    const pk = uniquePubkey();
    mockFetchReplaceable.mockRejectedValue(new Error("worker down"));

    await expect(fetchPaytoEvent(pk)).resolves.toBeNull();
    expect(mockCollectOnce).not.toHaveBeenCalled();
  });

  it("invalidatePaytoCache seeds the memo with a freshly published event", async () => {
    const pk = uniquePubkey();
    const event = makeEvent(pk);
    invalidatePaytoCache(pk, event);

    await expect(fetchPaytoEvent(pk)).resolves.toBe(event);
    expect(mockFetchReplaceable).not.toHaveBeenCalled();
  });

  it("forceRefetch keeps a known hit when the refresh misses", async () => {
    const pk = uniquePubkey();
    const event = makeEvent(pk);
    invalidatePaytoCache(pk, event);
    // Refresh finds nothing, anywhere.
    mockFetchReplaceable.mockResolvedValue(null);
    routeCollect({ scoped: [], authorless: [] });

    await expect(fetchPaytoEvent(pk, { forceRefetch: true })).resolves.toBe(
      event
    );
    // The cache still holds the good value for later callers.
    mockFetchReplaceable.mockClear();
    mockCollectOnce.mockClear();
    await expect(fetchPaytoEvent(pk)).resolves.toBe(event);
    expect(mockFetchReplaceable).not.toHaveBeenCalled();
  });

  it("forceRefetch on a memoized miss retries the network", async () => {
    const pk = uniquePubkey();
    mockFetchReplaceable.mockResolvedValue(null);
    routeCollect({ scoped: [] });

    await expect(fetchPaytoEvent(pk)).resolves.toBeNull();
    expect(mockCollectOnce).toHaveBeenCalledTimes(2); // warm + scoped

    const event = makeEvent(pk);
    routeCollect({ scoped: [event] });
    await expect(fetchPaytoEvent(pk, { forceRefetch: true })).resolves.toBe(
      event
    );
  });

  it("a failed refresh never downgrades a cached target to null", async () => {
    const pk = uniquePubkey();
    const event = makeEvent(pk);
    invalidatePaytoCache(pk, event);
    mockFetchReplaceable.mockRejectedValue(new Error("worker down"));

    await expect(
      fetchPaytoEvent(pk, { forceRefetch: true })
    ).resolves.toBe(event);
  });
});
