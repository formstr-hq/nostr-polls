import { createChannelPair } from "./channel";
import { LocalRelayClient, LocalRelayClientOptions } from "./LocalRelayClient";
import { WorkerHost, WorkerHostHooks } from "./WorkerHost";
import { EventDB } from "../core/EventDB";
import { makeEvent } from "../testkit";
import type { EventTemplate } from "nostr-tools";

const NOW = 1_000_000;
const tick = () => new Promise((r) => setTimeout(r, 0));

function wire(opts?: LocalRelayClientOptions, hooks?: WorkerHostHooks) {
  const { client: clientCh, worker: workerCh } = createChannelPair();
  const db = new EventDB(() => NOW);
  const host = new WorkerHost(workerCh, db, hooks);
  const client = new LocalRelayClient(clientCh, opts);
  return { db, host, client };
}

describe("LocalRelayClient ↔ WorkerHost protocol", () => {
  it("observe replays cached matches, EOSEs, then streams live events", async () => {
    const { db, client } = wire();
    db.add(makeEvent({ id: "old".padEnd(64, "0") }));
    const got: string[] = [];
    let eosed = false;
    client.observe([{ kinds: [1] }], {
      onEvent: (e) => got.push(e.id),
      onEose: () => (eosed = true),
    }, { localOnly: true });
    await tick();
    expect(got).toEqual(["old".padEnd(64, "0")]);
    expect(eosed).toBe(true);

    // publish stores + fans out locally regardless of upstream result.
    client.publish(makeEvent({ id: "live".padEnd(64, "0") }));
    await tick();
    expect(got).toContain("live".padEnd(64, "0"));
  });

  it("publish stores the event locally and resolves the upstream outcome", async () => {
    let host: WorkerHost;
    const hooks: WorkerHostHooks = {
      // Stand in for RelayService: report one accepting relay.
      onPublish: (pubId) =>
        host.postPublishResult(pubId, [{ relay: "wss://r", status: "accepted", latencyMs: 0 }]),
    };
    const built = wire(undefined, hooks);
    host = built.host;
    const { db, client } = built;

    const results = await client.publish(makeEvent({ id: "c".repeat(64) }));
    expect(db.getById("c".repeat(64))).toBeDefined(); // stored locally
    expect(results).toEqual([{ relay: "wss://r", status: "accepted", latencyMs: 0 }]);
  });

  it("routes a NIP-42 sign request to the main-thread signer and back", async () => {
    const signed = makeEvent({ id: "auth".padEnd(64, "0"), kind: 22242 });
    const { host } = wire({
      onSignRequest: async (_t: EventTemplate) => signed,
    });
    const template: EventTemplate = { kind: 22242, created_at: NOW, tags: [], content: "" };
    const result = await host.signerPort.sign(template);
    expect(result).toEqual(signed);
  });

  it("resolves sign request with null when the signer refuses", async () => {
    const { host } = wire({ onSignRequest: async () => null });
    const result = await host.signerPort.sign({ kind: 22242, created_at: NOW, tags: [], content: "" });
    expect(result).toBeNull();
  });
});
