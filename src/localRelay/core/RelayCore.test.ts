import { RelayCore } from "./RelayCore";
import { EventDB } from "./EventDB";
import { RelayMessage } from "./protocol";
import { makeEvent } from "../testkit";

const NOW = 1_000_000;

function setup() {
  const db = new EventDB(() => NOW);
  const out: RelayMessage[] = [];
  const core = new RelayCore(db, (m) => out.push(m));
  return { db, core, out };
}

const eventsFor = (out: RelayMessage[], subId: string) =>
  out.filter((m) => m[0] === "EVENT" && m[1] === subId).map((m) => (m as any)[2].id);

describe("RelayCore REQ", () => {
  it("replays stored matches newest-first, then EOSE", () => {
    const { db, core, out } = setup();
    db.add(makeEvent({ id: "a".repeat(64), created_at: 100 }));
    db.add(makeEvent({ id: "b".repeat(64), created_at: 300 }));
    db.add(makeEvent({ id: "c".repeat(64), created_at: 200 }));

    core.handle(["REQ", "sub1", { kinds: [1] }]);

    expect(eventsFor(out, "sub1")).toEqual(["b".repeat(64), "c".repeat(64), "a".repeat(64)]);
    const eoseIdx = out.findIndex((m) => m[0] === "EOSE");
    const lastEventIdx = out.map((m) => m[0]).lastIndexOf("EVENT");
    expect(eoseIdx).toBeGreaterThan(lastEventIdx); // EOSE after all stored events
  });

  it("streams live events after EOSE to matching subs only", () => {
    const { core, out } = setup();
    core.handle(["REQ", "notes", { kinds: [1] }]);
    core.handle(["REQ", "polls", { kinds: [1068] }]);

    core.handle(["EVENT", makeEvent({ id: "n".repeat(64), kind: 1 })]);
    core.handle(["EVENT", makeEvent({ id: "p".repeat(64), kind: 1068 })]);

    expect(eventsFor(out, "notes")).toEqual(["n".repeat(64)]);
    expect(eventsFor(out, "polls")).toEqual(["p".repeat(64)]);
  });

  it("stops delivery after CLOSE", () => {
    const { core, out } = setup();
    core.handle(["REQ", "sub1", { kinds: [1] }]);
    core.handle(["CLOSE", "sub1"]);
    core.handle(["EVENT", makeEvent({ id: "x".repeat(64), kind: 1 })]);
    expect(eventsFor(out, "sub1")).toEqual([]);
    expect(core.activeSubscriptionCount()).toBe(0);
  });

  it("does not re-deliver an already-replayed event", () => {
    const { db, core, out } = setup();
    const e = makeEvent({ id: "a".repeat(64), kind: 1 });
    db.add(e);
    core.handle(["REQ", "sub1", { kinds: [1] }]);
    // Re-publish the same event — duplicate add, must not double-deliver.
    core.handle(["EVENT", e]);
    expect(eventsFor(out, "sub1")).toEqual(["a".repeat(64)]);
  });
});

describe("RelayCore EVENT / INGEST", () => {
  it("acks published events with OK and stores them", () => {
    const { db, core, out } = setup();
    const e = makeEvent({ id: "a".repeat(64) });
    core.handle(["EVENT", e]);
    expect(out.find((m) => m[0] === "OK")).toEqual(["OK", e.id, true, ""]);
    expect(db.getById(e.id)).toBeDefined();
  });

  it("rejects malformed events with OK=false", () => {
    const { core, out } = setup();
    core.handle(["EVENT", { id: "bad" } as any]);
    const ok = out.find((m) => m[0] === "OK") as any;
    expect(ok[2]).toBe(false);
  });

  it("ingests a batch silently (no OK) and fans out", () => {
    const { db, core, out } = setup();
    core.handle(["REQ", "sub1", { kinds: [1] }]);
    core.handle(["INGEST", [makeEvent({ id: "a".repeat(64) }), makeEvent({ id: "b".repeat(64) })]]);
    expect(out.some((m) => m[0] === "OK")).toBe(false);
    expect(eventsFor(out, "sub1").sort()).toEqual(["a".repeat(64), "b".repeat(64)]);
    expect(db.allEvents()).toHaveLength(2);
  });

  it("delivers ephemeral events to live subs without storing", () => {
    const { db, core, out } = setup();
    core.handle(["REQ", "sub1", { kinds: [20001] }]);
    core.handle(["EVENT", makeEvent({ id: "e".repeat(64), kind: 20001 })]);
    expect(eventsFor(out, "sub1")).toEqual(["e".repeat(64)]);
    expect(db.query({ kinds: [20001] })).toHaveLength(0);
  });
});
