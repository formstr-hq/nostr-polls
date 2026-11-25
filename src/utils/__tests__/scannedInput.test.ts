import { nip19 } from "nostr-tools";
import { resolveScannedInput } from "../scannedInput";

const PUBKEY = "a".repeat(64);
const EVENT_ID = "b".repeat(64);

describe("resolveScannedInput", () => {
  it("opens a Pollerama profile URL as an App Link", async () => {
    const npub = nip19.npubEncode(PUBKEY);
    await expect(
      resolveScannedInput(`https://pollerama.fun/profile/${npub}`)
    ).resolves.toBe(`/profile/${npub}`);
  });

  it("accepts a nostr: profile URI", async () => {
    const npub = nip19.npubEncode(PUBKEY);
    await expect(resolveScannedInput(`nostr:${npub}`)).resolves.toBe(
      `/profile/${npub}`
    );
  });

  it("turns a note id into a nevent route", async () => {
    const note = nip19.noteEncode(EVENT_ID);
    const nevent = nip19.neventEncode({ id: EVENT_ID });
    await expect(resolveScannedInput(note)).resolves.toBe(`/note/${nevent}`);
  });

  it("routes naddr articles to the article feed", async () => {
    const naddr = nip19.naddrEncode({
      kind: 30023,
      pubkey: PUBKEY,
      identifier: "hello",
    });
    await expect(resolveScannedInput(naddr)).resolves.toBe(
      `/feeds/articles/${naddr}`
    );
  });

  it("extracts a profile id from another client's URL", async () => {
    const npub = nip19.npubEncode(PUBKEY);
    await expect(
      resolveScannedInput(`https://njump.me/${npub}`)
    ).resolves.toBe(`/profile/${npub}`);
  });

  it("ignores payment QRs and unrelated text", async () => {
    await expect(resolveScannedInput("lightning:name@wallet.example")).resolves.toBeNull();
    await expect(resolveScannedInput("hello world")).resolves.toBeNull();
    await expect(resolveScannedInput("")).resolves.toBeNull();
  });
});
