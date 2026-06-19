import { Persistence } from "./persistence";
import { MemoryStorage } from "./MemoryStorage";
import { EventDB } from "../core/EventDB";
import { defaultPrunePolicy } from "../core/types";
import { makeEvent } from "../testkit";

const NOW = 1_000_000;

// No prune timer / no auto-flush timer interference: we drive flush() manually.
const noTimers = { pruneIntervalMs: 0, debounceMs: 10_000 };

describe("Persistence hydration", () => {
  it("loads persisted events into the DB on start (without echoing back)", async () => {
    const storage = new MemoryStorage();
    await storage.batchPut([makeEvent({ id: "a".repeat(64) }), makeEvent({ id: "b".repeat(64) })]);

    const db = new EventDB(() => NOW);
    const p = new Persistence(db, storage, noTimers);
    await p.start();

    expect(db.allEvents()).toHaveLength(2);
    // Hydration must not re-queue writes back to storage.
    await p.flush();
    expect(storage.size).toBe(2);
  });
});

describe("Persistence write-through", () => {
  it("persists added events on flush", async () => {
    const storage = new MemoryStorage();
    const db = new EventDB(() => NOW);
    const p = new Persistence(db, storage, noTimers);
    await p.start();

    db.add(makeEvent({ id: "a".repeat(64) }));
    db.add(makeEvent({ id: "b".repeat(64) }));
    expect(storage.size).toBe(0); // debounced, not yet written
    await p.flush();
    expect(storage.size).toBe(2);
  });

  it("propagates deletions (NIP-09) to storage", async () => {
    const storage = new MemoryStorage();
    const db = new EventDB(() => NOW);
    const p = new Persistence(db, storage, noTimers);
    await p.start();

    const note = makeEvent({ id: "n".repeat(64), pubkey: "p".repeat(64) });
    db.add(note);
    await p.flush();
    expect(storage.size).toBe(1);

    db.add(makeEvent({ id: "d".repeat(64), pubkey: "p".repeat(64), kind: 5, tags: [["e", note.id]] }));
    await p.flush();
    expect((await storage.loadAll()).find((e) => e.id === note.id)).toBeUndefined();
  });

  it("coalesces add-then-delete within one debounce window", async () => {
    const storage = new MemoryStorage();
    const db = new EventDB(() => NOW);
    const p = new Persistence(db, storage, noTimers);
    await p.start();

    const note = makeEvent({ id: "n".repeat(64), pubkey: "p".repeat(64) });
    db.add(note);
    db.add(makeEvent({ id: "d".repeat(64), pubkey: "p".repeat(64), kind: 5, tags: [["e", note.id]] }));
    await p.flush();
    expect(storage.size).toBe(0); // never persisted, then deleted — net zero
  });
});

describe("Persistence pruning", () => {
  it("prune removes from DB and storage", async () => {
    const storage = new MemoryStorage();
    const db = new EventDB(() => NOW);
    const policy = { ...defaultPrunePolicy(), defaultTtlSeconds: 60 };
    const p = new Persistence(db, storage, { ...noTimers, prunePolicy: policy });
    await p.start();

    db.add(makeEvent({ id: "old".padEnd(64, "0"), created_at: NOW - 1000 }));
    db.add(makeEvent({ id: "new".padEnd(64, "0"), created_at: NOW - 1 }));
    await p.flush();
    expect(storage.size).toBe(2);

    const pruned = p.pruneNow();
    await p.flush();
    expect(pruned).toBe(1);
    const remaining = await storage.loadAll();
    expect(remaining.map((e) => e.id)).toEqual(["new".padEnd(64, "0")]);
  });
});

describe("Persistence debounce timer", () => {
  it("auto-flushes after the debounce interval", async () => {
    jest.useFakeTimers();
    try {
      const storage = new MemoryStorage();
      const db = new EventDB(() => NOW);
      const p = new Persistence(db, storage, { debounceMs: 1000, pruneIntervalMs: 0 });
      await p.start();

      db.add(makeEvent({ id: "a".repeat(64) }));
      expect(storage.size).toBe(0);
      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // let the async flush settle
      await Promise.resolve();
      expect(storage.size).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
