import { SyncEngine } from "./SyncEngine";
import { RelayPool } from "./RelayPool";
import { fakeSocketFactory, makeEvent } from "../testkit";
import type { Event } from "../core/types";

const tick = () => new Promise((r) => setTimeout(r, 60)); // > FLUSH_MS

const reqOn = (sock: { sent: any[] }) => sock.sent.find((m) => m[0] === "REQ");
const subIdOn = (sock: { sent: any[] }) => reqOn(sock)![1] as string;

function setup(verify: (e: Event) => boolean = () => true) {
  const f = fakeSocketFactory();
  const pool = new RelayPool(f.factory, { autoReconnect: false });
  const ingested: Event[] = [];
  const writes: Record<string, string[]> = {
    alice: ["wss://r1"],
    bob: ["wss://r2"],
  };
  const engine = new SyncEngine({
    pool,
    ingest: (events) => ingested.push(...events),
    getWriteRelays: (pk) => writes[pk] ?? [],
    verify,
  });
  return { f, engine, ingested };
}

describe("SyncEngine", () => {
  it("partitions authors by outbox: each relay gets only its authors", async () => {
    const { f, engine } = setup();
    engine.fetch({ kinds: [1], authors: ["alice", "bob"], userRelays: ["wss://u1"], eoseDeadlineMs: 10 ** 9 });

    f.last("wss://r1").open();
    f.last("wss://r2").open();

    const r1Filter = reqOn(f.last("wss://r1"))![2];
    const r2Filter = reqOn(f.last("wss://r2"))![2];
    expect(r1Filter.authors).toEqual(["alice"]);
    expect(r2Filter.authors).toEqual(["bob"]);
  });

  it("verifies, then ingests events from all buckets", async () => {
    const { f, engine, ingested } = setup();
    engine.fetch({ kinds: [1], authors: ["alice", "bob"], userRelays: ["wss://u1"], eoseDeadlineMs: 10 ** 9 });
    f.last("wss://r1").open();
    f.last("wss://r2").open();
    const s1 = subIdOn(f.last("wss://r1"));
    const s2 = subIdOn(f.last("wss://r2"));

    f.last("wss://r1").emit(["EVENT", s1, makeEvent({ id: "a".repeat(64), pubkey: "alice" })]);
    f.last("wss://r2").emit(["EVENT", s2, makeEvent({ id: "b".repeat(64), pubkey: "bob" })]);
    await tick();

    expect(ingested.map((e) => e.id).sort()).toEqual(["a".repeat(64), "b".repeat(64)]);
  });

  it("drops events that fail verification", async () => {
    const { f, engine, ingested } = setup(() => false);
    engine.fetch({ kinds: [1], authors: ["alice"], userRelays: ["wss://u1"], eoseDeadlineMs: 10 ** 9 });
    f.last("wss://r1").open();
    const s1 = subIdOn(f.last("wss://r1"));
    f.last("wss://r1").emit(["EVENT", s1, makeEvent({ id: "a".repeat(64) })]);
    await tick();
    expect(ingested).toHaveLength(0);
  });

  it("fires combined EOSE only after every bucket EOSEs", async () => {
    const { f, engine } = setup();
    let eosed = 0;
    engine.fetch(
      { kinds: [1], authors: ["alice", "bob"], userRelays: ["wss://u1"], eoseDeadlineMs: 10 ** 9 },
      () => eosed++
    );
    f.last("wss://r1").open();
    f.last("wss://r2").open();
    const s1 = subIdOn(f.last("wss://r1"));
    const s2 = subIdOn(f.last("wss://r2"));

    f.last("wss://r1").emit(["EOSE", s1]);
    expect(eosed).toBe(0); // one bucket done
    f.last("wss://r2").emit(["EOSE", s2]);
    await tick();
    expect(eosed).toBe(1); // all buckets done → fire once
  });

  it("passes the time window (since/until/limit) into the relay filter", () => {
    const { f, engine } = setup();
    engine.fetch({
      kinds: [1],
      authors: ["alice"],
      userRelays: ["wss://u1"],
      until: 5000,
      limit: 50,
      eoseDeadlineMs: 10 ** 9,
    });
    f.last("wss://r1").open();
    const filter = reqOn(f.last("wss://r1"))![2];
    expect(filter.until).toBe(5000);
    expect(filter.limit).toBe(50);
  });
});
