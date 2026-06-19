import { partitionAuthorsByRelay, relaysForAuthors } from "./outbox";

const USER = ["wss://user1", "wss://user2"];

describe("partitionAuthorsByRelay", () => {
  it("routes each author to the relays they write to", () => {
    const writes: Record<string, string[]> = {
      alice: ["wss://r1"],
      bob: ["wss://r2"],
      carol: ["wss://r1", "wss://r2"],
    };
    const plan = partitionAuthorsByRelay(["alice", "bob", "carol"], USER, (pk) => writes[pk] ?? []);
    expect(Array.from(plan.get("wss://r1")!)).toEqual(expect.arrayContaining(["alice", "carol"]));
    expect(Array.from(plan.get("wss://r2")!)).toEqual(expect.arrayContaining(["bob", "carol"]));
    // bob does not write to r1
    expect(plan.get("wss://r1")!.has("bob")).toBe(false);
  });

  it("falls back to user relays for authors with no known outbox (no author dropped)", () => {
    const plan = partitionAuthorsByRelay(["ghost"], USER, () => []);
    for (const r of USER) expect(plan.get(r)!.has("ghost")).toBe(true);

    // Coverage guarantee: union of all buckets covers every input author.
    const covered = new Set<string>();
    for (const set of Array.from(plan.values())) for (const a of Array.from(set)) covered.add(a);
    expect(covered.has("ghost")).toBe(true);
  });

  it("respects maxRelays and still covers every author", () => {
    const writes: Record<string, string[]> = {};
    const authors: string[] = [];
    // 30 authors each on a distinct relay → far more relays than the cap.
    for (let i = 0; i < 30; i++) {
      const a = `a${i}`;
      authors.push(a);
      writes[a] = [`wss://relay${i}`];
    }
    const plan = partitionAuthorsByRelay(authors, USER, (pk) => writes[pk] ?? [], { maxRelays: 5 });
    expect(plan.size).toBeLessThanOrEqual(5);

    const covered = new Set<string>();
    for (const set of Array.from(plan.values())) for (const a of Array.from(set)) covered.add(a);
    expect(covered.size).toBe(30); // dropped-relay authors fell back to user relays
  });

  it("caps how many relays a single author is fanned to", () => {
    const writes = { alice: ["wss://r1", "wss://r2", "wss://r3", "wss://r4"] };
    const plan = partitionAuthorsByRelay(["alice"], [], (pk) => (writes as any)[pk] ?? [], {
      maxRelaysPerAuthor: 2,
      maxRelays: 99,
    });
    let count = 0;
    for (const set of Array.from(plan.values())) if (set.has("alice")) count++;
    expect(count).toBe(2);
  });
});

describe("relaysForAuthors", () => {
  it("returns user relays plus the most-popular outbox relays", () => {
    const writes: Record<string, string[]> = {
      a: ["wss://pop", "wss://rare"],
      b: ["wss://pop"],
      c: ["wss://pop"],
    };
    const relays = relaysForAuthors(["a", "b", "c"], USER, (pk) => writes[pk] ?? [], 1);
    expect(relays).toEqual([...USER, "wss://pop"]); // top-1 extra is the popular one
  });
});
