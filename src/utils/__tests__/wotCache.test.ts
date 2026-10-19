import { isWotCacheFresh, WotCacheRecord } from "../wotCache";

const TTL = 5 * 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

function record(overrides: Partial<WotCacheRecord> = {}): WotCacheRecord {
  return {
    pubkey: "a".repeat(64),
    union: ["b".repeat(64), "c".repeat(64)],
    serializedIndex: "{}",
    recommendations: [],
    time: NOW - 1000,
    ...overrides,
  };
}

describe("isWotCacheFresh", () => {
  it("accepts a fresh, complete record", () => {
    expect(isWotCacheFresh(record({ complete: true }), TTL, NOW)).toBe(true);
  });

  it("treats a legacy record with no `complete` field as complete", () => {
    expect(isWotCacheFresh(record(), TTL, NOW)).toBe(true);
  });

  it("rejects a record marked incomplete even when it is fresh", () => {
    // The reported bug: a partial 1-degree pass was written to the cache and
    // trusted for the full TTL, leaving the network stuck at contact-list size.
    expect(isWotCacheFresh(record({ complete: false }), TTL, NOW)).toBe(false);
  });

  it("rejects expired records", () => {
    expect(
      isWotCacheFresh(record({ time: NOW - TTL - 1 }), TTL, NOW)
    ).toBe(false);
  });

  it("rejects empty unions", () => {
    expect(isWotCacheFresh(record({ union: [] }), TTL, NOW)).toBe(false);
  });

  it("rejects a record whose timestamp was cleared", () => {
    expect(isWotCacheFresh(record({ time: 0 }), TTL, NOW)).toBe(false);
  });

  it("rejects anything when forced, even a valid record", () => {
    expect(isWotCacheFresh(record({ complete: true }), TTL, NOW, true)).toBe(
      false
    );
  });

  it("rejects missing records", () => {
    expect(isWotCacheFresh(null, TTL, NOW)).toBe(false);
    expect(isWotCacheFresh(undefined, TTL, NOW)).toBe(false);
  });
});
