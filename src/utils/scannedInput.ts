// Turns whatever a QR scanner (or a pasted code) produced into an in-app route.
//
// Profile QRs in Pollerama encode a NIP-21 `nostr:` URI (with a web-link
// fallback in the dialog), but people may also point at raw NIP-19 ids,
// njump/other client URLs, or a NIP-05 address. Keep all of that resolution in
// one testable place.

import { nip05, nip19 } from "nostr-tools";
import { resolveAppLink } from "./appLinks";
import { nostrUriValue, routeForNip19 } from "./nostrUri";

// Same shape SearchModal uses, without accepting arbitrary whitespace.
const NIP05_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // `nostr:npub…` / `nostr://nprofile…` (also handled by resolveAppLink for OS
  // deep links; repeated here for pasted values).
  const fromNostrUri = nostrUriValue(trimmed);
  if (fromNostrUri) {
    const route = routeForNip19(fromNostrUri);
    if (route) return route;
  }

  const fromNip19 = routeForNip19(trimmed);
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
