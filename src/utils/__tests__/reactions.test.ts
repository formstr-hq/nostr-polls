import { Event } from "nostr-tools";
import {
  QUICK_REACTIONS,
  buildReactionTemplate,
  displayReaction,
} from "../reactions";

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    kind: 1,
    created_at: 1_700_000_000,
    content: "hello",
    tags: [],
    sig: "c".repeat(128),
    ...overrides,
  };
}

describe("buildReactionTemplate (NIP-25 / Amethyst interop)", () => {
  it("emits a kind-7 event with e, p and k tags", () => {
    const target = event();
    const reaction = buildReactionTemplate(target, "❤️", "wss://relay.example", 123);

    expect(reaction.kind).toBe(7);
    expect(reaction.content).toBe("❤️");
    expect(reaction.created_at).toBe(123);
    expect(reaction.tags).toEqual([
      ["e", target.id, "wss://relay.example"],
      ["p", target.pubkey],
      ["k", "1"],
    ]);
  });

  it("uses an empty relay hint when none is available", () => {
    const reaction = buildReactionTemplate(event(), "👍");
    expect(reaction.tags[0]).toEqual(["e", "a".repeat(64), ""]);
  });

  it("adds an a tag for addressable targets", () => {
    const article = event({
      kind: 30023,
      tags: [["d", "my-article"]],
    });
    const reaction = buildReactionTemplate(article, "🚀");

    expect(reaction.tags).toContainEqual([
      "a",
      `30023:${article.pubkey}:my-article`,
    ]);
    expect(reaction.tags).toContainEqual(["k", "30023"]);
  });

  it("does not add an a tag to plain notes", () => {
    const reaction = buildReactionTemplate(event({ kind: 1 }), "🎉");
    expect(reaction.tags.some((t) => t[0] === "a")).toBe(false);
  });

  it("keeps quick reactions as non-empty Unicode emoji", () => {
    expect(QUICK_REACTIONS.length).toBeGreaterThan(0);
    for (const emoji of QUICK_REACTIONS) {
      expect(emoji.length).toBeGreaterThan(0);
      expect(emoji).not.toMatch(/^:[a-z0-9_]+:$/i);
    }
  });
});

describe("displayReaction", () => {
  it("maps the NIP-25 like short form to a heart", () => {
    expect(displayReaction("+")).toBe("❤️");
  });

  it("maps the NIP-25 dislike short form to a thumbs down", () => {
    expect(displayReaction("-")).toBe("👎");
  });

  it("passes emoji and custom shortcodes through", () => {
    expect(displayReaction("😂")).toBe("😂");
    expect(displayReaction(":blobcat:")).toBe(":blobcat:");
  });
});
