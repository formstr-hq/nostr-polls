import { NOSTR_EVENT_KINDS } from "../constants/nostr";
import type { Option } from "../interfaces";
import { buildUnsignedPollEvent } from "./pollEvent";

describe("buildUnsignedPollEvent", () => {
  it("tags include all provided options, relays, topics, and mentions", () => {
    const options: Option[] = [
      ["opt-a", "Red"],
      ["opt-b", "Blue"],
    ];
    const evt = buildUnsignedPollEvent({
      content: "Pick a color",
      options,
      relays: ["wss://relay.example.com"],
      topics: ["colors"],
      mentionTags: [["p", "ab".repeat(32)]],
      quoteTags: [],
      createdAt: 1_700_000_000,
    });

    expect(evt.kind).toBe(NOSTR_EVENT_KINDS.POLL);
    expect(evt.content).toBe("Pick a color");
    expect(evt.created_at).toBe(1_700_000_000);

    expect(evt.tags.filter((t) => t[0] === "option")).toHaveLength(2);
    expect(evt.tags).toContainEqual(["option", "opt-a", "Red"]);
    expect(evt.tags).toContainEqual(["option", "opt-b", "Blue"]);
    expect(evt.tags).toContainEqual(["relay", "wss://relay.example.com"]);
    expect(evt.tags).toContainEqual(["t", "colors"]);
    expect(evt.tags).toContainEqual(["p", "ab".repeat(32)]);
  });

  it("appends PoW, polltype, and endsAt when provided", () => {
    const evt = buildUnsignedPollEvent({
      content: "Q",
      options: [["1", "A"]],
      relays: [],
      topics: [],
      mentionTags: [],
      quoteTags: [],
      poW: 16,
      pollType: "singlechoice",
      expiration: 1_700_000_100,
      createdAt: 10,
    });

    expect(evt.tags).toContainEqual(["PoW", "16"]);
    expect(evt.tags).toContainEqual(["polltype", "singlechoice"]);
    expect(evt.tags).toContainEqual(["endsAt", "1700000100"]);
  });

  it("omits optional tags when PoW / polltype / expiration are absent", () => {
    const evt = buildUnsignedPollEvent({
      content: "Plain",
      options: [["x", "Yes"]],
      relays: [],
      topics: [],
      mentionTags: [],
      quoteTags: [],
      poW: null,
      pollType: null,
      expiration: null,
    });

    expect(evt.tags.some((t) => t[0] === "PoW")).toBe(false);
    expect(evt.tags.some((t) => t[0] === "polltype")).toBe(false);
    expect(evt.tags.some((t) => t[0] === "endsAt")).toBe(false);
  });

  it("merges quote tags from the publishing form", () => {
    const quotedId = "cd".repeat(32);
    const evt = buildUnsignedPollEvent({
      content: "See quote",
      options: [["o", "OK"]],
      relays: ["wss://r1"],
      topics: [],
      mentionTags: [],
      quoteTags: [
        ["q", quotedId, "wss://r1"],
        ["p", "ef".repeat(32)],
      ],
      createdAt: 42,
    });

    expect(evt.tags).toContainEqual(["q", quotedId, "wss://r1"]);
    expect(evt.tags).toContainEqual(["p", "ef".repeat(32)]);
  });
});
