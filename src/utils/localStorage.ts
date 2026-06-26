import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { generateSecretKey } from "nostr-tools";
import { User } from "../contexts/user-context";
import { USER_DATA_TTL_HOURS } from "./constants";

// A write that must never break the UI. localStorage has a hard ~5MB per-origin
// quota (Firefox is the strictest); once it's full, setItem throws
// QuotaExceededError. Persisting a UI preference (e.g. the active feed tab) is
// best-effort — if it fails, the in-memory state still updates, so swallow the
// error rather than letting it kill the click handler. Returns whether it stuck.
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

const LOCAL_STORAGE_KEYS = "pollerama:keys";
const LOCAL_BUNKER_URI = "pollerama:bunkerUri";
const LOCAL_APP_SECRET_KEY = "bunker:clientSecretKey";
const LOCAL_USER_DATA = "pollerama:userData";

// ---------------------------------------------------------------------------
// Multi-account storage
// ---------------------------------------------------------------------------
const LOCAL_ACCOUNTS = "pollerama:accounts";
const LOCAL_ACTIVE_ACCOUNT = "pollerama:activeAccount";

export type LoginMethod = "nip07" | "nip46" | "nip55" | "nsec" | "guest";

export type StoredUserData = {
  pubkey: string;
  name?: string;
  picture?: string;
  about?: string;
};

export type StoredAccount = {
  pubkey: string;
  loginMethod: LoginMethod;
  /** Hex private key — guest/local accounts only */
  secret?: string;
  /** NIP-46 bunker URI */
  bunkerUri?: string;
  /** NIP-55 Android signer package name */
  nip55PackageName?: string;
  /** Cached profile data for instant display */
  userData?: StoredUserData;
};

export const getStoredAccounts = (): StoredAccount[] => {
  try {
    const raw = localStorage.getItem(LOCAL_ACCOUNTS);
    if (!raw) return [];
    return JSON.parse(raw) as StoredAccount[];
  } catch {
    return [];
  }
};

export const setStoredAccounts = (accounts: StoredAccount[]) => {
  localStorage.setItem(LOCAL_ACCOUNTS, JSON.stringify(accounts));
};

export const addOrUpdateStoredAccount = (account: StoredAccount) => {
  const accounts = getStoredAccounts();
  const idx = accounts.findIndex((a) => a.pubkey === account.pubkey);
  if (idx >= 0) accounts[idx] = account;
  else accounts.push(account);
  setStoredAccounts(accounts);
};

export const removeStoredAccount = (pubkey: string) => {
  setStoredAccounts(getStoredAccounts().filter((a) => a.pubkey !== pubkey));
};

export const getActiveAccountPubkey = (): string | null =>
  localStorage.getItem(LOCAL_ACTIVE_ACCOUNT);

export const setActiveAccountPubkey = (pubkey: string) =>
  localStorage.setItem(LOCAL_ACTIVE_ACCOUNT, pubkey);

export const removeActiveAccountPubkey = () =>
  localStorage.removeItem(LOCAL_ACTIVE_ACCOUNT);

/**
 * One-time migration from the old single-account storage format to the new
 * multi-account format. Safe to call repeatedly — no-ops if already migrated.
 */
export const migrateToMultiAccount = () => {
  if (localStorage.getItem(LOCAL_ACCOUNTS) !== null) return;

  const oldKeys = JSON.parse(
    localStorage.getItem(LOCAL_STORAGE_KEYS) || "{}"
  ) as { pubkey?: string; secret?: string };
  const oldBunkerUri = JSON.parse(
    localStorage.getItem(LOCAL_BUNKER_URI) || "{}"
  ) as { bunkerUri?: string };
  let oldUser: User | null = null;
  const oldUserDataRaw = localStorage.getItem(LOCAL_USER_DATA);
  if (oldUserDataRaw) {
    try {
      const parsed = JSON.parse(oldUserDataRaw) as { user: User; expiresAt: number };
      if (Date.now() <= parsed.expiresAt) oldUser = parsed.user;
    } catch {}
  }

  if (!oldKeys.pubkey) {
    setStoredAccounts([]);
    return;
  }

  const loginMethod: LoginMethod = oldBunkerUri.bunkerUri
    ? "nip46"
    : oldKeys.secret
    ? "guest"
    : "nip07";

  const account: StoredAccount = {
    pubkey: oldKeys.pubkey,
    loginMethod,
    secret: oldKeys.secret,
    bunkerUri: oldBunkerUri.bunkerUri,
    userData: oldUser
      ? { pubkey: oldUser.pubkey, name: oldUser.name, picture: oldUser.picture, about: oldUser.about }
      : { pubkey: oldKeys.pubkey },
  };

  setStoredAccounts([account]);
  setActiveAccountPubkey(oldKeys.pubkey);
};

type Keys = { pubkey: string; secret?: string };
type BunkerUri = { bunkerUri: string };

export const getKeysFromLocalStorage = () => {
  return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEYS) || "{}") as Keys;
};

export const getBunkerUriInLocalStorage = () => {
  return JSON.parse(
    localStorage.getItem(LOCAL_BUNKER_URI) || "{}"
  ) as BunkerUri;
};

export const getAppSecretKeyFromLocalStorage = () => {
  const hexSecretKey = localStorage.getItem(LOCAL_APP_SECRET_KEY);
  if (!hexSecretKey) {
    const newSecret = generateSecretKey();
    localStorage.setItem(LOCAL_APP_SECRET_KEY, bytesToHex(newSecret));
    return newSecret;
  }
  return hexToBytes(hexSecretKey);
};

export const setAppSecretInLocalStorage = (secret: Uint8Array) => {
  localStorage.setItem(LOCAL_STORAGE_KEYS, bytesToHex(secret));
};

export const setKeysInLocalStorage = (pubkey: string, secret?: string) => {
  localStorage.setItem(LOCAL_STORAGE_KEYS, JSON.stringify({ pubkey, secret }));
};

export const setBunkerUriInLocalStorage = (bunkerUri: string) => {
  localStorage.setItem(LOCAL_BUNKER_URI, JSON.stringify({ bunkerUri }));
};

export const removeKeysFromLocalStorage = () => {
  localStorage.removeItem(LOCAL_STORAGE_KEYS);
};

export const removeBunkerUriFromLocalStorage = () => {
  localStorage.removeItem(LOCAL_BUNKER_URI);
};

export const removeAppSecretFromLocalStorage = () => {
  localStorage.removeItem(LOCAL_APP_SECRET_KEY);
};

type UserData = {
  user: User;
  expiresAt: number;
};

export const setUserDataInLocalStorage = (
  user: User,
  ttlInHours = USER_DATA_TTL_HOURS
) => {
  const now = new Date();
  const expiresAt = now.setHours(now.getHours() + ttlInHours);

  const userData: UserData = {
    user,
    expiresAt,
  };

  localStorage.setItem(LOCAL_USER_DATA, JSON.stringify(userData));
};

export const getUserDataFromLocalStorage = (): { user: User } | null => {
  const data = localStorage.getItem(LOCAL_USER_DATA);
  if (!data) return null;

  try {
    const { user, expiresAt } = JSON.parse(data) as UserData;
    const isExpired = Date.now() > expiresAt;

    // Remove expired data
    if (isExpired) {
      localStorage.removeItem(LOCAL_USER_DATA);
      return null;
    }

    return { user };
  } catch (error) {
    console.error("Failed to parse user data from localStorage", error);
    return null;
  }
};

const MODERATOR_PREF_KEY = (tag: string) => `moderatorPrefs:${tag}`;

export const loadModeratorPrefs = (
  tag: string,
  allModerators: string[]
): string[] => {
  const json = localStorage.getItem(MODERATOR_PREF_KEY(tag));
  if (!json) return allModerators;
  try {
    const saved = JSON.parse(json);
    if (Array.isArray(saved)) return saved;
  } catch {}
  return allModerators;
};

export const saveModeratorPrefs = (tag: string, selected: string[]) => {
  localStorage.setItem(MODERATOR_PREF_KEY(tag), JSON.stringify(selected));
};

export const removeUserDataFromLocalStorage = () => {
  localStorage.removeItem(LOCAL_USER_DATA);
};

// ---------------------------------------------------------------------------
// Contact profile cache
// Persists kind:0 events for follows / web-of-trust so they render instantly
// on next load without a network round-trip.
// ---------------------------------------------------------------------------
const PROFILE_CACHE_KEY = "pollerama:profile_cache";

type CachedProfileEvent = {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  id: string;
  sig: string;
  tags: string[][];
};

type ProfileCache = Record<string, CachedProfileEvent>;

export const getCachedProfiles = (): CachedProfileEvent[] => {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return [];
    return Object.values(JSON.parse(raw) as ProfileCache);
  } catch {
    return [];
  }
};

/** Persist a kind:0 event. Only writes if it is newer than what's stored. */
export const setCachedProfile = (event: CachedProfileEvent): void => {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    const cache: ProfileCache = raw ? JSON.parse(raw) : {};
    const existing = cache[event.pubkey];
    if (!existing || event.created_at > existing.created_at) {
      cache[event.pubkey] = event;
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(cache));
    }
  } catch {
    // Silently ignore quota / parse errors
  }
};
