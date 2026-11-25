// NIP-19 / NIP-21 helpers shared by OS deep links and the QR scanner.
//
// NIP-21 defines `nostr:<bech32>` links. Some clients also produce
// `nostr://<bech32>`, so accept both forms.

import { nip19 } from "nostr-tools";

const NIP19_PREFIXES = [
  "npub1",
  "note1",
  "nevent1",
  "nprofile1",
  "naddr1",
] as const;

/** Map a raw NIP-19 identifier to the route that shows it. */
export function routeForNip19(raw: string): string | null {
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

/** The bech32 payload of a `nostr:` / `nostr://` URI, or null. */
export function nostrUriValue(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!/^nostr:/i.test(trimmed)) return null;
  const value = trimmed.slice("nostr:".length).replace(/^\/+/, "").trim();
  return value || null;
}

/** NIP-21 URI → in-app route. */
export function routeForNostrUri(raw: string): string | null {
  const value = nostrUriValue(raw);
  return value ? routeForNip19(value) : null;
}
