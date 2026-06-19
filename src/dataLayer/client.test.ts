import { DataLayer } from "./client";
import { RelayService } from "../localRelay/RelayService";
import { LocalRelayClient } from "../localRelay/transport/LocalRelayClient";
import { createChannelPair } from "../localRelay/transport/channel";
import { MemoryStorage } from "../localRelay/storage/MemoryStorage";
import { fakeSocketFactory, makeEvent } from "../localRelay/testkit";
import type { EventTemplate } from "nostr-tools";

const NOW = 1_000_000;
const settle = () => new Promise((r) => setTimeout(r, 80));
const reqOn = (sock: { sent: any[] }) => sock.sent.filter((m) => m[0] === "REQ");

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
  // Sign = stamp the template into a complete event (no real crypto in tests).
  const sign = async (t: EventTemplate) =>
    makeEvent({ id: "s".repeat(64), kind: t.kind, pubkey: "me", content: t.content, tags: t.tags });
  const dataLayer = new DataLayer({ client, sign });
  await settle();
  return { f, service, client, dataLayer };
}

describe("DataLayer", () => {
  it("publish signs, stores locally, sends upstream, and reports per-relay outcome", async () => {
    const { f, service, dataLayer } = await wire();

    const pending = dataLayer.publish({ kind: 1, content: "hi", tags: [], created_at: NOW });
    await settle();

    expect(service.db.getById("s".repeat(64))).toBeDefined(); // stored locally
    const sock = f.last("wss://u1");
    sock.open(); // flush the queued publish
    expect(sock.sent.some((m) => m[0] === "EVENT" && m[1].id === "s".repeat(64))).toBe(true);

    sock.emit(["OK", "s".repeat(64), true, ""]); // relay accepts
    const { event, result } = await pending;

    expect(event.id).toBe("s".repeat(64));
    expect(result.ok).toBe(true);
    expect(result.relayResults).toEqual([
      { relay: "wss://u1", status: "accepted", message: undefined, latencyMs: expect.any(Number) },
    ]);
  });

  it("publishEvent reports a rejection reason from the relay", async () => {
    const { f, dataLayer } = await wire();
    const ev = makeEvent({ id: "r".repeat(64), kind: 1, pubkey: "me" });

    const pending = dataLayer.publishEvent(ev);
    await settle();
    const sock = f.last("wss://u1");
    sock.open();
    sock.emit(["OK", "r".repeat(64), false, "blocked: spam"]);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.relayResults[0]).toMatchObject({ status: "rejected", message: "blocked: spam" });
  });

  it("relayHealth reports configured + connected relays", async () => {
    const { f, dataLayer } = await wire();
    // An interest gives the worker a reason to connect to wss://u1.
    dataLayer.observe([{ kinds: [1], authors: ["alice"] }], { onEvent: () => {} });
    await settle();
    f.last("wss://u1").open();

    const health = await dataLayer.relayHealth();
    expect(health.find((h) => h.relay === "wss://u1")?.connected).toBe(true);
  });

  it("fetchById returns a cached event without touching the network", async () => {
    const { f, service, dataLayer } = await wire();
    service.db.add(makeEvent({ id: "c".repeat(64), kind: 1, pubkey: "alice" }));

    const found = await dataLayer.fetchById("c".repeat(64));

    expect(found?.id).toBe("c".repeat(64));
    expect(f.count("wss://u1")).toBe(0); // cache hit opened no socket
  });

  it("fetchById fills a cold miss from upstream, then resolves", async () => {
    const { f, dataLayer } = await wire();

    const promise = dataLayer.fetchById("m".repeat(64));
    await settle();

    const sock = f.last("wss://u1"); // the worker opened an upstream read
    sock.open();
    const subId = reqOn(sock)[0][1];
    sock.emit(["EVENT", subId, makeEvent({ id: "m".repeat(64), kind: 1, pubkey: "bob" })]);
    sock.emit(["EOSE", subId]);

    expect((await promise)?.id).toBe("m".repeat(64));
  });

  it("fetchById resolves null when the upstream returns nothing", async () => {
    const { f, dataLayer } = await wire();
    const promise = dataLayer.fetchById("z".repeat(64));
    await settle();
    const sock = f.last("wss://u1");
    sock.open();
    sock.emit(["EOSE", reqOn(sock)[0][1]]); // relay has it not
    expect(await promise).toBeNull();
  });
});
