# Games feature — plan & status

A "fun" section: daily-seeded 2048, Tetris, Overdrive, and Sudoku with a
leaderboard that's provable without a server — scores are verified by replaying
each run's recorded inputs against the day's seed, client-side, by anyone.
Protocol spec: `docs/nip-game-scores.md` (kind 33404). Anti-bot hardening
deliberately deferred (see below).

## Nostr kinds
- **Game score = kind 33404** (addressable) — one event per `(pubkey, gameId, dateIso)`
  via `d`-tag `"<gameId>:<dateIso>"`, same "one kind, `d`-tag disambiguates"
  convention as kind 30300. Carries `seed`/`score`/`game_version` tags + the
  input log (the replay) as JSON in `content`. Full schema: `docs/nip-game-scores.md`.

## Locked design decisions
- **Determinism + replay verification is the whole anti-cheat mechanism** — no
  server, no VDF, no relay-anchored live checkpoints in v1. Explored and
  explicitly cut: VDFs tax weak mobile hardware hardest while barely
  constraining the strong hardware most likely to run a bot; relay-anchored
  checkpoints require live connectivity, which conflicts with the offline-play
  requirement. See Deferred.
- **Daily shared seed, UTC-day boundary** (`seed = sha256(gameId|dateIso)`) —
  Wordle-style: everyone plays the identical board/piece sequence for the day.
  This is also the "not an exact clone" differentiator — kept vanilla rules
  otherwise to stay in "quick build" scope.
- **Offline-first by construction** — game engines make zero network calls;
  only the post-game score publish touches `dataLayer`, and
  `dataLayer.publishEvent` already writes to local storage synchronously
  regardless of connectivity (broadcast to relays is async/best-effort with
  automatic retry) — no bespoke offline queue needed.
- **Fixed-timestep engines** (`FIXED_STEP_MS = 16`) — live play accumulates
  real `requestAnimationFrame` delta into fixed steps rather than calling
  `tick(rafDt)` directly, so replay (which always steps in exact 16ms
  increments) reproduces gravity/timers identically regardless of a device's
  actual frame rate.
- **UI**: MUI, matching the rest of the app. Routes nested under `/feeds/games`
  alongside `feeds/music`, `feeds/movies`, etc.; sidebar nav entry added.

---

## Phase 1 — shared core — DONE

Seed/PRNG/input-recording/replay/publish infrastructure every game plugs into,
so 2048 and Tetris (and any future game) don't each reimplement it.

**Files (new)**
- `src/games/core/types.ts` — `DeterministicGame` interface every engine
  implements (`init`, `applyInput`, `tick`, `getScore`, `isGameOver`,
  `getStateHash`); `FIXED_STEP_MS` constant.
- `src/games/core/prng.ts` — mulberry32 seeded PRNG, `rngFromHexSeed`, `randInt`.
- `src/games/core/inputRecorder.ts` — records `{t, a}` pairs during live play.
- `src/games/core/replayEngine.ts` — `verifyReplay(gameFactory, seed, inputLog)`,
  headless re-simulation used both for self-check-before-publish and for
  leaderboard verification.
- `src/games/core/scoreEvents.ts` — `KIND_GAME_SCORE = 33404`, `getDailySeed`,
  `publishDailyScore` (signs via `signerManager`, publishes via
  `dataLayer.publishEvent`), `getMyTodayScore` (cache-only read via
  `collectOnce(..., {localOnly:true})`, offline-safe/instant).
- `src/games/core/useDailyLeaderboard.ts` — subscribes to
  `{kinds:[33404], "#d":[...]}`, replay-verifies every entry against the
  expected daily seed, returns verified-only, score-sorted entries.

## Phase 2 — 2048 — DONE

**Files (new)**
- `src/games/twenty48/engine.ts` — `Twenty48Engine implements DeterministicGame`;
  seeded tile spawn, standard slide/merge rules.
- `src/games/twenty48/Board.tsx` — keyboard (arrow keys) + touch-swipe input,
  records via `InputRecorder`, publishes a new best on game over.

## Phase 3 — Tetris — DONE

**Files (new)**
- `src/games/tetris/engine.ts` — `TetrisEngine implements DeterministicGame`;
  seeded 7-bag piece randomizer, gravity via fixed-step `tick`, standard
  line-clear scoring. Rotation table is a simplified 4-state-per-piece scheme
  with **no wall-kick fallback** — not official SRS (deliberate scope cut;
  doesn't affect determinism/verifiability, only rotation feel near walls).
  Fixed `DROP_INTERVAL_MS` (no level-based speedup) for the same reason.
- `src/games/tetris/Board.tsx` — keyboard + on-screen buttons, fixed-timestep
  `requestAnimationFrame` gravity loop gated by an engine-side version counter
  so idle frames (most of them — gravity only moves the piece every ~800ms)
  skip the React re-render, keeping this cheap on low-end mobile.

## Phase 4 — compact encoding + visual replay — DONE

**Files (new)**
- `src/games/core/inputLogCodec.ts` — `encodeInputLog`/`decodeInputLog`: dedupes
  action strings into a small `codes` dictionary, log becomes `[t, codeIndex]`
  tuples. Roughly halves published event size. Wired into `scoreEvents.ts`
  publish/parse. Schema documented in `docs/nip-game-scores.md`.
- `src/games/core/useReplayPlayback.ts` — game-agnostic play/pause/speed/restart
  driver over a recorded input log, stepping the engine on a timer in the same
  `FIXED_STEP_MS` increments as live play/verification (the visual counterpart
  to `replayEngine.verifyReplay`, which does the same simulation headlessly).
- `src/games/twenty48/Grid.tsx`, `src/games/tetris/Grid.tsx` — board rendering
  extracted out of each `Board.tsx` so live play and replay share the same
  presentational component instead of duplicating tile markup.
- `src/games/twenty48/Replay.tsx`, `src/games/tetris/Replay.tsx` — replay view
  (grid + progress bar + play/pause/speed/restart), built on
  `useReplayPlayback` + the shared `Grid` components.

**Files (modified)**
- `src/games/core/useDailyLeaderboard.ts` — `LeaderboardEntry` now carries
  `seed`/`inputLog` (already computed during verification) so a leaderboard
  row can be handed straight to a `Replay` component with no extra fetch.
- `src/components/Games/GamesFeed.tsx` — leaderboard rows are clickable, open
  a replay in a dialog.
- `src/games/twenty48/Board.tsx`, `src/games/tetris/Board.tsx` — "Watch replay"
  toggle after game over, replaying the just-played run using the same
  `Replay` component the leaderboard uses.

## Phase 5 — leaderboard modal, avatars, animations — DONE

**Files (new)**
- `src/components/Games/GameLeaderboardModal.tsx` — Dialog on mobile, side
  Drawer on desktop (`useMediaQuery` breakpoint), same content either way;
  always mounted (visibility toggled) so `useDailyLeaderboard` stays warm.
  One component, used from both `GamesFeed` and from inside each game's own
  screen (trophy-icon trigger).
- `src/components/Games/LeaderboardPanel.tsx` — avatar + display name (reuses
  the `useAppContext().profiles` + `openProfileTab` convention from
  `ReviewCard.tsx`), clickable through to the player's profile, per-row ▶
  replay button.
- `src/games/tetris/useLineClearFlash.ts` — cosmetic-only signal (does not
  affect score/hash/replay) for a line-clear flash overlay.

**Files (modified)**
- `src/games/twenty48/engine.ts` — rewritten from a raw `board: number[][]`
  to tracking individual `Tile{id,value,row,col}` with stable identity across
  moves, so the UI can slide a tile from its old position to its new one
  instead of just re-rendering a changed number in a fixed cell. Verified
  bit-for-bit identical score/hash output vs. the old implementation for the
  same seed+inputs — old replays (including already-published real scores)
  still verify.
- `src/games/twenty48/Grid.tsx` — tiles positioned via `transform: translate()`
  with a CSS transition (real sliding, not a jump-cut); merges get a nested
  pop keyframe independent of the position transition.
- `src/games/tetris/Grid.tsx` — per-cell pop on any color change (piece
  moving/rotating/falling/locking) + line-clear flash overlay.
- `getMyTodayScore` (`scoreEvents.ts`) — was local-cache-only; now falls back
  to a network-inclusive query on a local miss (a score published from a
  different browser/device wasn't showing as "today's best" otherwise).
  "Today's best" is now clickable in both games, opening the leaderboard
  modal (where the player's own entry, once published, has its own replay
  button — no separate "replay my best" path needed).

## Phase 6 — Overdrive (racer) — DONE

Third game: an endless 3-lane-turned-analogue highway dodger, pseudo-3D. Same
mechanism as the others — fixed-tick deterministic simulation + seeded RNG +
recorded input log — applied to continuous motion instead of a grid.

- **Analogue steering, not fixed lanes** — the input log only ever carries
  discrete `left_down`/`left_up`/`right_down`/`right_up` transitions (a held
  key, or a touch drag past a deadzone), but the engine integrates a
  continuous `playerX` (-1..1) from those transitions every fixed tick — same
  small-log property as the other games, smooth continuous motion instead of
  lane-snapping.
- **Difficulty ramp is score itself** — speed is a pure function of distance
  traveled (not wall-clock, not RNG), so it's identical on replay; obstacle
  spawn cadence is fixed-per-distance, so effective frequency-per-second rises
  automatically as speed rises. No artificial time cap — the game self-limits
  once speed outpaces reaction time, unlike Tetris (which can continue
  indefinitely at constant difficulty).
- **Pseudo-3D via 2D perspective math**, not canvas or real CSS 3D — a
  trapezoid road (`clip-path`), with every position's screen Y/X/scale
  computed from an eased depth value. Consistent with the rest of the app
  (Box + sx), no new rendering paradigm introduced.

**Files (new)**
- `src/games/racer/engine.ts` — `RacerEngine implements DeterministicGame`.
- `src/games/racer/Track.tsx` — pseudo-3D road renderer, shared by live play
  and replay.
- `src/games/racer/Board.tsx` — held-arrow-key + touch-drag steering, fixed-
  tick rAF loop (same pattern as Tetris's gravity loop, but every frame
  re-renders since motion is continuous — no version-gating needed).
- `src/games/racer/Replay.tsx` — same `useReplayPlayback` pattern as the
  other two games.

## Phase 7 — Sudoku — DONE

A daily 9x9 puzzle with the same deterministic seed/replay/leaderboard wiring.
The engine generates the puzzle and its unique solution from the daily seed:
a seeded permutation of a valid base grid, then givens are removed one at a
time while a small bitmask backtracking solver confirms the puzzle still has
exactly one solution (memoized per seed so live play and every leaderboard
verification share the same board).

- **Input actions** are compact `"<row>,<col>,<digit>"` strings — one entry per
  digit attempt. Incorrect digits are rejected by the engine, counted as a
  mistake, and recorded too, so the replay carries the same penalty.
- **Scoring** is completion-only: `10,000 − 2 × seconds − 150 × mistakes`,
  clamped at 0. There is deliberately no pause: the clock is wall-clock-ish
  game time, so pausing to think can't be used to farm a near-perfect time.
  Pauses are also excluded from the other games' input recorder, but those
  games' scores don't depend on elapsed time. No passive state changes after
  the final digit, so live play and verification agree.
- **UI** is a shared 9x9 grid (`Grid.tsx`) used by live play and replay, with
  click/tap cell selection, an on-screen 1–9 pad, and arrow-key navigation.

**Files (new)**
- `src/games/sudoku/engine.ts` — `SudokuEngine`, seeded unique-puzzle
  generator, uniqueness solver, scoring.
- `src/games/sudoku/Grid.tsx` — shared board renderer.
- `src/games/sudoku/Board.tsx` — live play with timer/mistakes and publishing.
- `src/games/sudoku/Replay.tsx` — visual replay via `useReplayPlayback`.
- `src/games/sudoku/format.ts` — elapsed-time formatting.
- `src/games/sudoku/__tests__/engine.test.ts` — determinism, solve, mistake,
  and live-vs-replay tests.

## Routing & nav
- `src/components/Games/GamesFeed.tsx` — lists all four games with today's
  personal best (offline-safe, clickable) and a leaderboard-modal trigger.
- `src/App.tsx` — `feeds/games`, `feeds/games/2048`, `feeds/games/tetris`,
  `feeds/games/racer`, `feeds/games/sudoku`.
- `src/components/SidePane/index.tsx` — "Games" nav entry (`SportsEsportsIcon`).

## Deferred
- **Anti-bot hardening** — a deterministic replay is not proof a human played
  it; a script can produce a valid-but-inhuman input log. Considered and not
  built for v1: verifiable delay functions between input batches (proves real
  elapsed time without a server, but taxes weak mobile hardware hardest while
  barely constraining the strong hardware most likely to run a bot), and
  relay-anchored live checkpoints (proves elapsed time via independent relay
  timestamps, but requires connectivity during play, conflicting with
  offline-first). Revisit only if abuse actually shows up.
- **Beacon-based seed** — swap `getDailySeed`'s date-hash for a public
  randomness beacon (e.g. drand) so tomorrow's seed isn't computable today.
  Schema-compatible change (only the seed derivation, not the event shape).
- **Profile display on the leaderboard** — currently shows a truncated npub;
  wiring in cached profile names/avatars (pattern already exists elsewhere,
  e.g. `FollowingPlaylists.tsx`) is a pure UI polish item.
- **Cheap input-timing heuristics** as a lighter first-line signal (human
  jitter, no frame-perfect intervals) — mentioned during design as a
  near-zero-cost complement to full replay verification, not yet implemented.
