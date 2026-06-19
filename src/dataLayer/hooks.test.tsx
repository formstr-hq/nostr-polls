import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { DataLayerProvider, useEvents } from "./hooks";
import { DataLayer } from "./client";
import { RelayService } from "../localRelay/RelayService";
import { LocalRelayClient } from "../localRelay/transport/LocalRelayClient";
import { createChannelPair } from "../localRelay/transport/channel";
import { MemoryStorage } from "../localRelay/storage/MemoryStorage";
import { fakeSocketFactory, makeEvent } from "../localRelay/testkit";
import type { ScopeUser } from "./scope";
import type { EventTemplate } from "nostr-tools";

const NOW = 1_000_000;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 90)); });
const reqOn = (sock: { sent: any[] }) => sock.sent.filter((m) => m[0] === "REQ");

async function wire(user: ScopeUser) {
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
  const sign = async (t: EventTemplate) => makeEvent({ kind: t.kind });
  const dataLayer = new DataLayer({ client, sign });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DataLayerProvider user={user} dataLayer={dataLayer}>{children}</DataLayerProvider>
  );
  return { f, service, dataLayer, wrapper };
}

const note = (id: string, created_at: number) =>
  makeEvent({ id: id.repeat(64), kind: 1, pubkey: "me", created_at });

describe("useEvents", () => {
  it("assembles an author feed from upstream, newest-first", async () => {
    const { f, wrapper } = await wire({ pubkey: "me", follows: ["me"] });

    const { result } = renderHook(
      () => useEvents({ kinds: [1], scope: { type: "author", pubkey: "me" } }),
      { wrapper }
    );
    await settle();

    const sock = f.last("wss://u1"); // sync() opened the upstream read
    act(() => sock.open());
    const subId = reqOn(sock)[0][1];
    act(() => {
      sock.emit(["EVENT", subId, note("a", NOW - 100)]);
      sock.emit(["EVENT", subId, note("b", NOW - 50)]);
    });
    await settle();

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.map((e) => e.id)).toEqual(["b".repeat(64), "a".repeat(64)]);
  });

  it("buffers events that arrive newer than the top until showNew()", async () => {
    const { f, service, wrapper } = await wire({ pubkey: "me", follows: ["me"] });
    // Seed one stored event so initial EOSE has a top-of-feed timestamp.
    service.db.add(note("a", NOW - 100));

    const { result } = renderHook(
      () => useEvents({ kinds: [1], scope: { type: "author", pubkey: "me" } }),
      { wrapper }
    );
    await settle();
    await waitFor(() => expect(result.current.items).toHaveLength(1)); // cached 'a' shown

    const sock = f.last("wss://u1");
    act(() => sock.open());
    const subId = reqOn(sock)[0][1];
    act(() => sock.emit(["EVENT", subId, note("b", NOW - 10)])); // newer than top
    await settle();

    expect(result.current.newCount).toBe(1); // buffered, not shown
    expect(result.current.items).toHaveLength(1);

    act(() => result.current.showNew());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.newCount).toBe(0);
    expect(result.current.items[0].id).toBe("b".repeat(64));
  });
});
