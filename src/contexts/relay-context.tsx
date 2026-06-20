import { createContext, ReactNode } from "react";
import { defaultRelays } from "../nostr";

/**
 * Relay context is now display-only. The worker (local relay) owns every
 * connection decision — including reading the user's NIP-65 relay list and the
 * gossip/outbox routing — so the app no longer fetches or selects relays. These
 * default URLs are kept purely so legacy UI that shows a relay list/count keeps
 * rendering; they are never used to drive the network (the dataLayer contract
 * has no relay-target arguments).
 */
interface RelayContextInterface {
  relays: string[];
  writeRelays: string[];
}

export const RelayContext = createContext<RelayContextInterface>({
  relays: defaultRelays,
  writeRelays: defaultRelays,
});

export function RelayProvider({ children }: { children: ReactNode }) {
  return (
    <RelayContext.Provider
      value={{ relays: defaultRelays, writeRelays: defaultRelays }}
    >
      {children}
    </RelayContext.Provider>
  );
}
