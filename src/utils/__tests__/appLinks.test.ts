import { nip19 } from "nostr-tools";
import { resolveAppLink } from "../appLinks";

const HEX = "a".repeat(64);
const ACCT = "b".repeat(64);

describe("resolveAppLink", () => {
  it("routes verified https App Links straight to the SPA route", () => {
    expect(resolveAppLink(`https://pollerama.fun/note/${HEX}`)).toEqual({
      route: `/note/${HEX}`,
      account: undefined,
      https: true,
    });
  });

  it("accepts the www host and keeps query/hash", () => {
    expect(
      resolveAppLink("https://www.pollerama.fun/create?type=poll#top")
    ).toEqual({
      route: "/create?type=poll#top",
      account: undefined,
      https: true,
    });
  });

  it("consumes the acct hint so it never lands in the route", () => {
    expect(
      resolveAppLink(`https://pollerama.fun/notifications?acct=${ACCT}`)
    ).toEqual({
      route: "/notifications",
      account: ACCT,
      https: true,
    });
  });

  it("opens NIP-21 nostr: profile links", () => {
    const npub = nip19.npubEncode(HEX);
    expect(resolveAppLink(`nostr:${npub}`)).toEqual({
      route: `/profile/${npub}`,
      account: undefined,
      https: false,
    });
    expect(resolveAppLink(`nostr://${npub}`)).toEqual({
      route: `/profile/${npub}`,
      account: undefined,
      https: false,
    });
  });

  it("opens NIP-21 note and article links", () => {
    const note = nip19.noteEncode(HEX);
    const nevent = nip19.neventEncode({ id: HEX });
    expect(resolveAppLink(`nostr:${note}`)?.route).toBe(`/note/${nevent}`);

    const naddr = nip19.naddrEncode({
      kind: 30023,
      pubkey: HEX,
      identifier: "post",
    });
    expect(resolveAppLink(`nostr:${naddr}`)?.route).toBe(
      `/feeds/articles/${naddr}`
    );
  });

  it("ignores private keys in nostr: links", () => {
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(1));
    expect(resolveAppLink(`nostr:${nsec}`)).toBeNull();
  });

  it("maps the bare origin to the app root", () => {
    expect(resolveAppLink("https://pollerama.fun")?.route).toBe("/");
    expect(resolveAppLink("https://pollerama.fun/")?.route).toBe("/");
  });

  it("ignores other hosts and schemes", () => {
    expect(resolveAppLink("https://example.com/note/abc")).toBeNull();
    expect(resolveAppLink("https://pollerama.fun.evil.test/note/abc")).toBeNull();
    expect(resolveAppLink("mailto:someone@example.com")).toBeNull();
    expect(resolveAppLink("not a url")).toBeNull();
  });

  it("maps notification note-hex links to a nevent route", () => {
    const nevent = nip19.neventEncode({ id: HEX });
    expect(resolveAppLink(`nostr-polls://app/note-hex/${HEX}`)).toEqual({
      route: `/note/${nevent}`,
      account: undefined,
      https: false,
    });
  });

  it("maps notification respond-hex links to a nevent route", () => {
    const nevent = nip19.neventEncode({ id: HEX });
    expect(
      resolveAppLink(`nostr-polls://app/respond-hex/${HEX}?acct=${ACCT}`)
    ).toEqual({
      route: `/respond/${nevent}`,
      account: ACCT,
      https: false,
    });
  });

  it("routes notification messages and notifications links", () => {
    expect(
      resolveAppLink(`nostr-polls://app/messages/npub1abc?acct=${ACCT}`)
    ).toEqual({
      route: "/messages/npub1abc",
      account: ACCT,
      https: false,
    });
    expect(resolveAppLink("nostr-polls://app/messages")).toEqual({
      route: "/messages",
      account: undefined,
      https: false,
    });
    expect(resolveAppLink("nostr-polls://app/notifications")).toEqual({
      route: "/notifications",
      account: undefined,
      https: false,
    });
  });

  it("falls back to notifications for an unencodable hex id", () => {
    expect(resolveAppLink("nostr-polls://app/note-hex/not-hex")?.route).toBe(
      "/notifications"
    );
  });
});
