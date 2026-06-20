/**
 * Per-event relay provenance ("which relays did this event come from") used to
 * be tracked in the app's EventRelayMap. The worker (local relay) now owns every
 * connection and that attribution is not exposed across the dataLayer contract,
 * so this returns an empty list. It is kept as a stable seam so the "found on N
 * relays" UI keeps compiling; a worker affordance can repopulate it later
 * (out of scope for the local-relay cutover).
 */
export function useEventRelays(_eventId: string): string[] {
  return [];
}
