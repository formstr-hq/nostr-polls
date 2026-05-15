import { Event, nip19 } from "nostr-tools";

// NIP-82 (PR #1336) — Software Applications
export const APP_KIND = 32267;
export const RELEASE_KIND = 30063;
export const ASSET_KIND = 3063;

// Pollerama on zapstore
export const APP_ID = "com.formstr.pollerama";
export const PUBLISHER_NPUB =
  "npub1qu7dsd44275lms4x9snnwvnnmgx926nsppmr7lcw9dlj36n4fltqgs7p98";

let cachedHex: string | null = null;
export function getPublisherHex(): string {
  if (cachedHex) return cachedHex;
  const decoded = nip19.decode(PUBLISHER_NPUB);
  if (decoded.type !== "npub") throw new Error("Invalid publisher npub");
  cachedHex = decoded.data as string;
  return cachedHex;
}

export const ANDROID_APK_MIME = "application/vnd.android.package-archive";

// Android ABIs in preference order; arm64-v8a covers ~all modern devices.
const ABI_PREFERENCE = [
  "android-arm64-v8a",
  "android-armeabi-v7a",
  "android-x86_64",
  "android-x86",
];

export type ReleaseInfo = {
  version: string;
  releaseNotes: string;
  channel: string;
  createdAt: number;
  assetIds: string[];
  releaseEvent: Event;
};

export function parseRelease(event: Event): ReleaseInfo | null {
  if (event.kind !== RELEASE_KIND) return null;
  const version = event.tags.find((t) => t[0] === "version")?.[1];
  if (!version) return null;
  const channel = event.tags.find((t) => t[0] === "c")?.[1] ?? "main";
  const assetIds = event.tags.filter((t) => t[0] === "e").map((t) => t[1]);
  return {
    version,
    releaseNotes: event.content || "",
    channel,
    createdAt: event.created_at,
    assetIds,
    releaseEvent: event,
  };
}

export type AndroidAsset = {
  url?: string;
  sha256: string;
  sizeBytes?: number;
  version: string;
  versionCode?: number;
  minAllowedVersionCode?: number;
  platform?: string;
  assetEvent: Event;
};

export function parseAndroidAsset(event: Event): AndroidAsset | null {
  if (event.kind !== ASSET_KIND) return null;
  const mime = event.tags.find((t) => t[0] === "m")?.[1];
  if (mime !== ANDROID_APK_MIME) return null;
  const sha256 = event.tags.find((t) => t[0] === "x")?.[1];
  const version = event.tags.find((t) => t[0] === "version")?.[1];
  if (!sha256 || !version) return null;
  const sizeRaw = event.tags.find((t) => t[0] === "size")?.[1];
  const versionCodeRaw = event.tags.find((t) => t[0] === "version_code")?.[1];
  const minRaw = event.tags.find((t) => t[0] === "min_allowed_version_code")?.[1];
  return {
    url: event.tags.find((t) => t[0] === "url")?.[1],
    sha256,
    sizeBytes: sizeRaw ? Number(sizeRaw) : undefined,
    version,
    versionCode: versionCodeRaw ? Number(versionCodeRaw) : undefined,
    minAllowedVersionCode: minRaw ? Number(minRaw) : undefined,
    platform: event.tags.find((t) => t[0] === "f")?.[1],
    assetEvent: event,
  };
}

/**
 * Pick the best APK asset for an Android device. Prefers arm64-v8a; falls back
 * to assets without a platform tag (universal APKs).
 */
export function selectAndroidAsset(assets: AndroidAsset[]): AndroidAsset | null {
  if (!assets.length) return null;
  for (const abi of ABI_PREFERENCE) {
    const match = assets.find((a) => a.platform === abi);
    if (match) return match;
  }
  const universal = assets.find((a) => !a.platform);
  return universal ?? assets[0];
}

/**
 * NIP-82 Appendix D version comparison. Splits on `.`, `-`, `_`; numeric
 * segments sort before alphanumeric; missing segments sort earlier.
 * Returns negative if a<b, positive if a>b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const aParts = a.split(/[.\-_]/);
  const bParts = b.split(/[.\-_]/);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ap = aParts[i];
    const bp = bParts[i];
    if (ap === undefined) return -1;
    if (bp === undefined) return 1;
    const aNum = /^\d+$/.test(ap);
    const bNum = /^\d+$/.test(bp);
    if (aNum && bNum) {
      const diff = Number(ap) - Number(bp);
      if (diff !== 0) return diff;
    } else if (aNum && !bNum) {
      return -1;
    } else if (!aNum && bNum) {
      return 1;
    } else {
      const diff = ap.localeCompare(bp);
      if (diff !== 0) return diff;
    }
  }
  return 0;
}
