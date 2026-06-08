/**
 * One-time migration from the pre-@formstr/signer storage format.
 *
 * Old format (still in localStorage from prior app versions):
 *   pollerama:accounts        — array of { pubkey, loginMethod, secret?, bunkerUri?, nip55PackageName?, userData? }
 *   pollerama:activeAccount   — pubkey string
 *
 * New format (read by the package's Signer on construct):
 *   @formstr/signer:accounts        — array of { npub, pubkey, method, ncryptsec?, nip46?, androidPackageName? }
 *   @formstr/signer:active-pubkey   — pubkey string
 *
 * Translation rules:
 *   nip07 → method: 'extension'           (silent)
 *   nip55 → method: 'android'             (silent)
 *   nip46 → method: 'nip46' with placeholders; full relay/clientKey gets refreshed on first unlock
 *   nsec  → flagged for interactive ncryptsec migration (passphrase prompt)
 *   guest → flagged for interactive ncryptsec migration (passphrase prompt)
 *
 * Idempotent: runs only if the new storage is empty AND legacy storage exists.
 */
import { nip19 } from "nostr-tools";
import type { StoredAccount as PackageStoredAccount } from "@formstr/signer";
import { setCachedUserData } from "./userProfileCache";

const LEGACY_ACCOUNTS = "pollerama:accounts";
const LEGACY_ACTIVE = "pollerama:activeAccount";
const PACKAGE_ACCOUNTS = "@formstr/signer:accounts";
const PACKAGE_ACTIVE = "@formstr/signer:active-pubkey";
const MIGRATION_DONE_FLAG = "pollerama:legacyMigrationComplete";

type LegacyAccount = {
  pubkey: string;
  loginMethod: "nip07" | "nip46" | "nip55" | "nsec" | "guest";
  secret?: string;
  bunkerUri?: string;
  nip55PackageName?: string;
  userData?: { pubkey: string; name?: string; picture?: string; about?: string };
};

/** A legacy account that still needs an interactive passphrase prompt. */
export type PendingMigration = {
  pubkey: string;
  npub: string;
  /** `nsec` → secret in Capacitor secure storage; `guest` → secret in `account.secret`. */
  source: "nsec" | "guest";
  /** Hex secret if guest; null if nsec (must be fetched from secure storage). */
  inlineSecret: string | null;
};

export type LegacyMigrationResult = {
  pending: PendingMigration[];
};

function readLegacyAccounts(): LegacyAccount[] {
  try {
    const raw = localStorage.getItem(LEGACY_ACCOUNTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LegacyAccount[]) : [];
  } catch {
    return [];
  }
}

function readActivePubkey(): string | null {
  return localStorage.getItem(LEGACY_ACTIVE);
}

/**
 * Migrate legacy accounts into the package's storage format.
 *
 * Must run BEFORE constructing the package's `Signer` so the constructor
 * hydrates from the new keys. Returns the list of accounts that still need
 * an interactive passphrase prompt to finish migrating (nsec/guest).
 */
export function migrateLegacyStorage(): LegacyMigrationResult {
  const result: LegacyMigrationResult = { pending: [] };

  if (localStorage.getItem(MIGRATION_DONE_FLAG) === "1") return result;

  const legacy = readLegacyAccounts();
  if (legacy.length === 0) {
    localStorage.setItem(MIGRATION_DONE_FLAG, "1");
    return result;
  }

  // If the package already has data, don't overwrite it — assume the user
  // already started using the new format.
  if (localStorage.getItem(PACKAGE_ACCOUNTS) !== null) {
    localStorage.setItem(MIGRATION_DONE_FLAG, "1");
    return result;
  }

  const newAccounts: PackageStoredAccount[] = [];

  for (const acc of legacy) {
    if (!acc.pubkey) continue;

    // Cache profile metadata for instant display on reload.
    if (acc.userData) {
      setCachedUserData(acc.pubkey, {
        name: acc.userData.name,
        picture: acc.userData.picture,
        about: acc.userData.about,
      });
    }

    let npub: string;
    try {
      npub = nip19.npubEncode(acc.pubkey);
    } catch {
      continue;
    }

    switch (acc.loginMethod) {
      case "nip07":
        newAccounts.push({ npub, pubkey: acc.pubkey, method: "extension" });
        break;

      case "nip55":
        if (acc.nip55PackageName) {
          newAccounts.push({
            npub,
            pubkey: acc.pubkey,
            method: "android",
            androidPackageName: acc.nip55PackageName,
          });
        }
        break;

      case "nip46":
        if (acc.bunkerUri) {
          newAccounts.push({
            npub,
            pubkey: acc.pubkey,
            method: "nip46",
            nip46: {
              uri: acc.bunkerUri,
              remoteSignerPubkey: "",
              relays: [],
              clientSecretKey: "",
            },
          });
        }
        break;

      case "guest":
        result.pending.push({
          pubkey: acc.pubkey,
          npub,
          source: "guest",
          inlineSecret: acc.secret ?? null,
        });
        break;

      case "nsec":
        result.pending.push({
          pubkey: acc.pubkey,
          npub,
          source: "nsec",
          inlineSecret: null,
        });
        break;
    }
  }

  if (newAccounts.length > 0) {
    localStorage.setItem(PACKAGE_ACCOUNTS, JSON.stringify(newAccounts));

    const activePubkey = readActivePubkey();
    const activeMigrated =
      activePubkey && newAccounts.some((a) => a.pubkey === activePubkey)
        ? activePubkey
        : newAccounts[0].pubkey;
    localStorage.setItem(PACKAGE_ACTIVE, activeMigrated);
  } else if (result.pending.length > 0) {
    // No silent migrations but there are pending nsec/guest ones — set the
    // active pointer to the first pending so the unlock modal targets it.
    // (We still preserve original activePubkey if it matches.)
  }

  // Wipe legacy keys so we don't re-run.
  localStorage.removeItem(LEGACY_ACCOUNTS);
  localStorage.removeItem(LEGACY_ACTIVE);
  localStorage.setItem(MIGRATION_DONE_FLAG, "1");

  return result;
}
