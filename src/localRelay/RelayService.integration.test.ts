import { RelayService } from "./RelayService";
import { LocalRelayClient } from "./transport/LocalRelayClient";
import { createChannelPair } from "./transport/channel";
import { MemoryStorage } from "./storage/MemoryStorage";
import { fakeSocketFactory, makeEvent } from "./testkit";

const NOW = 1_000_000;
// Must exceed SyncEngine's 50ms ingest flush; also lets channel microtasks run.
const settle = () => new Promise((r) => setTimeout(r, 80));

async function wire() {
  const { client: clientCh, worker: workerCh } = createChannelPair();
  const f = fakeSocketFactory();
  const service = new RelayService({
    channel: workerCh,
    socketFactory: f.factory,
    storage: new MemoryStorage(),
    verify: () => true,
    now: () => NOW,
  });
  await service.start();
  const client = new LocalRelayClient(clientCh);
  client.setUserRelays(["wss://u1"]);
  await settle();
  return { f, service, client };
}

describe("RelayService end-to-end", () => {
  it("a single subscribe serves cache AND pulls from upstream into the live feed", async () => {
    const { f, service, client } = await wire();

    const got: string[] = [];
    let eosed = false;
    client.subscribe([{ kinds: [1], authors: ["alice"] }], {
      onEvent: (e) => got.push(e.id),
      onEose: () => (eosed = true),
    });
    await settle();

    // Local EOSE arrives immediately (empty cache), proving cache-first behaviour.
    expect(eosed).toBe(true);
    expect(got).toEqual([]);

    // alice has no kind-10002 cached → SyncEngine falls back to the user relay.
    const sock = f.last("wss://u1");
    sock.open();
    const reqAuthors = sock.sent.find((m) => m[0] === "REQ")![2].authors;
    expect(reqAuthors).toEqual(["alice"]);

    // Upstream delivers an event → verify → ingest → store → live fan-out → client.
    const subId = sock.sent.find((m) => m[0] === "REQ")![1];
    sock.emit(["EVENT", subId, makeEvent({ id: "a".repeat(64), kind: 1, pubkey: "alice" })]);
    await settle();

    expect(got).toEqual(["a".repeat(64)]);
    expect(service.db.getById("a".repeat(64))).toBeDefined();
  });

  it("routes via outbox when the author's kind-10002 is in the store", async () => {
    const { f, service, client } = await wire();

    // Seed alice's relay list so the outbox cache (the store) knows her write relay.
    service.db.add(
      makeEvent({ id: "r".repeat(64), kind: 10002, pubkey: "alice", tags: [["r", "wss://alice-relay"]] })
    );

    client.subscribe([{ kinds: [1], authors: ["alice"] }], { onEvent: () => {} });
    await settle();

    // The fetch should target alice's write relay, not just the user relay.
    expect(f.count("wss://alice-relay")).toBe(1);
    f.last("wss://alice-relay").open(); // flush the queued REQ
    const authors = f.last("wss://alice-relay").sent.find((m) => m[0] === "REQ")![2].authors;
    expect(authors).toEqual(["alice"]);
  });
});
