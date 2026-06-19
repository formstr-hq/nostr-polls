import { matchFilter, matchAnyFilter, generateFilterHash, chunkFilter } from "./matchFilter";
import { makeEvent } from "../testkit";

describe("matchFilter", () => {
  it("matches by id, author, kind", () => {
    const e = makeEvent({ id: "x".repeat(64), pubkey: "p".repeat(64), kind: 1 });
    expect(matchFilter(e, { ids: [e.id] })).toBe(true);
    expect(matchFilter(e, { ids: ["y".repeat(64)] })).toBe(false);
    expect(matchFilter(e, { authors: [e.pubkey] })).toBe(true);
    expect(matchFilter(e, { authors: ["q".repeat(64)] })).toBe(false);
    expect(matchFilter(e, { kinds: [1] })).toBe(true);
    expect(matchFilter(e, { kinds: [2, 3] })).toBe(false);
  });

  it("applies since/until inclusively", () => {
    const e = makeEvent({ created_at: 1000 });
    expect(matchFilter(e, { since: 1000 })).toBe(true);
    expect(matchFilter(e, { since: 1001 })).toBe(false);
    expect(matchFilter(e, { until: 1000 })).toBe(true);
    expect(matchFilter(e, { until: 999 })).toBe(false);
  });

  it("ORs values within a tag, ANDs across distinct tag keys", () => {
    const e = makeEvent({
      tags: [
        ["e", "root"],
        ["p", "alice"],
      ],
    });
    // OR within #e
    expect(matchFilter(e, { "#e": ["root", "other"] } as any)).toBe(true);
    expect(matchFilter(e, { "#e": ["other"] } as any)).toBe(false);
    // AND across #e and #p
    expect(matchFilter(e, { "#e": ["root"], "#p": ["alice"] } as any)).toBe(true);
    expect(matchFilter(e, { "#e": ["root"], "#p": ["bob"] } as any)).toBe(false);
  });

  it("ANDs across fields", () => {
    const e = makeEvent({ kind: 1, pubkey: "p".repeat(64) });
    expect(matchFilter(e, { kinds: [1], authors: [e.pubkey] })).toBe(true);
    expect(matchFilter(e, { kinds: [1], authors: ["other"] })).toBe(false);
  });

  it("ignores limit (not a matching concern)", () => {
    const e = makeEvent();
    expect(matchFilter(e, { limit: 0 })).toBe(true);
  });

  it("matchAnyFilter is the OR of filters", () => {
    const e = makeEvent({ kind: 7 });
    expect(matchAnyFilter(e, [{ kinds: [1] }, { kinds: [7] }])).toBe(true);
    expect(matchAnyFilter(e, [{ kinds: [1] }, { kinds: [6] }])).toBe(false);
  });
});

describe("generateFilterHash", () => {
  it("is order-insensitive over filter values and relays", () => {
    const a = generateFilterHash([{ authors: ["a", "b"], kinds: [1] }], ["wss://x", "wss://y"]);
    const b = generateFilterHash([{ kinds: [1], authors: ["b", "a"] }], ["wss://y", "wss://x"]);
    expect(a).toBe(b);
  });

  it("differs when filters differ", () => {
    const a = generateFilterHash([{ kinds: [1] }], ["wss://x"]);
    const b = generateFilterHash([{ kinds: [2] }], ["wss://x"]);
    expect(a).not.toBe(b);
  });
});

describe("chunkFilter", () => {
  it("returns the filter unchanged when under the chunk size", () => {
    const f = { authors: ["a", "b"], kinds: [1] };
    expect(chunkFilter(f, 1000)).toEqual([f]);
  });

  it("splits large author lists, preserving other fields", () => {
    const authors = Array.from({ length: 2500 }, (_, i) => `a${i}`);
    const chunks = chunkFilter({ authors, kinds: [1] }, 1000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].authors).toHaveLength(1000);
    expect(chunks[2].authors).toHaveLength(500);
    expect(chunks.every((c) => c.kinds?.[0] === 1)).toBe(true);
    expect(chunks.flatMap((c) => c.authors!)).toHaveLength(2500);
  });
});
