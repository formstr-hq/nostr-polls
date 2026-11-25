// Turns whatever a QR scanner (or a pasted code) produced into an in-app route.
//
// Profile QRs in Pollerama encode the public web URL, but people may also point
// at `nostr:` URIs, raw NIP-19 identifiers, njump/other client URLs, or a
// NIP-05 address. Keep all of that resolution in one testable place.

import { nip05, nip19 } from "nostr-tools";
import { resolveAppLink } from "./appLinks";

const NIP19_PREFIXES = [
  "npub1",
  "note1",
  "nevent1",
  "nprofile1",
  "naddr1",
] as const;

// Same shape SearchModal uses, without accepting arbitrary whitespace.
const NIP05_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function routeForNip19(raw: string): string | null {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (!NIP19_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null;

  try {
    const decoded = nip19.decode(value);
    switch (decoded.type) {
      case "npub":
      case "nprofile":
        return `/profile/${value}`;
      case "note":
        return `/note/${nip19.neventEncode({ id: decoded.data })}`;
      case "nevent":
        return `/note/${value}`;
      case "naddr":
        return decoded.data.kind === 30023
          ? `/feeds/articles/${value}`
          : `/note/${value}`;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function stripNostrPrefix(value: string): string {
  return value.startsWith("nostr:") ? value.slice("nostr:".length) : value;
}

/** Best-effort extraction of a NIP-19 identifier from a web URL path. */
function routeFromUrl(raw: string): string | null {
  const appLink = resolveAppLink(raw);
  if (appLink) return appLink.route;

  try {
    const url = new URL(raw);
    const segments = url.pathname.split("/").filter(Boolean);
    for (const segment of segments.reverse()) {
      const route = routeForNip19(segment);
      if (route) return route;
    }
  } catch {
    // not a URL
  }
  return null;
}

/**
 * Resolve a scanned/pasted value to a React Router path, or null when it is
 * not something Pollerama can open.
 */
export async function resolveScannedInput(raw: string): Promise<string | null> {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  const fromUrl = routeFromUrl(trimmed);
  if (fromUrl) return fromUrl;

  const stripped = stripNostrPrefix(trimmed);
  const fromNip19 = routeForNip19(stripped);
  if (fromNip19) return fromNip19;

  if (NIP05_REGEX.test(trimmed)) {
    try {
      const profile = await nip05.queryProfile(trimmed);
      if (profile?.pubkey) {
        return `/profile/${nip19.npubEncode(profile.pubkey)}`;
      }
    } catch {
      // fall through to "not a profile"
    }
  }

  return null;
}
