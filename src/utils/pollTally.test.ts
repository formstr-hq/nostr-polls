/* eslint-disable import/first -- jest.mock must run before imports that use the mocked module */
jest.mock("nostr-tools", () => {
  const actual = jest.requireActual<typeof import("nostr-tools")>(
    "nostr-tools"
  );
  return {
    ...actual,
    nip13: {
      ...actual.nip13,
      getPow: jest.fn((id: string) => actual.nip13.getPow(id)),
    },
  };
});

import type { Event } from "nostr-tools";
import { nip13 } from "nostr-tools";
import {
  dedupeVoteEvents,
  leadingOptionIds,
  tallyPollResults,
} from "./pollTally";

const pollTags: string[][] = [
  ["option", "a", "Alpha"],
  ["option", "b", "Bravo"],
  ["option", "c", "Charlie"],
];

function voteEvent(params: {
  id: string;
  pubkey: string;
  created_at: number;
  selected: string[];
}): Event {
  const { id, pubkey, created_at, selected } = params;
  return {
    id,
    pubkey,
    kind: 1018,
    content: "",
    created_at,
    sig: "00",
    tags: [
      ["e", "aa".repeat(64)],
      ["p", "bb".repeat(64)],
      ...selected.map((s) => ["response", s] as string[]),
    ],
  };
}

const getPowMock = nip13.getPow as jest.MockedFunction<typeof nip13.getPow>;

beforeEach(() => {
  const actual = jest.requireActual<typeof import("nostr-tools")>(
    "nostr-tools"
  );
  getPowMock.mockImplementation((id) => actual.nip13.getPow(id));
});

describe("tallyPollResults", () => {
  it("counts votes per option and picks a single winner", () => {
    const votes = [
      voteEvent({
        id: "11".repeat(32),
        pubkey: "aa".repeat(32),
        created_at: 1,
        selected: ["a"],
      }),
      voteEvent({
        id: "22".repeat(32),
        pubkey: "bb".repeat(32),
        created_at: 2,
        selected: ["a"],
      }),
      voteEvent({
        id: "33".repeat(32),
        pubkey: "cc".repeat(32),
        created_at: 3,
        selected: ["b"],
      }),
    ];

    const unique = dedupeVoteEvents(votes, 0);
    const results = tallyPollResults(pollTags, unique);

    expect(results.get("a")?.count).toBe(2);
    expect(results.get("b")?.count).toBe(1);
    expect(results.get("c")?.count).toBe(0);
    expect(leadingOptionIds(results)).toEqual(["a"]);

    expect(results.get("a")?.percentage).toBeCloseTo(66.67, 1);
    expect(results.get("b")?.percentage).toBeCloseTo(33.33, 1);
  });

  it("handles multiple selections on one vote (multiple-choice style)", () => {
    const votes = [
      voteEvent({
        id: "44".repeat(32),
        pubkey: "dd".repeat(32),
        created_at: 1,
        selected: ["a", "c"],
      }),
    ];

    const unique = dedupeVoteEvents(votes, 0);
    const results = tallyPollResults(pollTags, unique);

    expect(results.get("a")?.count).toBe(1);
    expect(results.get("c")?.count).toBe(1);
    expect(results.get("b")?.count).toBe(0);
    expect(leadingOptionIds(results).sort()).toEqual(["a", "c"]);
  });

  it("uses the latest vote when a user re-votes for a different option", () => {
    const votes = [
      voteEvent({
        id: "77".repeat(32),
        pubkey: "ff".repeat(32),
        created_at: 1,
        selected: ["a"],
      }),
      voteEvent({
        id: "88".repeat(32),
        pubkey: "ff".repeat(32),
        created_at: 2,
        selected: ["b"],
      }),
    ];

    const unique = dedupeVoteEvents(votes, 0);
    expect(unique).toHaveLength(1);
    const results = tallyPollResults(pollTags, unique);
    expect(results.get("a")?.count).toBe(0);
    expect(results.get("b")?.count).toBe(1);
  });

  it("does not double-count the same option from the same pubkey", () => {
    const votes = [
      voteEvent({
        id: "55".repeat(32),
        pubkey: "ee".repeat(32),
        created_at: 1,
        selected: ["b"],
      }),
      voteEvent({
        id: "66".repeat(32),
        pubkey: "ee".repeat(32),
        created_at: 2,
        selected: ["b"],
      }),
    ];

    const unique = dedupeVoteEvents(votes, 0);
    expect(unique).toHaveLength(1);
    const results = tallyPollResults(pollTags, unique);
    expect(results.get("b")?.count).toBe(1);
    expect(results.get("b")?.responders).toEqual(["ee".repeat(32)]);
  });
});

describe("dedupeVoteEvents", () => {
  it("drops votes that do not meet PoW difficulty when set", () => {
    const low = voteEvent({
      id: "aa".repeat(32),
      pubkey: "11".repeat(32),
      created_at: 1,
      selected: ["a"],
    });
    const high = voteEvent({
      id: "bb".repeat(32),
      pubkey: "22".repeat(32),
      created_at: 1,
      selected: ["b"],
    });

    getPowMock.mockImplementation((id: string) =>
      id === "aa".repeat(32) ? 5 : 20
    );

    const unique = dedupeVoteEvents([low, high], 10);
    expect(unique).toHaveLength(1);
    expect(unique[0].pubkey).toBe("22".repeat(32));
  });
});
