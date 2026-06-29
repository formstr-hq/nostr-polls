import { dataLayer } from "@formstr/local-relay";

/**
 * Best-effort relay hints for a note being shared (e.g. into a DM), so the
 * recipient can resolve it from relays they aren't subscribed to. Reads the
 * author's cached NIP-65 relay list (kind 10002) from the worker store and
 * returns up to `limit` of their write relays.
 *
 * Cache-only (no network) — returns [] when the author's relay list isn't
 * cached, in which case the share just carries no hint (still valid, just less
 * resolvable). The recipient feeds any hints into the worker's gossip pool when
 * rendering the reference (see PrepareNote).
 */
export async function authorWriteRelayHints(
  pubkey: string,
  limit = 2
): Promise<string[]> {
  try {
    const relayList = await dataLayer.fetchReplaceable(10002, pubkey);
    if (!relayList) return [];
    // NIP-65 `r` tags: no marker = read+write; "write" marker = write-only.
    const writes = relayList.tags
      .filter((t) => t[0] === "r" && t[1] && (!t[2] || t[2] === "write"))
      .map((t) => t[1]);
    return writes.slice(0, limit);
  } catch {
    return [];
  }
}
