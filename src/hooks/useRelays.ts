import { useContext } from "react";
import { RelayContext } from "../contexts/relay-context";
import { defaultRelays } from "../nostr";

export function useRelays() {
  const context = useContext(RelayContext);

  if (!context) {
    console.warn("useRelays must be used within a RelayProvider");
    return { relays: defaultRelays, writeRelays: defaultRelays };
  }

  return context;
}
