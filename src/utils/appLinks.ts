// App Links / deep links → in-app routes.
//
// Android delivers two kinds of URLs through Capacitor's `appUrlOpen` /
// `getLaunchUrl`:
//
//   1. Verified https App Links (https://pollerama.fun/note/<id>, …). Android
//      opens the app directly once /.well-known/assetlinks.json matches the
//      signing certificate; the web layer then only has to show the path.
//   2. The `nostr-polls://app/...` links used by background notifications,
//      some of which carry a hex event id instead of a nevent.
//
// Everything below is pure so it can be unit-tested without Capacitor.

import { nip19 } from "nostr-tools";
import { routeForNostrUri } from "./nostrUri";

/** Hosts declared with `android:autoVerify` in AndroidManifest.xml. */
export const APP_LINK_HOSTS = ["pollerama.fun", "www.pollerama.fun"] as const;

/** Custom schemes handled by the notification worker (legacy + package id). */
export const APP_LINK_SCHEMES = ["nostr-polls:", "com.formstr.pollerama:"] as const;

export interface ResolvedAppLink {
  /** Path (plus query/hash) to hand to React Router. */
  route: string;
  /** Hex pubkey from `?acct=`, a hint to switch profiles before routing. */
  account?: string;
  /** True when the URL came in as an https App Link rather than a custom scheme. */
  https: boolean;
}

const HOSTS = new Set<string>(APP_LINK_HOSTS);
const SCHEMES = new Set<string>(APP_LINK_SCHEMES);

function encodeNevent(hex: string): string | undefined {
  try {
    return nip19.neventEncode({ id: hex });
  } catch {
    return undefined;
  }
}

/**
 * Map a URL delivered by the OS to an in-app route.
 *
 * Returns null for URLs this app should ignore (other sites, other schemes).
 * The `acct` query parameter is consumed here so it never leaks into routes.
 */
export function resolveAppLink(rawUrl: string): ResolvedAppLink | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const protocol = url.protocol.toLowerCase();

  // NIP-21: nostr:npub… (and the nostr:// form some clients emit).
  if (protocol === "nostr:") {
    const route = routeForNostrUri(rawUrl);
    return route ? { route, https: false } : null;
  }

  const isHttp = protocol === "https:" || protocol === "http:";
  const isHttps = isHttp && HOSTS.has(url.hostname.toLowerCase());
  const isCustom = !isHttp && SCHEMES.has(protocol);
  if (!isHttps && !isCustom) return null;

  const account = url.searchParams.get("acct") || undefined;
  const params = new URLSearchParams(url.search);
  params.delete("acct");
  const query = params.toString();
  const suffix = `${query ? `?${query}` : ""}${url.hash}`;

  if (isHttps) {
    // A verified App Link is a normal web route: /note/…, /profile/…,
    // /feeds/articles/…, /result/…, /p/…, etc.
    return {
      route: `${url.pathname || "/"}${suffix}`,
      account,
      https: true,
    };
  }

  // Custom scheme: nostr-polls://app/...
  let path = url.pathname || "/";
  if (path === "/app" || path === "/app/") {
    path = "/";
  } else if (path.startsWith("/app/")) {
    path = path.slice("/app".length);
  }

  const hexMatch = path.match(/^\/(note|respond)-hex\/([^/]+)\/?$/);
  if (hexMatch) {
    const nevent = encodeNevent(hexMatch[2]);
    if (!nevent) {
      return { route: "/notifications", account, https: false };
    }
    return {
      route: `/${hexMatch[1]}/${nevent}${suffix}`,
      account,
      https: false,
    };
  }

  return { route: `${path}${suffix}`, account, https: false };
}
