import { Event } from "nostr-tools";
import {
  buildMoneroUri,
  buildPaytoTags,
  getPaytoTarget,
  getPaytoTargets,
  isValidMoneroAddress,
  isValidMoneroAddressStrict,
  type PaytoTarget,
} from "../payto";

const PUBKEY = "afc93622eb4d79c0fb75e56e0c14553f7214b0a466abeba14cb38968c6755e6a";

function makePaytoEvent(tags: string[][]): Event {
  return {
    id: "x".repeat(64),
    sig: "y".repeat(64),
    pubkey: PUBKEY,
    created_at: 1234567890,
    kind: 10133,
    content: "",
    tags,
  } as unknown as Event;
}

const MONERO_ADDR =
  "4Ai8Dc4B7ibbaKofKnfScQGB9mY7Pp3Jc5TAdph3hqrwL2JHYyXPuWnj6uUvzCgVgyzqbWNNvb2Rv1XUCLzZyv3sSMw4Xj";
const BTC_ADDR = "bc1qxq66e0t8d7ugdecwnmv58e90tpry23nc84pg9k";

describe("payto (NIP-A3) utils", () => {
  it("extracts payto targets from a kind 10133 event", () => {
    const event = makePaytoEvent([
      ["payto", "monero", MONERO_ADDR],
      ["payto", "bitcoin", BTC_ADDR],
      ["p", "someone"],
    ]);
    const targets = getPaytoTargets(event);
    expect(targets).toEqual([
      { type: "monero", address: MONERO_ADDR },
      { type: "bitcoin", address: BTC_ADDR },
    ]);
  });

  it("normalizes type casing and finds a specific target", () => {
    const event = makePaytoEvent([["payto", "Monero", MONERO_ADDR]]);
    expect(getPaytoTarget(event, "MONERO")).toEqual({
      type: "monero",
      address: MONERO_ADDR,
    });
  });

  it("returns null when the target type is absent", () => {
    const event = makePaytoEvent([["payto", "bitcoin", BTC_ADDR]]);
    expect(getPaytoTarget(event, "monero")).toBeNull();
    expect(getPaytoTargets(makePaytoEvent([]))).toEqual([]);
  });

  it("ignores malformed payto tags", () => {
    const event = makePaytoEvent([
      ["payto"],
      ["payto", "monero"],
      ["payto", "monero", ""],
    ]);
    expect(getPaytoTargets(event)).toEqual([]);
  });

  it("builds payto tags with lowercase types", () => {
    const targets: PaytoTarget[] = [
      { type: "Monero", address: MONERO_ADDR },
      { type: "bitcoin", address: BTC_ADDR },
    ];
    expect(buildPaytoTags(targets)).toEqual([
      ["payto", "monero", MONERO_ADDR],
      ["payto", "bitcoin", BTC_ADDR],
    ]);
  });

  it("drops empty targets when building tags", () => {
    expect(
      buildPaytoTags([
        { type: "", address: "x" },
        { type: "monero", address: "" },
      ])
    ).toEqual([]);
  });

  it("validates monero primary addresses", () => {
    expect(isValidMoneroAddress(MONERO_ADDR)).toBe(true);
    expect(isValidMoneroAddressStrict(MONERO_ADDR)).toBe(true);
    expect(isValidMoneroAddress("short")).toBe(false);
    expect(isValidMoneroAddressStrict("8" + "z".repeat(99))).toBe(true); // stagenet-style prefix
    expect(isValidMoneroAddressStrict("0" + "z".repeat(99))).toBe(false);
  });

  it("builds monero URIs with and without amounts", () => {
    expect(buildMoneroUri(MONERO_ADDR)).toBe(`monero:${MONERO_ADDR}`);
    expect(buildMoneroUri(MONERO_ADDR, 0.1)).toBe(
      `monero:${MONERO_ADDR}?tx_amount=0.1`
    );
    expect(buildMoneroUri(MONERO_ADDR, 0)).toBe(`monero:${MONERO_ADDR}`);
  });
});