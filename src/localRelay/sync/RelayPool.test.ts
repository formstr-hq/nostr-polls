import { RelayPool } from "./RelayPool";
import { RelayConnection, RelayConnectionHandlers } from "./RelayConnection";
import { fakeSocketFactory } from "../testkit";
import { makeEvent } from "../testkit";

const A = "wss://a";
const B = "wss://b";

// subId the pool assigned, read off the REQ frame the socket received.
const subIdOn = (sock: { sent: any[] }) =>
  sock.sent.find((m) => m[0] === "REQ")![1] as string;

function pool() {
  const f = fakeSocketFactory();
  const p = new RelayPool(f.factory, { autoReconnect: false });
  return { f, p };
}

describe("RelayPool EOSE contract", () => {
  it("fires EOSE only after EVERY relay has sent it (not the first)", () => {
    const { f, p } = pool();
    let eosed = 0;
    p.subscribe([A, B], [{ kinds: [1] }], { onEvent: () => {}, onEose: () => eosed++ }, { eoseDeadlineMs: 10 ** 9 });
    f.last(A).open();
    f.last(B).open();
    const sub = subIdOn(f.last(A));

    f.last(A).emit(["EOSE", sub]);
    expect(eosed).toBe(0); // one relay done — NOT enough

    f.last(B).emit(["EOSE", sub]);
    expect(eosed).toBe(1); // all done — fires once
  });

  it("forces EOSE after the deadline when a relay never replies", () => {
    jest.useFakeTimers();
    try {
      const { f, p } = pool();
      let eosed = 0;
      p.subscribe([A, B], [{ kinds: [1] }], { onEvent: () => {}, onEose: () => eosed++ }, { eoseDeadlineMs: 5000 });
      f.last(A).open();
      f.last(B).open();
      const sub = subIdOn(f.last(A));
      f.last(A).emit(["EOSE", sub]); // B never responds

      expect(eosed).toBe(0);
      jest.advanceTimersByTime(5000);
      expect(eosed).toBe(1);

      // A late EOSE from B must not double-fire.
      f.last(B).emit(["EOSE", sub]);
      expect(eosed).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("counts CLOSED as done and isolates a failing relay", () => {
    const { f, p } = pool();
    let eosed = 0;
    const got: string[] = [];
    p.subscribe([A, B], [{ kinds: [1] }], { onEvent: (e) => got.push(e.id), onEose: () => eosed++ }, { eoseDeadlineMs: 10 ** 9 });
    f.last(A).open();
    f.last(B).open();
    const sub = subIdOn(f.last(A));

    f.last(A).emit(["EVENT", sub, makeEvent({ id: "a".repeat(64) })]);
    f.last(A).emit(["EOSE", sub]);
    f.last(B).emit(["CLOSED", sub, "auth-required"]); // B fails

    expect(got).toEqual(["a".repeat(64)]); // A's events still delivered
    expect(eosed).toBe(1); // CLOSED let aggregation complete
  });
});

describe("RelayPool delivery", () => {
  it("de-duplicates the same event across relays", () => {
    const { f, p } = pool();
    const got: string[] = [];
    p.subscribe([A, B], [{ kinds: [1] }], { onEvent: (e) => got.push(e.id) }, { eoseDeadlineMs: 10 ** 9 });
    f.last(A).open();
    f.last(B).open();
    const sub = subIdOn(f.last(A));

    const dup = makeEvent({ id: "d".repeat(64) });
    f.last(A).emit(["EVENT", sub, dup]);
    f.last(B).emit(["EVENT", sub, dup]); // same id from another relay

    expect(got).toEqual(["d".repeat(64)]);
  });

  it("keeps delivering live events after EOSE", () => {
    const { f, p } = pool();
    const got: string[] = [];
    p.subscribe([A], [{ kinds: [1] }], { onEvent: (e) => got.push(e.id) }, { eoseDeadlineMs: 10 ** 9 });
    f.last(A).open();
    const sub = subIdOn(f.last(A));
    f.last(A).emit(["EOSE", sub]);
    f.last(A).emit(["EVENT", sub, makeEvent({ id: "late".padEnd(64, "0") })]);
    expect(got).toEqual(["late".padEnd(64, "0")]);
  });

  it("query() resolves on EOSE and closes the sub", async () => {
    const { f, p } = pool();
    const promise = p.query([A], { kinds: [1] }, { eoseDeadlineMs: 10 ** 9 });
    f.last(A).open();
    const sub = subIdOn(f.last(A));
    f.last(A).emit(["EVENT", sub, makeEvent({ id: "q".repeat(64) })]);
    f.last(A).emit(["EOSE", sub]);

    const events = await promise;
    expect(events.map((e) => e.id)).toEqual(["q".repeat(64)]);
    expect(f.last(A).sent.some((m) => m[0] === "CLOSE")).toBe(true);
  });
});

describe("RelayConnection reconnect", () => {
  it("resubscribes active REQs on a fresh socket after a drop", () => {
    jest.useFakeTimers();
    try {
      const f = fakeSocketFactory();
      const handlers: RelayConnectionHandlers = { onEvent: () => {}, onEose: () => {}, onClosed: () => {} };
      const conn = new RelayConnection(A, f.factory, handlers, { autoReconnect: true, baseBackoffMs: 1000 });
      conn.req("sub", [{ kinds: [1] }]);
      f.last(A).open(); // flush initial REQ
      expect(f.last(A).sent.some((m) => m[0] === "REQ")).toBe(true);

      f.last(A).close(); // drop → schedules reconnect
      jest.advanceTimersByTime(1000); // backoff is random*1000 ≤ 1000ms
      expect(f.count(A)).toBe(2); // new socket created

      f.last(A).open(); // reconnect opens → resubscribe
      expect(f.last(A).sent.some((m) => m[0] === "REQ" && m[1] === "sub")).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
