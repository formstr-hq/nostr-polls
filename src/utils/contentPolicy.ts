// Renderer-independent moderation state: the private mute list, the web of
// trust, and the per-surface WoT-only switches. A singleton (not context
// state) because the consumers that need these checks are deliberately
// stable — notification callbacks, standing interest filter builders, the
// Android Preferences bridge — and stale-closure-free reads matter more than
// re-rendering. React layers subscribe via `version` (useSyncExternalStore)
// and re-read whatever they need.

export type WotScope = "notifs" | "comments" | "likes";

// Durable caches: the device-local copy of our own (private) mute list gives
// active filtering on launch before relays answer; the toggles are
// localStorage prefs exactly like wotReportThreshold.
const MUTE_KEY_PREFIX = "pollerama:mutes:";
const WOT_ONLY_PREFIX = "pollerama:wotOnly:";

// Remote relay filters silently cap or reject huge `authors` arrays, so the
// fetch-level WoT gate only narrows subscriptions while the WoT set is small
// enough to filter on the wire. Above this cap, ingestion-time filtering
// (map builders / pushNotification) still hides everything non-WoT.
export const MAX_FILTER_AUTHORS = 400;

type WotOnlyToggles = Record<WotScope, boolean>;

class ContentPolicy {
  private muted = new Set<string>();
  private wot = new Set<string>();
  private wotOnly: WotOnlyToggles = { notifs: false, comments: false, likes: false };
  private listeners = new Set<() => void>();
  // Account the current muted set belongs to (guards cross-account writes).
  private account: string | null = null;

  /** Bumped on every mutation; useSyncExternalStore dependency. */
  version = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  // ── account hydration ─────────────────────────────────────────────────────
  // Loads the device-local mute list + toggles for `pubkey`. Called once per
  // account switch by ModerationProvider, before any event flows.
  hydrate(pubkey: string) {
    if (this.account === pubkey) return;
    this.account = pubkey;
    this.muted = new Set(readLocalMutes(pubkey));
    this.wotOnly = {
      notifs: readToggle("notifs"),
      comments: readToggle("comments"),
      likes: readToggle("likes"),
    };
    this.wot = new Set();
    this.emit();
  }

  /** Clear everything on logout (no account active). */
  reset() {
    this.account = null;
    this.muted = new Set();
    this.wot = new Set();
    this.wotOnly = { notifs: false, comments: false, likes: false };
    this.emit();
  }

  // ── mute list ─────────────────────────────────────────────────────────────
  isMuted = (pubkey: string | undefined): boolean =>
    !!pubkey && this.muted.has(pubkey);

  getMuted = (): string[] => Array.from(this.muted);

  /** Ingest (replace) the muted set — from the durable copy or a fresh
   * kind-10000 decrypt. `persist` false when the caller will publish first. */
  setMuted(pubkeys: string[], persist = true) {
    this.muted = new Set(pubkeys);
    if (persist && this.account) {
      try {
        localStorage.setItem(
          `${MUTE_KEY_PREFIX}${this.account}`,
          JSON.stringify(pubkeys)
        );
      } catch {
        // best-effort
      }
    }
    this.emit();
  }

  // ── web of trust ──────────────────────────────────────────────────────────
  // Mirrors user.webOfTrust (pure in-memory — never persisted here; lists-context
  // owns the durable store). Re-pushed on every WoT recompute.
  setWoT(pubkeys: Set<string> | undefined) {
    this.wot = pubkeys ?? new Set();
    this.emit();
  }

  inWoT = (pubkey: string | undefined): boolean =>
    !!pubkey && this.wot.has(pubkey);

  getWoT = (): string[] => Array.from(this.wot);
  getWoTSize = (): number => this.wot.size;

  // ── per-surface WoT-only toggles ──────────────────────────────────────────
  isWotOnly = (scope: WotScope): boolean => this.wotOnly[scope];

  setWotOnly = (scope: WotScope, on: boolean) => {
    if (this.wotOnly[scope] === on) return;
    this.wotOnly[scope] = on;
    try {
      localStorage.setItem(`${WOT_ONLY_PREFIX}${scope}`, on ? "1" : "0");
    } catch {
      // best-effort
    }
    this.emit();
  };

  getWotOnlyToggles = (): WotOnlyToggles => ({ ...this.wotOnly });

  /** Fetch-level gate: toggle on AND small enough to filter on the wire. */
  canFilterFetchByWot = (scope: WotScope): boolean =>
    this.wotOnly[scope] && this.wot.size > 0 && this.wot.size <= MAX_FILTER_AUTHORS;

  /** Relay-filter author list when the fetch-level gate applies, else undefined. */
  fetchAuthorsFor = (scope: WotScope): string[] | undefined =>
    this.canFilterFetchByWot(scope) ? Array.from(this.wot) : undefined;

  /** Ingestion gate for a given surface: not muted, and WoT member when
   * that surface's toggle is on. `ownPubkey` events always pass (your own
   * activity must stay visible/ignorable regardless of WoT membership). */
  passes = (pubkey: string | undefined, scope: WotScope, ownPubkey?: string): boolean => {
    if (!pubkey || pubkey === ownPubkey) return true;
    if (this.muted.has(pubkey)) return false;
    if (this.wotOnly[scope] && this.wot.size > 0 && !this.wot.has(pubkey)) return false;
    return true;
  };
}

function readLocalMutes(pubkey: string): string[] {
  try {
    const raw = localStorage.getItem(`${MUTE_KEY_PREFIX}${pubkey}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function readToggle(scope: WotScope): boolean {
  return localStorage.getItem(`${WOT_ONLY_PREFIX}${scope}`) === "1";
}

export const contentPolicy = new ContentPolicy();