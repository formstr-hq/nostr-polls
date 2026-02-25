import { nip07Signer } from "./NIP07Signer";
import { createNip46Signer } from "./BunkerSigner";
import { NostrSigner } from "./types";
import { Event, EventTemplate, nip19 } from "nostr-tools";
import { defaultRelays, fetchUserProfile } from "../../nostr";
import { publishInboxRelays } from "../../nostr/nip17";
import {
  getBunkerUriInLocalStorage,
  getKeysFromLocalStorage,
  setBunkerUriInLocalStorage,
  setKeysInLocalStorage,
  setUserDataInLocalStorage,
  getUserDataFromLocalStorage,
  removeUserDataFromLocalStorage,
  removeKeysFromLocalStorage,
  removeBunkerUriFromLocalStorage,
  removeAppSecretFromLocalStorage,
} from "../../utils/localStorage";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { ANONYMOUS_USER_NAME, User } from "../../contexts/user-context";
import { pool } from "..";
import { createLocalSigner } from "./LocalSigner";
import { isNative } from "../../utils/platform";
import { getNsec, removeNsec, saveNsec, getNip55Credentials, saveNip55Credentials, removeNip55Credentials } from "../../utils/secureKeyStorage";
import { bytesToHex } from "@noble/hashes/utils";
import { createNIP55Signer } from "./NIP55Signer";

class SignerManager {
  private signer: NostrSigner | null = null;
  private user: User | null = null;
  private onChangeCallbacks: Set<() => void> = new Set();
  private loginModalCallback: (() => Promise<void>) | null = null;
  private pendingSignPromises: Map<string, (event: Event) => void> = new Map();
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.restoreFromStorage().finally(() => {
      this.initPromise = null;
    });
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

    // Here you should publish the event to Nostr relays
    // Example: await relayPool.publish(kind0Event);
    // Or call your existing function to publish events

    // TODO: Replace with your actual event publish method
  }

  async loginWithNip55(packageName: string, cachedPubkey?: string) {
    const signer = createNIP55Signer(packageName, cachedPubkey);

    // Step 1: ask Amber for pubkey (skipped if cachedPubkey provided)
    const pubkey = await signer.getPublicKey();

    // Step 2: fetch kind0 profile
    const kind0 = await fetchUserProfile(pubkey);
    const userData = kind0
      ? { ...JSON.parse(kind0.content), pubkey }
      : { pubkey, name: ANONYMOUS_USER_NAME, picture: DEFAULT_IMAGE_URL };

    // Step 3: save signer and user
    this.signer = signer;
    this.user = userData;
    await saveNip55Credentials(packageName, pubkey);

    setUserDataInLocalStorage(userData);
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
    const cachedUser = getUserDataFromLocalStorage();
    if (cachedUser) this.user = cachedUser.user;

    try {
      if (isNative) {
        const nsec = await getNsec();
        if (nsec) {
          await this.loginWithNsec(nsec);
          return;
        }
      }

      const bunkerUri = getBunkerUriInLocalStorage();
      const keys = getKeysFromLocalStorage();
      const nip55Creds = await getNip55Credentials();
      if (nip55Creds) {
        // Use cached pubkey to avoid prompting Amber again
        console.log("Restoring NIP-55 session with cached pubkey:", nip55Creds.pubkey);
        await this.loginWithNip55(nip55Creds.packageName, nip55Creds.pubkey);
        return;
      } else if (bunkerUri?.bunkerUri) {
        await this.loginWithNip46(bunkerUri.bunkerUri);
      } else if (!isNative && window.nostr) {
        await this.loginWithNip07();
      } else if (keys?.pubkey && keys?.secret) {
        await this.loginWithGuestKey(keys.pubkey, keys.secret);
      }
    } catch (e) {
      console.error("Signer restore failed:", e);
      // If NIP-55 restore failed, clear credentials so user can re-login properly
      console.log("Clearing NIP-55 credentials after restore failure");
      await removeNip55Credentials();
    }

    this.notify();
  }

  private async loginWithGuestKey(pubkey: string, privkey: string) {
    this.signer = createLocalSigner(privkey);

    const kind0: Event | null = await fetchUserProfile(pubkey);
    const userData: User = kind0
      ? { ...JSON.parse(kind0.content), pubkey, privateKey: privkey }
      : {
          pubkey,
          name: ANONYMOUS_USER_NAME,
          picture: DEFAULT_IMAGE_URL,
          privateKey: privkey,
        };

    setUserDataInLocalStorage(userData);
    this.user = userData;
  }

  async loginWithNsec(nsec: string) {
    if (!isNative) throw new Error("NSEC login only allowed on native");

    const privkey = nip19.decode(nsec).data as Uint8Array;
    if (!privkey) throw new Error("Invalid nsec");

    this.signer = createLocalSigner(bytesToHex(privkey));

    const pubkey = await this.signer.getPublicKey();

    const kind0 = await fetchUserProfile(pubkey);
    const userData: User = kind0
      ? { ...JSON.parse(kind0.content), pubkey }
      : { pubkey, name: ANONYMOUS_USER_NAME, picture: DEFAULT_IMAGE_URL };

    await saveNsec(nsec);
    setUserDataInLocalStorage(userData);

    this.user = userData;
    this.notify();
  }

  async createGuestAccount(
    privkey: string,
    userMetadata: { name?: string; picture?: string; about?: string },
  ) {
    this.signer = createLocalSigner(privkey);

    const pubkey = await this.signer.getPublicKey();

    // Build user object
    const userData: User = {
      pubkey,
      name: userMetadata.name || "Guest",
      picture: userMetadata.picture || DEFAULT_IMAGE_URL,
      about: userMetadata.about || "",
      privateKey: privkey,
    };

    // Save keys and user data
    setKeysInLocalStorage(pubkey, privkey);
    setUserDataInLocalStorage(userData);

    this.user = userData;

    // Optionally, send kind-0 event to publish metadata on Nostr network
    await this.publishKind0(userData);

    // Publish DM inbox relays (kind:10050) for NIP-17 compliance
    await publishInboxRelays(defaultRelays);

    this.notify();
  }

  async loginWithNip07() {
    if (!window.nostr) throw new Error("NIP-07 extension not found");
    this.signer = nip07Signer;
    const pubkey = await window.nostr.getPublicKey();
    setKeysInLocalStorage(pubkey);

    const kind0: Event | null = await fetchUserProfile(pubkey);
    const userData: User = kind0
      ? { ...JSON.parse(kind0.content), pubkey }
      : { pubkey, name: ANONYMOUS_USER_NAME, picture: DEFAULT_IMAGE_URL };

    this.user = userData;
    setUserDataInLocalStorage(userData);
    this.notify();
  }

  async loginWithNip46(bunkerUri: string) {
    const remoteSigner = await createNip46Signer(bunkerUri);
    const pubkey = await remoteSigner.getPublicKey();
    setKeysInLocalStorage(pubkey);

    const kind0: Event | null = await fetchUserProfile(pubkey);
    const userData: User = kind0
      ? { ...JSON.parse(kind0.content), pubkey }
      : { pubkey, name: ANONYMOUS_USER_NAME, picture: DEFAULT_IMAGE_URL };

    setUserDataInLocalStorage(userData);
    setBunkerUriInLocalStorage(bunkerUri);

    this.signer = remoteSigner;
    this.user = userData;
    this.notify();
  }
  async logout() {
    this.signer = null;
    this.user = null;

    removeNsec();
    removeKeysFromLocalStorage();
    removeBunkerUriFromLocalStorage();
    removeAppSecretFromLocalStorage();
    removeUserDataFromLocalStorage();
    await removeNip55Credentials();

    this.notify();
  }

  async getSigner(): Promise<NostrSigner> {
    if (this.signer) return this.signer;

    // Still initialising — wait for it before deciding to show the login modal
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

  private notify() {
    this.onChangeCallbacks.forEach((cb) => cb());
  }
}

export const signerManager = new SignerManager();
