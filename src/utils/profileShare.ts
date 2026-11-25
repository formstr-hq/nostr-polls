import { nip19 } from "nostr-tools";
import { getAppBaseUrl } from "./platform";

/** Canonical web link for a profile. Scanners open this as an App Link. */
export function buildProfileUrl(pubkey: string): string {
  const base = getAppBaseUrl().replace(/\/+$/, "");
  return `${base}/profile/${nip19.npubEncode(pubkey)}`;
}

/** Portable `nostr:` URI for clients that don't open web links. */
export function buildProfileNostrUri(pubkey: string): string {
  return `nostr:${nip19.nprofileEncode({ pubkey })}`;
}
