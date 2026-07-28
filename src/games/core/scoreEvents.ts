import { EventTemplate } from "nostr-tools";
import { dataLayer, type Event } from "@formstr/local-relay";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { signerManager } from "../../singletons/Signer/SignerManager";
import { collectOnce } from "../../dataLayer/collect";
import { GameInput } from "./types";
import { decodeInputLog, encodeInputLog, isCompactInputLog } from "./inputLogCodec";

/**
 * Addressable (parameterized-replaceable, 30000-39999) game-score kind,
 * shared by every game — disambiguated by the `d` tag, same convention as
 * kind 30300 (topic/movie metadata). See docs/nip-game-scores.md.
 */
export const KIND_GAME_SCORE = 33404;

export const GAME_VERSION = "1.0.0";

/** UTC calendar date, e.g. "2026-07-17" — the daily-challenge boundary. */
export function todayUtcIso(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function getDailySeed(gameId: string, dateIso: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${gameId}|${dateIso}`)));
}

export function getTrackSeed(gameId: string, trackId: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${gameId}|${trackId}`)));
}

export function scoreDTag(gameId: string, dateIso: string): string {
  return `${gameId}:${dateIso}`;
}

export function trackScoreDTag(gameId: string, trackId: string): string {
  return `${gameId}:${trackId}`;
}

export interface StoredScore {
  event: Event;
  pubkey: string;
  score: number;
  seed: string;
  gameVersion: string;
  inputLog: GameInput[];
}

export function parseScoreEvent(event: Event): StoredScore | null {
  const scoreTag = event.tags.find((t) => t[0] === "score")?.[1];
  const seed = event.tags.find((t) => t[0] === "seed")?.[1];
  const gameVersion = event.tags.find((t) => t[0] === "game_version")?.[1];
  if (!scoreTag || !seed || !gameVersion) return null;
  try {
    const payload: unknown = JSON.parse(event.content);
    if (!isCompactInputLog(payload)) return null;
    return {
      event,
      pubkey: event.pubkey,
      score: Number(scoreTag),
      seed,
      gameVersion,
      inputLog: decodeInputLog(payload),
    };
  } catch {
    return null;
  }
}

/**
 * Publishes a new best for (gameId, dateIso). `dataLayer.publishEvent` writes
 * to local storage immediately regardless of connectivity — broadcast to
 * relays happens async with automatic retry, so this resolves once the
 * broadcast attempt settles but the score is durable locally the moment this
 * function is called (don't gate "saved" UI on the await).
 */
export async function publishDailyScore(
  gameId: string,
  dateIso: string,
  seed: string,
  score: number,
  inputLog: GameInput[]
): Promise<Event> {
  const template: EventTemplate = {
    kind: KIND_GAME_SCORE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", scoreDTag(gameId, dateIso)],
      ["seed", seed],
      ["score", String(score)],
      ["game_version", GAME_VERSION],
    ],
    content: JSON.stringify(encodeInputLog(inputLog)),
  };
  const signer = await signerManager.getSigner();
  const signed = await signer.signEvent(template);
  await dataLayer.publishEvent(signed);
  return signed;
}

/**
 * Publishes a new best for a fixed per-track leaderboard. Same semantics as
 * publishDailyScore — writes to local storage immediately, relay broadcast
 * is async/best-effort.
 */
export async function publishTrackScore(
  gameId: string,
  trackId: string,
  seed: string,
  score: number,
  inputLog: GameInput[]
): Promise<Event> {
  const template: EventTemplate = {
    kind: KIND_GAME_SCORE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", trackScoreDTag(gameId, trackId)],
      ["seed", seed],
      ["score", String(score)],
      ["game_version", GAME_VERSION],
    ],
    content: JSON.stringify(encodeInputLog(inputLog)),
  };
  const signer = await signerManager.getSigner();
  const signed = await signer.signEvent(template);
  await dataLayer.publishEvent(signed);
  return signed;
}

/**
 * Cache-only read of the caller's own score for a fixed per-track leaderboard.
 * Mirrors getMyTodayScore but uses the track d-tag/seed scheme.
 */
export async function getMyTrackScore(
  gameId: string,
  trackId: string,
  pubkey: string
): Promise<StoredScore | null> {
  const filters = [{ kinds: [KIND_GAME_SCORE], authors: [pubkey], "#d": [trackScoreDTag(gameId, trackId)], limit: 1 }];

  const local = await collectOnce(filters, { localOnly: true });
  if (local.length > 0) return parseScoreEvent(local[0]);

  const networked = await collectOnce(filters, { localOnly: false });
  if (networked.length === 0) return null;
  return parseScoreEvent(networked[0]);
}

/**
 * Cache-only, instant, offline-safe read of the caller's own score for
 * (gameId, dateIso). Deliberately filters on the `#d` tag rather than using
 * `dataLayer.fetchReplaceable` — that helper resolves by (kind, pubkey) alone
 * with no `d` scoping, which would return whichever game/day happens to be
 * this pubkey's most recent kind-33404 event, not necessarily today's.
 *
 * Checks the local cache first (instant, works offline) and only falls back
 * to a network-inclusive query if that comes up empty — e.g. a score
 * published from a different browser/device, or a cleared local cache,
 * wouldn't be in this device's local store yet even though it's real and on
 * relays. A pure localOnly read would silently show "no best" for a score
 * that genuinely exists.
 */
export async function getMyTodayScore(
  gameId: string,
  dateIso: string,
  pubkey: string
): Promise<StoredScore | null> {
  const filters = [{ kinds: [KIND_GAME_SCORE], authors: [pubkey], "#d": [scoreDTag(gameId, dateIso)], limit: 1 }];

  const local = await collectOnce(filters, { localOnly: true });
  if (local.length > 0) return parseScoreEvent(local[0]);

  const networked = await collectOnce(filters, { localOnly: false });
  if (networked.length === 0) return null;
  return parseScoreEvent(networked[0]);
}
