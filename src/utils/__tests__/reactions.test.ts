import { Event } from "nostr-tools";
import {
  DEFAULT_QUICK_REACTIONS,
  QUICK_REACTION_LIMIT,
  buildReactionTemplate,
  displayReaction,
  loadQuickReactions,
  mergeQuickReactions,
  rememberQuickReaction,
  removeQuickReaction,
  resetQuickReactions,
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

describe("quick reactions row", () => {
  const pk = "d".repeat(64);

  beforeEach(() => localStorage.clear());

  it("starts from the defaults", () => {
    expect(loadQuickReactions(pk)).toEqual([...DEFAULT_QUICK_REACTIONS]);
  });

  it("dedupes, normalizes and caps a row", () => {
    expect(
      mergeQuickReactions(["❤️", "+", "😂", "", 42, "❤️", "🚀"])
    ).toEqual(["❤️", "😂", "🚀"]);
    expect(mergeQuickReactions([...DEFAULT_QUICK_REACTIONS, "😢"])).toHaveLength(
      QUICK_REACTION_LIMIT
    );
  });

  it("promotes a newly picked emoji to the front and persists it", () => {
    const next = rememberQuickReaction(pk, "😢");
    expect(next[0]).toBe("😢");
    expect(loadQuickReactions(pk)[0]).toBe("😢");
  });

  it("moves an existing emoji to the front instead of duplicating it", () => {
    const next = rememberQuickReaction(pk, "🎉");
    expect(next[0]).toBe("🎉");
    expect(next.filter((e) => e === "🎉")).toHaveLength(1);
  });

  it("removes an emoji from the row only", () => {
    rememberQuickReaction(pk, "😢");
    const next = removeQuickReaction(pk, "😢");
    expect(next).not.toContain("😢");
    expect(loadQuickReactions(pk)).not.toContain("😢");
  });

  it("keeps rows isolated per account", () => {
    rememberQuickReaction(pk, "😢");
    expect(loadQuickReactions("e".repeat(64))).toEqual([
      ...DEFAULT_QUICK_REACTIONS,
    ]);
  });

  it("resets to the defaults", () => {
    rememberQuickReaction(pk, "😢");
    expect(resetQuickReactions(pk)).toEqual([...DEFAULT_QUICK_REACTIONS]);
    expect(loadQuickReactions(pk)).toEqual([...DEFAULT_QUICK_REACTIONS]);
  });

  it("falls back to defaults when the stored value is corrupt", () => {
    localStorage.setItem(`pollerama:quickReactions:${pk}`, "{not json");
    expect(loadQuickReactions(pk)).toEqual([...DEFAULT_QUICK_REACTIONS]);
  });
});
