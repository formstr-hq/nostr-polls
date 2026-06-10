/**
 * Singleton manager that wraps `@formstr/signer`'s `Signer`.
 *
 * - Preserves the legacy public API that the rest of the codebase calls
 *   (`getSigner`, `getUser`, `getAccounts`, `onChange`, `switchAccount`,
 *   `removeAccount`, `logout`, `registerLoginModal`, `publishKind0`,
 *   `loginWithNip07/46/55`, `createGuestAccount`).
 * - Auto-unlocks extension/nip46/android accounts silently on hydrate;
 *   ncryptsec accounts require a passphrase via `passphraseCallback`.
 * - Holds a sidecar profile cache so account avatars survive reloads
 *   even though the package's `StoredAccount` is minimal.
 * - Migrates the pre-existing `pollerama:accounts` localStorage format
 *   into the package's storage on first launch (see `legacyMigration.ts`).
 */
import {
  createSigner,
  encryptSecretKey,
  type ActiveSigner,
  type Signer,
  type SignerEvent,
  type StoredAccount as PackageStoredAccount,
} from "@formstr/signer";
import { Event, EventTemplate, nip19 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";
import { NostrSignerPlugin } from "nostr-signer-capacitor-plugin";

import { defaultRelays, fetchUserProfile } from "../../nostr";
import { publishInboxRelays } from "../../nostr/nip17";
import { pool } from "..";
import { ANONYMOUS_USER_NAME, User } from "../../contexts/user-context";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import {
  getCachedUserData,
  setCachedUserData,
  removeCachedUserData,
  type CachedUserData,
} from "./userProfileCache";
import {
  migrateLegacyStorage,
  type PendingMigration,
} from "./legacyMigration";
import {
  getLegacyNsec,
  getLegacyNsecForAccount,
  getNsecForAccount,
  removeLegacyNsec,
  removeLegacyNsecForAccount,
  removeNsecForAccount,
} from "../../utils/secureKeyStorage";

// ---------------------------------------------------------------------------
// Public types — kept structurally close to the legacy shape so consumers
// (UserMenu, user-context) don't need to change call sites.
// ---------------------------------------------------------------------------

/** Method values exposed to consumers. Mirrors the package's `LoginMethod`. */
export type LoginMethod = "extension" | "nip46" | "android" | "ncryptsec";

export type StoredAccount = {
  pubkey: string;
  npub: string;
  loginMethod: LoginMethod;
  userData?: CachedUserData;
};

export type PassphraseRequest =
  | { kind: "unlock"; pubkey: string; error?: string }
  | { kind: "migrate"; pubkey: string; error?: string };

export type PassphraseCallback = (
  req: PassphraseRequest,
) => Promise<string | null>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseProfileContent(kind0: Event | null, pubkey: string): User {
  if (!kind0) {
    return { pubkey, name: ANONYMOUS_USER_NAME, picture: DEFAULT_IMAGE_URL };
  }
  try {
    return { ...JSON.parse(kind0.content), pubkey };
  } catch {
    console.warn("Malformed kind-0 content for", pubkey);
    return { pubkey, name: ANONYMOUS_USER_NAME, picture: DEFAULT_IMAGE_URL };
  }
}

function toExposedAccount(account: PackageStoredAccount): StoredAccount {
  return {
    pubkey: account.pubkey,
    npub: account.npub,
    loginMethod: account.method,
    userData: getCachedUserData(account.pubkey),
  };
}

function buildUserFromAccount(account: PackageStoredAccount): User {
  const cached = getCachedUserData(account.pubkey);
  return {
    pubkey: account.pubkey,
    name: cached?.name ?? ANONYMOUS_USER_NAME,
    picture: cached?.picture ?? DEFAULT_IMAGE_URL,
    about: cached?.about,
  };
}

// ---------------------------------------------------------------------------
// SignerManager
// ---------------------------------------------------------------------------

class SignerManager {
  private signer: Signer;
  private user: User | null = null;
  private onChangeCallbacks: Set<() => void> = new Set();
  private loginModalCallback: (() => Promise<void>) | null = null;
  private passphraseCallback: PassphraseCallback | null = null;
  /** Legacy nsec/guest accounts awaiting interactive passphrase migration. */
  private pendingMigrations: PendingMigration[] = [];
  /**
   * Serializes all operations that mutate the active account / active signer:
   * `hydrate`, `createGuestAccount`, `switchAccount`, `removeAccount`,
   * `loginWith*`, `afterLogin`, and the interactive unlock path inside
   * `getSigner`. Without this, a slow boot-time silent unlock can land after
   * a user-driven login and snap the active signer back to the previous
   * account — at which point a kind-0 publish signs with the wrong key.
   *
   * NOT reentrant. Code already running inside `withSignerLock` must not call
   * `withSignerLock` again (use the package signer directly).
   */
  private signerLock: Promise<unknown> = Promise.resolve();

  constructor() {
    // Migrate legacy storage BEFORE the package's Signer constructor reads
    // its keys. nsec/guest accounts can't migrate silently — they're queued
    // for a passphrase prompt on first sign attempt.
    const migration = migrateLegacyStorage();
    this.pendingMigrations = migration.pending;

    this.signer = createSigner({
      appName: "Pollerama",
      androidSignerPlugin: NostrSignerPlugin,
    });
    this.signer.onChange((event) => this.handleSignerEvent(event));

    // Hydrate runs under the lock so any user-initiated login that fires
    // before silent-unlock completes will queue behind it.
    this.withSignerLock(() => this.hydrate());
  }

  private async withSignerLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.signerLock;
    let release: () => void = () => {};
    this.signerLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      return await operation();
    } finally {
      release();
    }
  }

  // -------------------------------------------------------------------------
  // Public API — preserved from the legacy SignerManager
  // -------------------------------------------------------------------------

  getAccounts(): StoredAccount[] {
    const accounts = this.signer.listAccounts().map(toExposedAccount);
    // Surface any pending nsec/guest accounts so the UI still shows them
    // (with their cached profile) even though they're not in package storage yet.
    for (const pending of this.pendingMigrations) {
      if (accounts.some((a) => a.pubkey === pending.pubkey)) continue;
      accounts.push({
        pubkey: pending.pubkey,
        npub: pending.npub,
        loginMethod: "ncryptsec",
        userData: getCachedUserData(pending.pubkey),
      });
    }
    return accounts;
  }

  getUser(): User | null {
    return this.user;
  }

  /**
   * Resolves once any in-flight signer-mutating operation (initial hydrate,
   * an ongoing login, a switch, ...) finishes. UI handlers can await this
   * before kicking off a new operation if they want to avoid contending for
   * the lock and surfacing a confusing intermediate state.
   */
  async awaitReady(): Promise<void> {
    await this.signerLock;
  }

  registerLoginModal(callback: () => Promise<void>): void {
    this.loginModalCallback = callback;
  }

  registerPassphraseCallback(callback: PassphraseCallback): void {
    this.passphraseCallback = callback;
  }

  onChange(cb: () => void): () => void {
    this.onChangeCallbacks.add(cb);
    return () => {
      this.onChangeCallbacks.delete(cb);
    };
  }

  async switchAccount(pubkey: string): Promise<void> {
    await this.withSignerLock(async () => {
      await this.signer.switchAccount(pubkey);
      // After switch the package clears the in-memory signer (locked state).
      const account = this.signer.getActiveAccount();
      if (account) {
        await this.silentUnlock(account);
      }
    });
  }

  async removeAccount(pubkey: string): Promise<void> {
    await this.withSignerLock(async () => {
      await this.signer.logout(pubkey);
      removeCachedUserData(pubkey);
      // If the user removes a pending-migration account, drop it too.
      this.pendingMigrations = this.pendingMigrations.filter(
        (p) => p.pubkey !== pubkey,
      );
      // Best-effort: clear legacy secure storage for nsec accounts.
      try {
        await removeNsecForAccount(pubkey);
        await removeLegacyNsecForAccount(pubkey);
      } catch {
        // Non-native environment will throw — ignored.
      }
    });
  }

  async logout(): Promise<void> {
    const active = this.signer.getActiveAccount();
    if (active) {
      await this.removeAccount(active.pubkey);
    } else {
      this.user = null;
      this.notify();
    }
  }

  async getSigner(): Promise<ActiveSigner> {
    // Wait for any in-flight signer mutation (initial hydrate, ongoing
    // login/switch) so a sign request fired during boot doesn't race.
    await this.signerLock;

    const active = this.signer.getActiveSigner();
    if (active) return active;

    // No active signer — the recovery paths below all mutate active state,
    // so acquire the lock before they touch the package signer.
    return this.withSignerLock(async () => {
      // Re-check inside the lock: another caller may have unlocked already
      // while we were waiting.
      const alreadyActive = this.signer.getActiveSigner();
      if (alreadyActive) return alreadyActive;

      const account = this.signer.getActiveAccount();

      // Case 1: an active account is hydrated but locked. Try silent unlock
      // again (e.g. NIP-46 may have reconnected by now) before prompting.
      if (account) {
        const unlocked = await this.silentUnlock(account).catch(() => null);
        if (unlocked) return unlocked;

        // ncryptsec is the only locked state that needs interactive input.
        if (account.method === "ncryptsec" && account.ncryptsec) {
          const signer = await this.promptUnlock(
            account.pubkey,
            account.ncryptsec,
          );
          if (signer) return signer;
        }

        // Account exists but we couldn't unlock it (Amber denied / extension
        // gone / NIP-46 offline / ncryptsec passphrase cancelled). Don't fall
        // through to the login modal — the user IS logged in, just locked.
        // Let the caller decide whether to surface a toast, retry, etc.
        throw new Error(
          `Signer locked for account ${account.pubkey} (${account.method})`,
        );
      }

      // Case 2: there's a pending legacy nsec/guest migration. Prompt for a
      // passphrase to convert it to ncryptsec, then log in.
      if (this.pendingMigrations.length > 0) {
        const migrated = await this.runPendingMigration(
          this.pendingMigrations[0],
        );
        if (migrated) return migrated;
      }

      // Case 3: no account at all — open the login modal.
      if (this.loginModalCallback) {
        await this.loginModalCallback();
        const after = this.signer.getActiveSigner();
        if (after) return after;
      }

      throw new Error("No signer available and no login flow registered.");
    });
  }

  async publishKind0(user: User): Promise<void> {
    const signer = await this.getSigner();
    await this.publishKind0WithSigner(user, signer);
  }

  /**
   * Sign+publish a kind-0 using a specific signer reference. Used inside
   * `withSignerLock`-guarded operations (createGuestAccount, afterLogin) so
   * they can publish without re-entering the lock via getSigner.
   *
   * Verifies the signer's pubkey matches the user's pubkey first — a hard
   * guard against publishing one account's metadata under another account's
   * signature (which would silently overwrite the second account's kind-0).
   */
  private async publishKind0WithSigner(
    user: User,
    signer: ActiveSigner,
  ): Promise<void> {
    const signerPubkey = await signer.getPublicKey();
    if (signerPubkey !== user.pubkey) {
      throw new Error(
        `publishKind0: active signer pubkey ${signerPubkey} does not match target ${user.pubkey}`,
      );
    }
    const kind0Event: EventTemplate = {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({
        name: user.name,
        about: user.about || "",
        picture: user.picture || "",
      }),
    };
    const signed = await signer.signEvent(kind0Event);
    pool.publish(defaultRelays, signed);
  }

  // -------------------------------------------------------------------------
  // Login methods — preserved names, delegated to the package
  // -------------------------------------------------------------------------

  /**
   * Underlying `@formstr/signer` instance. Exposed so UI helpers
   * (e.g. `renderLoginHtml` + `attachLoginListeners`) can drive the same
   * signer this manager wraps. Callers must call `afterLogin(pubkey)`
   * once the package's `onLogin` fires so the kind-0 profile is refreshed.
   */
  getPackageSigner(): Signer {
    return this.signer;
  }

  /**
   * Post-login bootstrap. Refreshes the kind-0 cache from relays so the
   * header shows the right name/avatar.
   *
   * Deliberately does NOT auto-publish anything. A login via NIP-07 / NIP-46
   * / NIP-55 always points at an existing account — if the kind-0 fetch
   * comes back null we cannot distinguish "user has no kind-0 yet" from
   * "relays timed out and the kind-0 we wanted is sitting somewhere else",
   * and publishing a default `Anon...` kind-0 on top of a real profile
   * silently rugs it. New accounts created via `createGuestAccount` get
   * their initial kind-0 there, where we *know* the pubkey is brand new.
   */
  async afterLogin(pubkey: string): Promise<void> {
    await this.withSignerLock(() => this.afterLoginInternal(pubkey));
  }

  /** Lock-free body of `afterLogin`. Callers must already hold the lock. */
  private async afterLoginInternal(pubkey: string): Promise<void> {
    await this.afterLoginRefreshProfile(pubkey);
  }

  /**
   * Run a login operation (whatever method — extension, bunker URI,
   * nostrconnect, ncryptsec) atomically with the post-login kind-0 bootstrap.
   * The whole flow runs under the signer lock so a slow silent-unlock can't
   * land between the login and the kind-0 publish.
   *
   * UI handlers should prefer this over calling `getPackageSigner().loginWith*`
   * directly — that pattern leaves a TOCTOU window between login and
   * afterLogin where the active signer can be reset.
   */
  async runLogin(
    operation: (packageSigner: Signer) => Promise<{ pubkey: string }>,
  ): Promise<{ pubkey: string }> {
    return this.withSignerLock(async () => {
      const result = await operation(this.signer);
      await this.afterLoginInternal(result.pubkey);
      return result;
    });
  }

  async loginWithNip07(): Promise<void> {
    await this.withSignerLock(async () => {
      const account = await this.signer.loginWithExtension();
      await this.afterLoginRefreshProfile(account.pubkey);
    });
  }

  async loginWithNip46(bunkerUri: string): Promise<void> {
    await this.withSignerLock(async () => {
      const account = await this.signer.loginWithBunkerUri(bunkerUri, { pool });
      await this.afterLoginRefreshProfile(account.pubkey);
    });
  }

  async loginWithNip55(packageName: string, _cachedPubkey?: string): Promise<void> {
    await this.withSignerLock(async () => {
      const account = await this.signer.loginWithAndroidSigner({ packageName });
      await this.afterLoginRefreshProfile(account.pubkey);
    });
  }

  /**
   * Create a new ncryptsec account and publish its kind-0 profile.
   * Replaces the old `createGuestAccount(secret, metadata)` flow — the raw
   * secret is no longer surfaced or stored in cleartext.
   */
  async createGuestAccount(
    passphrase: string,
    metadata: { name?: string; picture?: string; about?: string },
  ): Promise<{ npub: string; ncryptsec: string }> {
    return this.withSignerLock(async () => {
      const result = await this.signer.createAccount(passphrase);
      const account = this.signer.getActiveAccount();
      const signer = this.signer.getActiveSigner();
      if (!account || !signer) {
        throw new Error("createAccount succeeded but no active signer");
      }

      setCachedUserData(account.pubkey, {
        name: metadata.name,
        picture: metadata.picture,
        about: metadata.about,
      });
      this.user = {
        pubkey: account.pubkey,
        name: metadata.name || ANONYMOUS_USER_NAME,
        picture: metadata.picture || DEFAULT_IMAGE_URL,
        about: metadata.about,
      };

      await this.publishKind0WithSigner(this.user, signer);
      await publishInboxRelays(defaultRelays).catch((e) =>
        console.warn("publishInboxRelays failed:", e),
      );
      this.notify();
      return result;
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async hydrate(): Promise<void> {
    const active = this.signer.getActiveAccount();
    if (active) {
      this.user = buildUserFromAccount(active);
      try {
        await this.silentUnlock(active);
      } catch (e) {
        console.warn("Silent unlock failed during hydrate:", e);
      }
      // Even if silent unlock failed, keep the user object so the avatar
      // renders — getSigner() will prompt when a sign action fires.
    } else if (this.pendingMigrations.length > 0) {
      // No package-side account, but a legacy nsec/guest is awaiting migration.
      // Show its cached profile in the header. getSigner() will prompt later.
      const first = this.pendingMigrations[0];
      this.user = {
        pubkey: first.pubkey,
        name: getCachedUserData(first.pubkey)?.name ?? ANONYMOUS_USER_NAME,
        picture: getCachedUserData(first.pubkey)?.picture ?? DEFAULT_IMAGE_URL,
        about: getCachedUserData(first.pubkey)?.about,
      };
    }

    this.notify();
  }

  /**
   * Attempt to re-establish an in-memory ActiveSigner without user input.
   * Delegates to the package's `unlock()` which rebuilds the runtime signer
   * from persisted state without re-pairing — for nip46 that means no
   * `connect` request to the bunker, and for android no `getPublicKey`
   * roundtrip through the signer-app plugin. ncryptsec returns null and
   * the caller drives the passphrase prompt via promptUnlock().
   *
   * The `account` arg is unused now but kept on the signature so callers
   * don't change shape; `unlock()` reads the active account itself.
   */
  private async silentUnlock(
    _account: PackageStoredAccount,
  ): Promise<ActiveSigner | null> {
    return this.signer.unlock({ pool });
  }

  private async promptUnlock(
    pubkey: string,
    ncryptsec: string,
  ): Promise<ActiveSigner | null> {
    if (!this.passphraseCallback) {
      console.warn("ncryptsec account is locked but no passphraseCallback registered");
      return null;
    }
    let error: string | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      const passphrase = await this.passphraseCallback({
        kind: "unlock",
        pubkey,
        error,
      });
      if (!passphrase) return null;
      try {
        await this.signer.loginWithNcryptsec(ncryptsec, passphrase);
        return this.signer.getActiveSigner();
      } catch (e) {
        console.error("Failed to unlock ncryptsec:", e);
        error = "Incorrect passphrase. Try again.";
      }
    }
    return null;
  }

  /**
   * Run the interactive passphrase migration for a legacy nsec/guest account.
   * On success the account is now persisted as method='ncryptsec' and unlocked.
   */
  private async runPendingMigration(
    pending: PendingMigration,
  ): Promise<ActiveSigner | null> {
    if (!this.passphraseCallback) return null;

    let secretBytes: Uint8Array | null = null;

    if (pending.source === "guest" && pending.inlineSecret) {
      secretBytes = hexToBytes(pending.inlineSecret);
    } else if (pending.source === "nsec") {
      // Pull the nsec from secure storage (per-account key, or legacy single slot).
      let nsec =
        (await getNsecForAccount(pending.pubkey).catch(() => null)) ||
        (await getLegacyNsecForAccount(pending.pubkey).catch(() => null)) ||
        (await getLegacyNsec().catch(() => null));
      if (!nsec) {
        console.warn("Legacy nsec account but no nsec in secure storage", pending.pubkey);
        // Drop it so it doesn't keep nagging.
        this.pendingMigrations = this.pendingMigrations.filter((p) => p !== pending);
        return null;
      }
      try {
        const decoded = nip19.decode(nsec);
        if (decoded.type !== "nsec") throw new Error("not an nsec");
        secretBytes = decoded.data as Uint8Array;
      } catch (e) {
        console.error("Invalid legacy nsec:", e);
        return null;
      }
    }

    if (!secretBytes) return null;

    const passphrase = await this.passphraseCallback({
      kind: "migrate",
      pubkey: pending.pubkey,
    });
    if (!passphrase) return null;

    const ncryptsec = encryptSecretKey(secretBytes, passphrase);
    await this.signer.loginWithNcryptsec(ncryptsec, passphrase);

    // Migration complete — drop from queue and clean up secure storage.
    this.pendingMigrations = this.pendingMigrations.filter((p) => p !== pending);
    try {
      await removeNsecForAccount(pending.pubkey);
      await removeLegacyNsecForAccount(pending.pubkey);
      await removeLegacyNsec();
    } catch {
      // Web / non-native — no secure storage to clean.
    }

    return this.signer.getActiveSigner();
  }

  /** After a successful login, refresh the sidecar profile cache. */
  private async afterLoginRefreshProfile(pubkey: string): Promise<void> {
    try {
      const kind0 = await fetchUserProfile(pubkey);
      const parsed = parseProfileContent(kind0, pubkey);
      setCachedUserData(pubkey, {
        name: parsed.name,
        picture: parsed.picture,
        about: parsed.about,
      });
      // Refresh exposed user; the signer.onChange callback already set
      // a baseline, this overlays the freshly-fetched fields.
      this.user = parsed;
      this.notify();
    } catch (e) {
      console.warn("Failed to refresh profile after login:", e);
    }
  }

  private handleSignerEvent(event: SignerEvent): void {
    if (event.type === "login" || event.type === "switch") {
      this.user = buildUserFromAccount(event.account);
    } else if (event.type === "logout") {
      const active = this.signer.getActiveAccount();
      this.user = active ? buildUserFromAccount(active) : null;
    }
    this.notify();
  }

  private notify(): void {
    this.onChangeCallbacks.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.error("SignerManager listener threw:", e);
      }
    });
  }
}

export const signerManager = new SignerManager();
