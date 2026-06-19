# Local Relay — Design Doc (for sign-off)

Status: **DRAFT — awaiting sign-off**
Author: (design)
Scope: a self-contained, NIP-01-speaking **local relay running in a Web Worker**, backed by persistent storage with pruning, fully unit-tested, and portable to other apps.

---

## 1. Why

Today the feeds talk directly to external relays (`nostrRuntime.subscribe(relays, filters, …)`) and assemble the visible list from a single REQ's truncated top-N. This produces:

- **Gaps** ("latest, then a jump to 1–5h ago") — per-relay `limit` truncation + merging relays of unequal density; the WoT feed doesn't even use the outbox model.
- **Lag / stuck on load** — WoT aggregation on the main thread; a blocking modal with no timeout; nothing persisted, so every reload is a cold fetch.

The fix is a clean **data-layer / presentation-layer split**: presentation talks only to a local relay; the local relay answers instantly from a persistent local store; a separate sync engine fills that store from external relays asynchronously (outbox-routed, windowed), off the hot path.

We already have ~80% of the storage/query engine (`EventStore`). This doc takes it the rest of the way: a **literal NIP-01 relay in a Worker**, modular and tested so it can be lifted into other apps.

---

## 2. Design principles

1. **Pure, platform-free core.** All relay logic (filter matching, storage, REQ/EVENT/EOSE handling, replaceable/deletion/pruning) lives in code that imports nothing but `nostr-tools` types — no `Worker`, no `IndexedDB`, no React, no app modules. This is what makes it testable in jsdom and portable.
2. **Adapters at the edges.** Storage and transport are interfaces with two implementations each: a real one (IndexedDB / Worker) and an in-memory/fake one (tests, Node, SSR).
3. **Speak real NIP-01.** The Worker protocol is literally NIP-01 frames (`REQ`/`EVENT`/`EOSE`/`CLOSE`/`OK`/`CLOSED`/`NOTICE`) over `postMessage`. The same core could later be exposed over a real WebSocket (run as an actual relay, or reused by a backend) with zero logic changes.
4. **Incremental.** Lands behind the existing `nostrRuntime` facade so feeds migrate one at a time; old in-memory `EventStore` keeps working until cutover.

---

## 3. Architecture

```
┌──────────────── MAIN THREAD (presentation only) ─────────────────────┐
│  PRESENTATION (React)                                                  │
│    useQuery(filter) ──reactive──┐   feed.loadOlder()                   │
│  DATA-LAYER FACADE              ▼                                      │
│    LocalRelayClient ── relay/pool-shaped API ──┐                       │
│      .subscribe(filters,{onevent,oneose})      │                       │
│      .query(filter): Promise<Event[]>          │ NIP-01 frames         │
│      .publish(signedEvent)                     │ + control RPC         │
│  SignerBridge  ◀── worker asks it to sign NIP-42 AUTH                  │
│  visibilitychange / online  ──▶ worker                                 │
│  (signerManager / nostr-signer-capacitor-plugin / window.nostr live    │
│   here — Capacitor bridge is main-thread only)                         │
└────────────────────────────────────────────────┼─────────────────────┘
                                                  │ postMessage
┌─────────────────── WORKER THREAD (entire data layer) ─▼───────────────┐
│  RelayCore (pure NIP-01 engine)                                        │
│    • REQ → query EventDB, stream EVENTs, send EOSE, keep live sub      │
│    • EVENT(publish/ingest) → store + fan out to matching live subs     │
│    • CLOSE → drop sub                                                  │
│  EventDB (MemoryEventDB: indexes by id/kind/author/tag, query, prune)  │
│  Persistence: write-through debounce → IndexedDB; hydrate on boot      │
│  SYNC ENGINE  (talks to real wss:// relays — off the main thread)      │
│    • RelayPool (OUR own pool — NOT SimplePool) + OutboxService         │
│    • JSON.parse + verifyEvent(schnorr)  ← the real main-thread jank,   │
│      now off-thread                                                    │
│    • outbox author→relay partitioning + windowed pagination + tail     │
│    • needs a signature (NIP-42 AUTH) → RPC to main-thread SignerBridge │
└────────────────────────────────────────────────────────────────────────┘
```

**Decision: the ENTIRE data layer — including the sync engine — lives in the Worker.** The main thread does zero Nostr CPU work. The jank we're killing isn't `query` (that's already in the Worker); it's **`JSON.parse` + `verifyEvent` (schnorr) on every incoming event**, which only goes off-thread if the network layer goes into the Worker too. WebSockets, `SimplePool`, `SubscriptionManager`, and `OutboxService` are pure JS and run in a Worker fine.

**Three things must stay main-thread and are bridged (all async RPC — no hang):**
1. **Signing.** `signerManager` (Capacitor plugin / `window.nostr`) is only reachable in the main WebView context. *Publishing* signs on the main thread (UI-initiated) and hands the Worker an **already-signed** event. The only Worker-initiated signing is **NIP-42 AUTH**, handled via a `SignerBridge` RPC.
2. **Caches that used `localStorage`** (OutboxService, WoT, nip17 relay cache) → move to **IndexedDB** (Workers have no `localStorage`; we add IDB anyway).
3. **Page visibility** (`document.hidden` for the reconnect watchdog) → relayed from the main thread by postMessage. (`navigator.onLine` works in Workers.)

Trade-offs accepted: harder debugging (Worker context → piped logging, no React devtools on it) and the two bridges above.

---

## 4. Consequence to sign off: reads become async/reactive

Because the store lives in the Worker, `query()` is a `postMessage` round-trip → **async**. The current synchronous `EventStore.query()` used for "paint instantly on mount" goes away. Presentation switches to:

```ts
// snapshot + live updates; manages its own re-render
const { events, eose } = useQuery({ kinds:[1], authors });   // reactive
// or one-shot
const events = await client.query({ kinds:[1], authors, limit:50 });
```

This is the same pattern Amethyst/Nostur use and it deletes all the bespoke `displayedIdsRef`/`knownIdsRef`/`version` bookkeeping in the feeds. **Trade-off:** first paint waits one worker round-trip (sub-millisecond for cached data) instead of being synchronous. We can keep a tiny main-thread LRU of the last feed snapshot if instant-sync paint turns out to matter.

---

## 5. Module layout (portable — extractable as `@pollerama/local-relay`)

```
src/localRelay/
  core/
    types.ts              # NostrEvent, Filter, Frame types (re-export nostr-tools)
    matchFilter.ts        # NIP-01 filter matching        (moved from nostrRuntime/utils)
    eventValidation.ts    # replaceable/ephemeral/deletion (moved)
    EventDB.ts            # interface + MemoryEventDB (indexes, query, prune)
    RelayCore.ts          # NIP-01 engine: REQ/EVENT/CLOSE/EOSE + live sub registry
  storage/
    StorageAdapter.ts     # loadAll / batchPut / batchDelete / clear
    MemoryStorage.ts      # tests / Node
    IndexedDBStorage.ts   # browser (hand-rolled, dependency-free)
    persistence.ts        # write-through debounce + hydrate + prune scheduler
  sync/
    SyncEngine.ts         # orchestrates upstream fetch → RelayCore.ingest
    RelayPool.ts          # OUR pool — NOT nostr-tools SimplePool (see §5a)
    RelayConnection.ts    # one per relay: socket, REQ/CLOSE, parse, AUTH, backoff
    Socket.ts             # WebSocket interface + real impl + FakeSocket (tests)
    outbox.ts             # author→relay partitioning (moved from nostr/OutboxService)
    pagination.ts         # windowed since/until cursors per feed
    SignerPort.ts         # worker-side stub: requests a signature from main thread
  transport/
    frames.ts             # encode/decode NIP-01 frames + protocol constants
    channel.ts            # Channel interface (real MessagePort + in-memory fake)
    LocalRelayClient.ts   # main-thread client (relay-shaped API)
    SignerBridge.ts       # main-thread: answers worker sign-RPC via signerManager
  worker/
    relay.worker.ts       # THIN: wires RelayCore + IndexedDBStorage + SyncEngine + ports
  __tests__/
    matchFilter.test.ts
    EventDB.test.ts
    RelayCore.test.ts       # REQ→stored→EOSE→live; CLOSE; sub isolation
    persistence.test.ts     # round-trip + prune via MemoryStorage
    RelayPool.test.ts       # EOSE aggregation, dedup, failure isolation via FakeSocket
    SyncEngine.test.ts      # outbox partitioning + windowing over FakeSocket
    client.protocol.test.ts # LocalRelayClient ↔ RelayCore over fake channel
  index.ts                # public API
  README.md               # usage + portability notes
```

The `sync/` layer is unit-testable without real WebSockets: `Socket` is an interface with a `FakeSocket` that replays scripted relay frames, so the pool's EOSE/dedup/backoff logic, outbox partitioning, and windowed pagination are all tested deterministically. Only `worker/relay.worker.ts`, `IndexedDBStorage`, and the real `Socket` (wrapping `WebSocket`) touch platform APIs.

No React, no app imports anywhere under `core/`, `storage/`, `transport/`, `sync/` (except the platform impls). The module depends on `nostr-tools` for crypto/encoding only (`verifyEvent`, `finalizeEvent`, `nip19`) — **never** for relay I/O.

---

## 5a. Our own relay pool (NOT nostr-tools SimplePool)

`SimplePool` is not built for production feeds and we will not use it — not even worked around. The disqualifier: it **fires EOSE as soon as the *first* relay sends it**, not when all targeted relays have, so "loaded" routinely means "one fast relay answered, the rest are still streaming" — a direct cause of the missing-events symptom. (Our current `SubscriptionManager` already re-counts EOSE per relay via `subscribeMap` precisely to dodge this — evidence the abstraction fights us.) We replace it with a purpose-built pool.

**`RelayConnection` (one per relay URL):**
- Owns a `Socket` (WebSocket behind an interface). Connect with **exponential backoff + jitter**; on reconnect, **resubscribe** all active subs.
- Sends `REQ`/`CLOSE`/`EVENT`; parses `EVENT`/`EOSE`/`OK`/`CLOSED`/`NOTICE`/`AUTH`.
- **NIP-42 AUTH:** on `AUTH` challenge, request a signature via `SignerPort` (→ main-thread `SignerBridge`), publish the auth event, then replay pending REQs.
- Per-relay failure is isolated: a socket error/close on one relay never settles or breaks the subscription on others.

**`RelayPool` (across relays):**
- **EOSE contract:** a logical subscription emits EOSE only when **every targeted relay has sent EOSE, OR a per-sub deadline elapses** (so one dead/slow relay can't hang the feed *and* can't fake completion). The deadline is explicit and configurable, not nostr-tools' hidden 4.4s timer.
- **Dedup** events by `id` across relays before handing them up; record which relay delivered (outbox scoring / debugging).
- **Live tail stays open** after EOSE — late/middle events keep flowing into the store (one-shot `query()` is the only mode that closes on EOSE).
- Subscription **dedup + refcounting** by filter-hash (ported from the current `SubscriptionManager`), plus a **connection cap** (mobile WebViews limit concurrent sockets) with LRU eviction of idle relays.

All of this is pure logic over the `Socket` interface → fully unit-tested with `FakeSocket`; no real network in tests.

---

## 6. Protocol (Worker boundary = NIP-01)

Client → Relay:
- `["REQ", subId, ...filters]`
- `["CLOSE", subId]`
- `["EVENT", event]`            — publish (returns `OK`)
- `["INGEST", event[]]`         — **our one extension**: batch insert upstream events, no per-event `OK`, no echo. Keeps sync-engine throughput high.

Relay → Client:
- `["EVENT", subId, event]`
- `["EOSE", subId]`
- `["OK", eventId, ok, message]`
- `["CLOSED", subId, message]`
- `["NOTICE", message]`

Everything except `INGEST` is verbatim NIP-01, so `RelayCore` is reusable behind a real WebSocket later.

---

## 7. Persistence + pruning (explicit requirement)

**Write-through, debounced.** `addEvent` updates in-memory indexes immediately and enqueues to a batch writer that flushes to IndexedDB every ~1s or every N events (whichever first). Crash-safety is "best effort, eventually consistent" — acceptable for a cache.

**Hydration on boot.** On Worker start, stream all rows from IndexedDB into `MemoryEventDB` before answering REQs (or answer immediately and backfill — see sign-off Q). Warm cache = instant feed + pre-filled gaps.

**Pruning** (runs on a timer + at boot, deletes from memory *and* IndexedDB):
- **Per-kind TTL classes:**
  - *Never prune:* kind 0 (profiles), 3 (contacts), 10002 (relay lists), 10000-series mutes/lists.
  - *Long TTL:* 30023 (articles), 1068 (polls).
  - *Short TTL:* 1, 6, 7, 1018/1070 responses, reactions.
- **Hard cap:** max total events (default proposal **50,000**); when exceeded, evict oldest non-protected first.
- **Cadence:** prune every ~5 min and on boot.

(Exact TTL numbers + cap are knobs to confirm — §10.)

---

## 8. Testing strategy (explicit requirement)

All deterministic, no real Worker/IndexedDB needed:

- **`matchFilter`** — ids/authors/kinds/`#tag`/since/until/limit, multi-filter OR, edge cases.
- **`EventDB`** — index correctness; replaceable & addressable replacement; ephemeral not stored; NIP-09 deletion; `prune` (TTL + cap + protected kinds).
- **`persistence`** — write-through + hydrate round-trip via `MemoryStorage`; prune deletes from storage.
- **`RelayCore`** — REQ returns stored events then `EOSE`; live EVENT after EOSE reaches only matching subs; `CLOSE` stops delivery; `limit` honored; publish emits `OK`.
- **`LocalRelayClient` ↔ `RelayCore`** wired through an **in-memory fake `Channel`** — full protocol round-trip without a Worker, in jsdom.

The Worker file (`relay.worker.ts`) stays a ~30-line shell (wire `RelayCore` to `postMessage`) so it needs no unit test; all logic lives in tested core.

Target: meaningful coverage on `core/`, `storage/`, `transport/`.

---

## 9. Integration & migration (SINGLE CUTOVER — whole app at once)

No feature flag, no parallel path. One branch swaps the whole data layer.

### Surface area (measured)
62 files import `nostrRuntime`: **64** `subscribe()` sites, **26** `querySync/fetchOne/fetchBatched/get()` sites, **24** synchronous `query()` sites.

### Strategy: preserve the facade, break only synchronous reads
We keep the `nostrRuntime` object and its method **signatures**, re-implemented over `LocalRelayClient` + `SyncEngine`. This means the vast majority of call sites compile and behave unchanged:

- `subscribe(relays, filters, {onEvent,onEose,fresh,localOnly})` — **unchanged signature.** Internally: (a) open a `REQ` to the worker relay → instant cached replay + live updates via the same callbacks; (b) hand `relays`+`filters` to the `SyncEngine`, which outbox-partitions authors, windows the fetch, and `ingest()`s results into the worker (which then fan-out to the same REQ). All 64 sites keep working; they just get *better* data. `relays` becomes a hint the SyncEngine may override via outbox.
- `querySync / fetchOne / fetchBatched` — already `Promise`-returning. Signatures unchanged; re-pointed at worker query + sync. 26 sites unchanged.
- `publish / addEvent / addEvents / isDeleted` — unchanged (publish → worker store + upstream).

**The one breaking change: synchronous `query()` and `get()` become async** (worker round-trip). These **24 + a few** sites are converted in the same PR:
- Feed `useMemo(() => nostrRuntime.query(...))` patterns → the new **`useQuery(filter)`** reactive hook (snapshot + live). This also deletes the `displayedIdsRef`/`knownIdsRef`/`version` bookkeeping.
- One-shot reads → `await client.query(...)`.
- Rare "must paint synchronously" spots → optional main-thread last-snapshot LRU (kept tiny; not a second store).

### Cutover steps (one branch)
1. Build `src/localRelay/` (core + storage + transport + worker) with full tests — green before wiring.
2. In `singletons`: spawn the worker (it hosts `RelayCore` + `SyncEngine` + IndexedDB); create `LocalRelayClient` + `SignerBridge` (answers worker sign-RPC via `signerManager`) + visibility relay on the main thread.
2a. Move `OutboxService` / WoT / nip17 relay caches from `localStorage` to IndexedDB, with a one-time migration-on-first-run that imports any existing `localStorage` values.
3. Re-implement `nostrRuntime` as the facade over the client (signatures preserved). `subscribe(relays, …)` now forwards to the worker, which runs the SyncEngine internally.
4. Convert the 24 sync `query()`/`get()` sites to `useQuery`/`await`. Rewrite the 4 feed hooks (`useFollowingNotes`, `useDiscoverNotes`, `HomeFeed`, `PollFeed`) onto `useQuery` and delete their merge state.
5. Add outbox author→relay **partitioning** + windowed pagination in `SyncEngine` (the actual gap fix).
6. Delete the old in-memory `EventStore` usage (the class moves into `localRelay/core` as `MemoryEventDB`).
7. Move WoT aggregation into a worker (own worker or the relay worker) + add the `subscribeToContacts` timeout.

### Risk of big-bang (acknowledged)
One large PR touching ~62 files; no gradual validation. Mitigations: facade preservation keeps ~90 of ~114 call sites mechanically unchanged; the module is fully unit-tested before wiring; the 24 async conversions are mostly the 4 feed hooks plus simple `await`s.

---

## 10. ESSENTIALS TO SIGN OFF

1. **Entire data layer (incl. sync engine + network) in the Worker** — so `JSON.parse` + `verifyEvent` go off the main thread (the real jank). Requires the SignerBridge RPC (NIP-42 AUTH), localStorage→IndexedDB for caches, and a visibility relay. Confirm.
2. **Synchronous `query()`/`get()` become async** — the one breaking change of the cutover. Feeds move to a reactive `useQuery` hook; one-shot reads become `await`. ~24 sites. OK?
3. **Facade preserved:** `subscribe/querySync/fetchOne/publish` keep their signatures so ~90 of ~114 call sites are unchanged. OK?
4. **Protocol = literal NIP-01 over postMessage** + one `INGEST` batch extension. OK?
5. **IndexedDB: hand-rolled dependency-free wrapper** (behind `StorageAdapter`, with memory fallback for Capacitor/WKWebView) vs adding `idb` (~1KB). Recommend hand-rolled.
6. **Pruning knobs:** confirm per-kind TTLs, hard cap (proposed 50k), cadence (5 min).
7. **Hydration:** serve-immediately-and-backfill (recommended) vs block REQs until hydrated.
8. **`localStorage`→IndexedDB migration** for OutboxService, WoT cache, and nip17 relay cache (forced by the Worker move). Confirm one-time migration-on-first-run.
9. **Single cutover, whole app** (per your call) — one branch, all feeds migrated, old `EventStore` removed. Acknowledged higher-risk than phased; mitigated by facade preservation + fully-tested module before wiring.

---

## 11. Capacitor compatibility (researched)

Target: Capacitor 8 — **Android (Chromium WebView) live, iOS (WKWebView) likely later.** The app already ships a bundled worker (`useMiningWorker`), so the worker pattern is proven in-build.

| Concern | Verdict |
|---|---|
| **Dedicated Web Workers** | ✅ Supported on Android WebView and WKWebView. NOT Service Workers (unsupported in Capacitor) — we use Dedicated Workers. |
| **`new Worker(new URL('./x', import.meta.url))`** | ✅ Webpack 5 emits a same-origin classic worker chunk; loads from `http://localhost` / `capacitor://localhost`. No module-worker support needed. |
| **IndexedDB inside a Worker** | ✅ WebKit bug 149953 fixed in iOS/Safari 10 (2016). Fine on all targets. Chromium: always fine. |
| **IndexedDB persistence on WKWebView** | ⚠️ Best-effort: WKWebView can evict storage under pressure; recent iOS 17.4 had a transient "Connection to IndexedDB server lost" regression. |

**Design rules this imposes (already in our model):**
- `StorageAdapter` treats IndexedDB as a cache that may fail/vanish: every op try/caught, automatic fall back to memory-only, relay never blocks on storage errors. Runtime source of truth is in-memory; IDB is durability only.
- Optionally mirror tiny critical data (own contacts / relay list) to `@capacitor/preferences` (already a dependency). Event cache stays IDB-with-fallback.

Refs: WebKit [149953](https://bugs.webkit.org/show_bug.cgi?id=149953), [144875](https://bugs.webkit.org/show_bug.cgi?id=144875), [273827](https://bugs.webkit.org/show_bug.cgi?id=273827); Capacitor SW [#7069](https://github.com/ionic-team/capacitor/issues/7069).

---

## 11b. Multi-account & account switching

The app has multiple accounts and users switch often. The key insight: **the relay caches public, global data, so it is SHARED across accounts — not duplicated per account.** Only genuinely private data is account-scoped.

| Data | Store | Scope |
|---|---|---|
| Public events — notes (1), profiles (0), contacts (3), reposts/reactions (6/7), polls (1068), articles (30023), relay lists (10002), **encrypted gift-wrap ciphertext (1059)** | **one shared relay DB** (`pollerama-local-relay:shared`) | global |
| **Decrypted NIP-17 DM rumors (kind 14)** | **in-memory only — NEVER persisted** | per-account, RAM |
| WoT union/index, feed cursors | small per-account namespace | per-account |

- **Decrypted rumors are never written to disk.** We persist only the **encrypted** gift wraps (1059) — public ciphertext, decryptable solely with the account's key. The DM layer decrypts **on demand into memory** (re-querying `{kinds:[1059], "#p":[activePubkey]}` from the relay on load/switch) and holds plaintext in runtime state only. This **replaces the current `dm_cache_*` localStorage cache** (which persists decrypted DMs) — dropped in the cutover. Result: no decrypted/private data is persisted anywhere.
- **Sharing public events is correct and efficient.** Alice's note is the same event for every account; storing it once avoids duplicate bytes and avoids refetching the same events on every switch. Gift-wrap ciphertext is harmless to share — it's encrypted and only meaningful to its recipient.
- **What changes on switch is the *selection*, not the stored events** — which authors/scope you view and which relays/follows the SyncEngine targets. Both are query-level and instant.
- **`setActiveAccount(pubkey)`** therefore does NOT re-hydrate the event store. It: (1) swaps the small per-account context (WoT, cursors, DM layer), (2) restarts the SyncEngine for the new account's follows/WoT, (3) lets active `useEvents` queries re-run against the same shared store with the new scope → feeds repaint instantly.
- **Isolation guarantee:** decrypted/private content never lives in the shared store, so sharing it cannot leak anything (public events are public on relays anyway).
- **`IndexedDBStorage(namespace)`** defaults to the shared store; the optional namespace is reserved for a per-account *private* store should we ever persist decrypted data via the relay (we don't in v1). `destroy()` exists for a full clear.

---

## 12. Out of scope (v1)

- Moving SimplePool/signer into the Worker.
- NIP-50 search inside the local relay (stays a passthrough to search relays).
- Negentropy/NIP-77 set reconciliation (future optimization for backfill).
- Multi-tab shared Worker (v1 = one DedicatedWorker per tab; IndexedDB is shared so data is consistent, sockets are not deduped across tabs).
```
