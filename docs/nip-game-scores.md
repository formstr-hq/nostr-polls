<!--
Original spec, not adapted from an upstream nostr-protocol/nips PR.
Status: DRAFT — written for Pollerama's daily game leaderboards (2048, Tetris)
and intended to be reviewable/publishable as-is. Kind number 33404 is a
placeholder pending a free-range check against the live nips repo before
submission.
-->

# NIP-GS

## Self-Verifiable Game Scores

`draft` `optional`

This NIP defines a mechanism for publishing game scores that any client can independently verify by replaying the recorded input log against a publicly-derivable seed — no trusted server or third-party attestation required.

## Motivation

Competitive leaderboards normally require a server to run the game authoritatively and accept scores as truth. Nostr has no such server. This NIP replaces server-side trust with **determinism**: if a game's rules are a pure function of `(seed, inputs)`, then a player's claimed score can be checked by anyone who re-runs the same simulation and compares the result — the event itself carries its own proof.

This does not prevent a bot from generating a valid-but-inhuman input log (see Tradeoffs). It only guarantees that a displayed score is *consistent with* the published inputs and seed, which is what "self-verifiable" means in this NIP's scope.

## Definitions

- **Deterministic game**: game logic that, given the same seed and the same ordered sequence of timed inputs, always produces the same final score and end state on any device.
- **Daily seed**: a seed derived from a public, calendar-day boundary (UTC) so every player attempting a given game on a given day plays the identical board/piece sequence.
- **Input log**: the ordered sequence of `{t, a}` pairs (`t` = milliseconds since session start, `a` = action string) a player produced during a session. This *is* the replay.
- **Replay verification**: independently re-simulating a game from its seed and input log and checking the resulting score matches the claimed score.

## Event Kinds

| Kind    | Description                                    |
| ------- | ----------------------------------------------- |
| `33404` | Game score (addressable, one per player/game/day) |

## Kind 33404: Game Score

An addressable (parameterized-replaceable) event. The coordinate is `(kind, pubkey, d)`; publishing a new event for the same `d` replaces the prior one, which is what gives "best score for today" for free from relay/store semantics rather than app logic.

```json
{
  "kind": 33404,
  "pubkey": "<player-pubkey>",
  "created_at": <timestamp>,
  "tags": [
    ["d", "<gameId>:<dateIso>"],
    ["seed", "<hex-seed>"],
    ["score", "<integer>"],
    ["game_version", "<semver>"]
  ],
  "content": "{\"codes\":[\"left\",\"down\"],\"log\":[[0,0],[420,1]]}",
  "id": "<event-id>",
  "sig": "<signature>"
}
```

- `d`: `"<gameId>:<dateIso>"`, e.g. `"2048:2026-07-17"`. `gameId` is a short lowercase slug chosen by the game (`2048`, `tetris`, ...); `dateIso` is the UTC calendar date (`YYYY-MM-DD`) the score was attempted for.
- `seed`: the daily seed this run was played against (see below). Verifiers reject events whose `seed` does not match the seed independently derived for `(gameId, dateIso)` — this stops a player from picking a favorable seed.
- `score`: the claimed final score, as a plain base-10 integer string, duplicated into a tag (rather than left only in `content`) so it's visible without parsing/decoding — matches this codebase's convention of keeping small filterable fields as tags.
- `game_version`: semver of the game's rule engine that produced this run. Verifiers should only attempt replay against a matching or known-compatible engine version — engine changes are not required to keep old replays valid.
- `content`: JSON object `{"codes": string[], "log": [number, number][]}` — the input log, compactly encoded. `codes` is the small set of distinct action strings this session used (a game has only a handful — `"left"`, `"rotate_cw"`, etc — repeated hundreds of times), in first-seen order. `log` is `[t, codeIndex]` tuples: `t` is milliseconds since session start, `codeIndex` indexes into `codes`. Decoding: `inputLog = log.map(([t, i]) => ({t, a: codes[i]}))`. This dictionary encoding — no repeated key names, no repeated action strings, no quoting on the index — roughly halves event size versus a naive `[{"t":.., "a":..}, ...]` array for a typical session. Larger/variable-length data belongs in `content`, not tags, per this codebase's existing convention (e.g. kind 34139 playlists).

## Determinism & Replay Verification

### Seed derivation

```
seed = hex(sha256(utf8(gameId + "|" + dateIso)))
```

`dateIso` MUST be the UTC calendar date to keep the daily boundary unambiguous across timezones. Any client can compute today's (or any past day's) seed for any `gameId` without querying anything — the seed is a pure function of public inputs.

### Replay algorithm

Game engines implement:

```
init(seed)
applyInput(action, t)
tick(dtMs)          // advances real-time state (gravity, timers); no-op for turn-based games
getScore()
isGameOver()
```

To verify a published event:

1. Recompute `expectedSeed = seedFor(gameId, dateIso)` and reject if it doesn't equal the event's `seed` tag.
2. Construct a fresh engine instance and call `init(seed)`.
3. Sort `inputLog` by `t`. Maintain a logical clock starting at 0. For each input, advance the clock in fixed `FIXED_STEP_MS` increments (calling `tick(FIXED_STEP_MS)` each step) until the clock reaches the input's `t`, then call `applyInput(a, t)`.
4. After the last input, compare `getScore()` to the event's `score` tag. Equal ⇒ verified.

`FIXED_STEP_MS` is a constant fixed by the game engine's implementation (Pollerama uses 16ms). Live play MUST accumulate real elapsed time into the same fixed step size — not call `tick()` with raw frame deltas — so that live play and replay produce identical results regardless of a device's actual frame rate. This is the crux of the whole scheme: without a shared fixed step, two runs of "the same" input log could diverge on gravity/timer-driven games.

## Flows

### Playing and publishing a score

1. Compute today's seed: `getDailySeed(gameId, todayUtcIso())`.
2. Play the game locally; record every input as `{t, a}` in an input log.
3. On game end (or any time the player wants to bank a new personal best), if the run's score beats the player's stored best for today, sign and publish a kind `33404` event with that day's `d` tag, the seed, the score, and the full input log.
4. Publishing writes to local storage immediately, independent of connectivity; broadcast to relays is best-effort and may happen later. A player can play, and bank a local best, entirely offline.

### Building a leaderboard

1. Subscribe to `{"kinds":[33404], "#d":["<gameId>:<dateIso>"]}`.
2. For each event received, run replay verification (above).
3. Discard events that fail verification (wrong seed, or replay score mismatch). Display only verified entries, sorted by score descending.
4. Because the kind is addressable, at most one event per pubkey persists per `(gameId, dateIso)` — no separate app-level dedup is needed.

### Reading back your own score offline

A client can resolve its own best score for `(gameId, dateIso)` from local cache alone — filter locally stored events by `{kinds:[33404], authors:[self], "#d":["<gameId>:<dateIso>"]}` — with no network round-trip.

## Client Behavior

- Clients SHOULD verify every leaderboard entry themselves before displaying it as legitimate; this NIP defines no attestation authority, so trusting an unverified `score` tag defeats the purpose.
- Clients MAY use a game-specific verifier when the published metric is not the engine's replay score (e.g. Sudoku ranks by a consecutive-day solve streak). The verifier still checks that the input log solves the day's puzzle, then validates whatever additional cross-day evidence the metric requires (for Sudoku, the previous days' events with counting-down streak values).
- Clients SHOULD reject events where `game_version` refers to an engine revision they don't recognize, rather than guessing compatibility.
- Clients MAY cache verification results locally (keyed by event id) to avoid re-replaying unchanged leaderboard entries on every load.
- Clients choosing their own `gameId` slugs SHOULD pick short, stable, lowercase identifiers, since it's part of the addressable coordinate and changing it orphans prior scores.
- Clients MAY offer a visual replay (stepping the engine through the decoded input log on a timer, for a human to watch) in addition to the silent verification pass. This is a UX nicety, not part of the protocol — the same decoded input log drives both.

## Tradeoffs

### Determinism proves consistency, not honesty

Replay verification confirms a score is *reachable* from the published inputs and seed — it cannot confirm a human produced those inputs "fairly" in real time. A script that computes an optimal input log offline in milliseconds produces a replay that verifies identically to a human's. This NIP intentionally does not solve that; see the Deferred section of `docs/games-feature.md` for anti-bot mechanisms considered (verifiable delay functions, relay-anchored live checkpoints) and why they were not adopted for v1 (mobile performance cost, and/or an offline-play requirement they'd break).

### Predictable seed

Because the seed is a deterministic function of `(gameId, dateIso)`, anyone can compute tomorrow's seed today and pre-compute a run before the "day" officially starts for other players. For a casual leaderboard this is an accepted tradeoff. A future revision could derive the seed from a public randomness beacon (e.g. drand) unpredictable until the round is reached, without changing the event schema — only `getDailySeed`'s definition.

### Input log size

Publishing the full input log makes events larger than a bare score would be, and leaks precise timing/play-pattern data publicly. This is required for the scheme to work (there is nothing to replay otherwise) and is considered acceptable for a game leaderboard, unlike e.g. a private note.

In practice, a typical session is small (a few KB) regardless of encoding — this only matters for long sessions. Turn-based games (2048) are naturally bounded (the board fills up: ~1000 moves is around 10KB compact-encoded), but a game with no forced end condition (Tetris — a skilled player can clear lines indefinitely) can in principle produce an arbitrarily large event; measured against the actual encoder, a 30-minute Tetris marathon at a casual input pace (~1 input/400ms) is ~50KB compact-encoded. NIP-01 sets no size limit — individual relays do, advertised via NIP-11 `limitation.max_message_length`, varying widely in practice. Clients targeting stricter relays may want to cap session length; this NIP doesn't mandate it.
