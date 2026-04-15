import { nip07Signer } from "./NIP07Signer";
import { createNip46Signer } from "./BunkerSigner";
import { NostrSigner } from "./types";
import { Event, EventTemplate, nip19 } from "nostr-tools";
import { defaultRelays, fetchUserProfile } from "../../nostr";
import { publishInboxRelays } from "../../nostr/nip17";
import {
  getStoredAccounts,
  addOrUpdateStoredAccount,
  removeStoredAccount,
  getActiveAccountPubkey,
  setActiveAccountPubkey,
  removeActiveAccountPubkey,
  migrateToMultiAccount,
  StoredAccount,
  StoredUserData,
} from "../../utils/localStorage";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { ANONYMOUS_USER_NAME, User } from "../../contexts/user-context";
import { pool } from "..";
import { createLocalSigner } from "./LocalSigner";
import { isNative } from "../../utils/platform";
import {
  getNsec,
  removeNsec,
  getNip55Credentials,
  removeNip55Credentials,
  saveNsecForAccount,
  getNsecForAccount,
  removeNsecForAccount,
  saveNip55PkgForAccount,
  getNip55PkgForAccount,
  removeNip55PkgForAccount,
} from "../../utils/secureKeyStorage";
import { bytesToHex } from "@noble/hashes/utils";
import { createNIP55Signer } from "./NIP55Signer";

/** Safely parse a kind-0 profile event, falling back to defaults on invalid JSON. */
function parseProfileContent(kind0: Event | null, pubkey: string): User {
  if (!kind0) return { pubkey, name: ANONYMOUS_USER_NAME, picture: DEFAULT_IMAGE_URL };
  try {
    return { ...JSON.parse(kind0.content), pubkey };
  } catch {
    console.warn("Malformed kind-0 content for", pubkey);
    return { pubkey, name: ANONYMOUS_USER_NAME, picture: DEFAULT_IMAGE_URL };
  }
}

class SignerManager {
  private signer: NostrSigner | null = null;
  private user: User | null = null;
  private accounts: StoredAccount[] = [];
  private onChangeCallbacks: Set<() => void> = new Set();
  private loginModalCallback: (() => Promise<void>) | null = null;
  private pendingSignPromises: Map<string, (event: Event) => void> = new Map();
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.restoreFromStorage().finally(() => {
      this.initPromise = null;
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  getAccounts(): StoredAccount[] {
    return this.accounts;
  }

  async switchAccount(pubkey: string) {
    const account = this.accounts.find((a) => a.pubkey === pubkey);
    if (!account) throw new Error(`Account ${pubkey} not found`);
    await this.activateAccount(account);
    setActiveAccountPubkey(pubkey);
    this.notify();
  }

  async removeAccount(pubkey: string) {
    if (isNative) {
      await removeNsecForAccount(pubkey);
      await removeNip55PkgForAccount(pubkey);
    }
    removeStoredAccount(pubkey);
    this.accounts = getStoredAccounts();

    if (this.user?.pubkey === pubkey) {
      if (this.accounts.length > 0) {
        await this.activateAccount(this.accounts[0]);
        setActiveAccountPubkey(this.accounts[0].pubkey);
      } else {
        this.signer = null;
        this.user = null;
        removeActiveAccountPubkey();
      }
    }

    this.notify();
  }

  async publishKind0(user: User) {
    if (!this.signer) throw new Error("No signer available");

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
    const signedKind0 = await this.signer.signEvent(kind0Event);
    pool.publish(defaultRelays, signedKind0);
  }

  async loginWithNip55(packageName: string, cachedPubkey?: string) {
    const signer = createNIP55Signer(packageName, cachedPubkey);
    const pubkey = await signer.getPublicKey();

    const kind0 = await fetchUserProfile(pubkey);
    const userData: User = parseProfileContent(kind0, pubkey);

    this.signer = signer;
    this.user = userData;

    if (isNative) await saveNip55PkgForAccount(pubkey, packageName);

    const account: StoredAccount = {
      pubkey,
      loginMethod: "nip55",
      nip55PackageName: packageName,
      userData: toStoredUserData(userData),
    };
    addOrUpdateStoredAccount(account);
    this.accounts = getStoredAccounts();
    setActiveAccountPubkey(pubkey);

    this.notify();
  }

  resolvePendingSign(event: Event) {
    const resolver = this.pendingSignPromises.get(event.id);
    if (!resolver) {
      console.warn("No pending sign promise for event", event.id);
      return;
    }
    resolver(event);
    this.pendingSignPromises.delete(event.id);
  }

  registerLoginModal(callback: () => Promise<void>) {
    this.loginModalCallback = callback;
  }

  async restoreFromStorage() {
    // One-time migration from the old single-account storage format
    migrateToMultiAccount();

    // Migrate legacy Capacitor Preferences keys if needed (native only)
    if (isNative) {
      await this.migrateSecureStorage();
    }

    this.accounts = getStoredAccounts();

    if (this.accounts.length === 0) {
      this.notify();
      return;
    }

    const activePubkey = getActiveAccountPubkey();
    const accountToActivate =
      (activePubkey ? this.accounts.find((a) => a.pubkey === activePubkey) : null) ??
      this.accounts[0];

    // Pre-populate user from cache for instant display while signer initialises
    if (accountToActivate.userData) {
      this.user = buildUser(accountToActivate);
    }

    try {
      await this.activateAccount(accountToActivate);
      setActiveAccountPubkey(accountToActivate.pubkey);
    } catch (e) {
      console.error("Signer restore failed:", e);
    }

    this.notify();
  }

  async loginWithNsec(nsec: string) {
    if (!isNative) throw new Error("NSEC login only allowed on native");

    const privkey = nip19.decode(nsec).data as Uint8Array;
    if (!privkey) throw new Error("Invalid nsec");

    this.signer = createLocalSigner(bytesToHex(privkey));
    const pubkey = await this.signer.getPublicKey();

    const kind0 = await fetchUserProfile(pubkey);
    const userData: User = parseProfileContent(kind0, pubkey);

    await saveNsecForAccount(pubkey, nsec);

    const account: StoredAccount = {
      pubkey,
      loginMethod: "nsec",
      userData: toStoredUserData(userData),
    };
    addOrUpdateStoredAccount(account);
    this.accounts = getStoredAccounts();
    setActiveAccountPubkey(pubkey);

    this.user = userData;
    this.notify();
  }

  async createGuestAccount(
    privkey: string,
    userMetadata: { name?: string; picture?: string; about?: string },
  ) {
    this.signer = createLocalSigner(privkey);
    const pubkey = await this.signer.getPublicKey();

    const userData: User = {
      pubkey,
      name: userMetadata.name || "Guest",
      picture: userMetadata.picture || DEFAULT_IMAGE_URL,
      about: userMetadata.about || "",
      privateKey: privkey,
    };

    const account: StoredAccount = {
      pubkey,
      loginMethod: "guest",
      secret: privkey,
      userData: toStoredUserData(userData),
    };
    addOrUpdateStoredAccount(account);
    this.accounts = getStoredAccounts();
    setActiveAccountPubkey(pubkey);

    this.user = userData;

    await this.publishKind0(userData);
    await publishInboxRelays(defaultRelays);

    this.notify();
  }

  async loginWithNip07() {
    if (!window.nostr) throw new Error("NIP-07 extension not found");
    this.signer = nip07Signer;
    const pubkey = await window.nostr.getPublicKey();

    const kind0: Event | null = await fetchUserProfile(pubkey);
    const userData: User = parseProfileContent(kind0, pubkey);

    const account: StoredAccount = {
      pubkey,
      loginMethod: "nip07",
      userData: toStoredUserData(userData),
    };
    addOrUpdateStoredAccount(account);
    this.accounts = getStoredAccounts();
    setActiveAccountPubkey(pubkey);

    this.user = userData;
    this.notify();
  }

  async loginWithNip46(bunkerUri: string) {
    const remoteSigner = await createNip46Signer(bunkerUri);
    const pubkey = await remoteSigner.getPublicKey();

    const kind0: Event | null = await fetchUserProfile(pubkey);
    const userData: User = parseProfileContent(kind0, pubkey);

    const account: StoredAccount = {
      pubkey,
      loginMethod: "nip46",
      bunkerUri,
      userData: toStoredUserData(userData),
    };
    addOrUpdateStoredAccount(account);
    this.accounts = getStoredAccounts();
    setActiveAccountPubkey(pubkey);

    this.signer = remoteSigner;
    this.user = userData;
    this.notify();
  }

  /** Removes the active account and switches to the next one (or logs out). */
  async logout() {
    if (this.user?.pubkey) {
      await this.removeAccount(this.user.pubkey);
    } else {
      this.signer = null;
      this.user = null;
      this.notify();
    }
  }

  async getSigner(): Promise<NostrSigner> {
    if (this.signer) return this.signer;

    if (this.initPromise) {
      await this.initPromise;
      if (this.signer) return this.signer;
    }

    if (this.loginModalCallback) {
      await this.loginModalCallback();
      if (this.signer) return this.signer;
    }

    throw new Error("No signer available and no login modal registered.");
  }

  getUser() {
    return this.user;
  }

  onChange(cb: () => void) {
    this.onChangeCallbacks.add(cb);
    return () => this.onChangeCallbacks.delete(cb);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Create and install the right NostrSigner for the given stored account. */
  private async activateAccount(account: StoredAccount) {
    switch (account.loginMethod) {
      case "guest": {
        if (!account.secret) throw new Error("No secret for guest account");
        this.signer = createLocalSigner(account.secret);
        break;
      }
      case "nsec": {
        if (!isNative) throw new Error("nsec only supported on native");
        const nsec = await getNsecForAccount(account.pubkey);
        if (!nsec) throw new Error("nsec not found in secure storage");
        const privkey = nip19.decode(nsec).data as Uint8Array;
        this.signer = createLocalSigner(bytesToHex(privkey));
        break;
      }
      case "nip07": {
        this.signer = nip07Signer;
        break;
      }
      case "nip46": {
        if (!account.bunkerUri) throw new Error("No bunker URI for NIP-46 account");
        this.signer = await createNip46Signer(account.bunkerUri);
        break;
      }
      case "nip55": {
        const pkgName =
          account.nip55PackageName ??
          (isNative ? await getNip55PkgForAccount(account.pubkey) : null);
        if (!pkgName) throw new Error("No NIP-55 package name");
        this.signer = createNIP55Signer(pkgName, account.pubkey);
        break;
      }
    }

    this.user = buildUser(account);
  }

  /** Migrate legacy single-slot Capacitor Preferences keys to per-account keys. */
  private async migrateSecureStorage() {
    const accounts = getStoredAccounts();

    // Migrate nsec
    const legacyNsec = await getNsec();
    if (legacyNsec) {
      const nsecAccount = accounts.find((a) => a.loginMethod === "nsec");
      if (nsecAccount) {
        const already = await getNsecForAccount(nsecAccount.pubkey);
        if (!already) await saveNsecForAccount(nsecAccount.pubkey, legacyNsec);
      }
      await removeNsec();
    }

    // Migrate NIP-55 credentials
    const legacyCreds = await getNip55Credentials();
    if (legacyCreds) {
      const already = await getNip55PkgForAccount(legacyCreds.pubkey);
      if (!already) await saveNip55PkgForAccount(legacyCreds.pubkey, legacyCreds.packageName);
      await removeNip55Credentials();
    }
  }

  private notify() {
    this.onChangeCallbacks.forEach((cb) => cb());
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function toStoredUserData(user: User): StoredUserData {
  return { pubkey: user.pubkey, name: user.name, picture: user.picture, about: user.about };
}

function buildUser(account: StoredAccount): User {
  const base: User = account.userData
    ? { ...account.userData, pubkey: account.pubkey }
    : { pubkey: account.pubkey, name: ANONYMOUS_USER_NAME, picture: DEFAULT_IMAGE_URL };

  if (account.loginMethod === "guest" && account.secret) {
    base.privateKey = account.secret;
  }
  return base;
}

export const signerManager = new SignerManager();
