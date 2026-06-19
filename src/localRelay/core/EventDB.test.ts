import { EventDB } from "./EventDB";
import { defaultPrunePolicy, StoreChange } from "./types";
import { makeEvent } from "../testkit";

const NOW = 1_000_000;
const db = () => new EventDB(() => NOW);

describe("EventDB query", () => {
  it("returns matches newest-first and honours limit", () => {
    const store = db();
    store.add(makeEvent({ id: "a".repeat(64), created_at: 100 }));
    store.add(makeEvent({ id: "b".repeat(64), created_at: 300 }));
    store.add(makeEvent({ id: "c".repeat(64), created_at: 200 }));
    const all = store.query({ kinds: [1] });
    expect(all.map((e) => e.created_at)).toEqual([300, 200, 100]);
    expect(store.query({ kinds: [1], limit: 2 }).map((e) => e.created_at)).toEqual([300, 200]);
  });

  it("uses author/kind/tag indexes equivalently to a full scan", () => {
    const store = db();
    const mine = makeEvent({ pubkey: "p".repeat(64), tags: [["t", "nostr"]] });
    store.add(mine);
    store.add(makeEvent({ pubkey: "q".repeat(64) }));
    expect(store.query({ authors: [mine.pubkey] })).toHaveLength(1);
    expect(store.query({ "#t": ["nostr"] } as any)).toHaveLength(1);
    expect(store.query({ "#t": ["bitcoin"] } as any)).toHaveLength(0);
  });
});

describe("replaceable & ephemeral", () => {
  it("keeps only the latest replaceable (kind 0)", () => {
    const store = db();
    const pubkey = "p".repeat(64);
    store.add(makeEvent({ id: "0".repeat(64), kind: 0, pubkey, created_at: 100 }));
    store.add(makeEvent({ id: "1".repeat(64), kind: 0, pubkey, created_at: 200 }));
    const res = store.query({ kinds: [0], authors: [pubkey] });
    expect(res).toHaveLength(1);
    expect(res[0].created_at).toBe(200);
  });

  it("rejects an older replaceable", () => {
    const store = db();
    const pubkey = "p".repeat(64);
    store.add(makeEvent({ id: "1".repeat(64), kind: 0, pubkey, created_at: 200 }));
    expect(store.add(makeEvent({ id: "0".repeat(64), kind: 0, pubkey, created_at: 100 }))).toBe(false);
    expect(store.query({ kinds: [0] })).toHaveLength(1);
  });

  it("scopes addressable (30023) replacement by d-tag", () => {
    const store = db();
    const pubkey = "p".repeat(64);
    store.add(makeEvent({ id: "a".repeat(64), kind: 30023, pubkey, created_at: 100, tags: [["d", "post-1"]] }));
    store.add(makeEvent({ id: "b".repeat(64), kind: 30023, pubkey, created_at: 100, tags: [["d", "post-2"]] }));
    store.add(makeEvent({ id: "c".repeat(64), kind: 30023, pubkey, created_at: 200, tags: [["d", "post-1"]] }));
    const res = store.query({ kinds: [30023] });
    expect(res).toHaveLength(2); // two distinct d-tags
    expect(res.find((e) => e.tags[0][1] === "post-1")!.created_at).toBe(200);
  });

  it("does not store ephemeral events", () => {
    const store = db();
    expect(store.add(makeEvent({ kind: 20001 }))).toBe(false);
    expect(store.query({ kinds: [20001] })).toHaveLength(0);
  });
});

describe("NIP-09 deletion", () => {
  it("removes the author's own event and blocks re-add", () => {
    const store = db();
    const pubkey = "p".repeat(64);
    const note = makeEvent({ id: "n".repeat(64), pubkey, kind: 1 });
    store.add(note);
    store.add(makeEvent({ id: "d".repeat(64), pubkey, kind: 5, tags: [["e", note.id]] }));
    expect(store.getById(note.id)).toBeUndefined();
    expect(store.isDeleted(note.id)).toBe(true);
    expect(store.add(note)).toBe(false); // re-add rejected
  });

  it("ignores a deletion that targets another author's event", () => {
    const store = db();
    const note = makeEvent({ id: "n".repeat(64), pubkey: "alice".padEnd(64, "0"), kind: 1 });
    store.add(note);
    store.add(makeEvent({ id: "d".repeat(64), pubkey: "mallory".padEnd(64, "0"), kind: 5, tags: [["e", note.id]] }));
    expect(store.getById(note.id)).toBeDefined();
  });
});

describe("NIP-40 expiration", () => {
  it("hides and prunes expired events", () => {
    const store = db();
    const expired = makeEvent({ id: "e".repeat(64), tags: [["expiration", String(NOW - 10)]] });
    const live = makeEvent({ id: "f".repeat(64), tags: [["expiration", String(NOW + 1000)]] });
    store.add(expired);
    store.add(live);
    expect(store.query({ kinds: [1] })).toHaveLength(1);
    expect(store.getById(expired.id)).toBeUndefined();
    expect(store.prune()).toBeGreaterThanOrEqual(1);
  });
});

describe("prune policy", () => {
  it("removes events past their per-kind TTL but keeps protected kinds", () => {
    const store = db();
    const policy = defaultPrunePolicy();
    const old = NOW - 8 * 24 * 60 * 60; // 8 days — past the 7-day default TTL
    store.add(makeEvent({ id: "1".repeat(64), kind: 1, created_at: old }));
    store.add(makeEvent({ id: "3".repeat(64), kind: 3, pubkey: "p".repeat(64), created_at: old })); // protected
    store.add(makeEvent({ id: "a".repeat(64), kind: 30023, created_at: old, tags: [["d", "x"]] })); // long TTL
    const pruned = store.prune(policy);
    expect(pruned).toBe(1);
    expect(store.query({ kinds: [1] })).toHaveLength(0);
    expect(store.query({ kinds: [3] })).toHaveLength(1);
    expect(store.query({ kinds: [30023] })).toHaveLength(1);
  });

  it("enforces the hard cap by evicting oldest non-protected", () => {
    const store = db();
    const policy = { ...defaultPrunePolicy(), maxEvents: 2, defaultTtlSeconds: 10 ** 9 };
    store.add(makeEvent({ id: "1".repeat(64), created_at: NOW - 3 }));
    store.add(makeEvent({ id: "2".repeat(64), created_at: NOW - 2 }));
    store.add(makeEvent({ id: "3".repeat(64), created_at: NOW - 1 }));
    store.prune(policy);
    const remaining = store.query({ kinds: [1] }).map((e) => e.created_at);
    expect(remaining).toEqual([NOW - 1, NOW - 2]); // oldest evicted
  });
});

describe("change emitter + hydration", () => {
  it("emits add and remove", () => {
    const store = db();
    const changes: StoreChange[] = [];
    store.onChange((c) => changes.push(c));
    const note = makeEvent({ id: "n".repeat(64), pubkey: "p".repeat(64) });
    store.add(note);
    store.add(makeEvent({ id: "d".repeat(64), pubkey: "p".repeat(64), kind: 5, tags: [["e", note.id]] }));
    expect(changes[0]).toEqual({ type: "add", event: note });
    expect(changes.some((c) => c.type === "remove" && c.id === note.id)).toBe(true);
  });

  it("bulkLoad does not emit and reports stored count", () => {
    const store = db();
    let emits = 0;
    store.onChange(() => emits++);
    const added = store.bulkLoad([
      makeEvent({ id: "1".repeat(64) }),
      makeEvent({ id: "2".repeat(64) }),
      makeEvent({ id: "2".repeat(64) }), // duplicate id
    ]);
    expect(added).toBe(2);
    expect(emits).toBe(0);
    expect(store.allEvents()).toHaveLength(2);
  });
});
