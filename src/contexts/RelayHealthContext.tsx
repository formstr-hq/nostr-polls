import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { dataLayer } from "@formstr/local-relay";

interface RelayHealthState {
  connected: number; // relays currently connected
  total: number; // relays the worker knows about
  /** Kept for API compatibility; gossip routing is now internal to the worker. */
  gossipConnected: number;
  gossipTotal: number;
  /** Foreground recovery — asks the worker to re-establish connections. */
  reconnect: () => void;
}

const RelayHealthContext = createContext<RelayHealthState>({
  connected: 0,
  total: 0,
  gossipConnected: 0,
  gossipTotal: 0,
  reconnect: () => {},
});

export const useRelayHealth = () => useContext(RelayHealthContext);

/**
 * Read-only view of the worker's relay health. The app cannot open or close
 * connections; it only reports what `dataLayer.relayHealth()` says and nudges
 * `dataLayer.resume()` on foreground.
 */
export const RelayHealthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [health, setHealth] = useState<{ connected: number; total: number }>({
    connected: 0,
    total: 0,
  });

  const refresh = React.useCallback(async () => {
    try {
      const relays = await dataLayer.relayHealth();
      setHealth({
        connected: relays.filter((r) => r.connected).length,
        total: relays.length,
      });
    } catch {
      // worker not ready yet — leave the last snapshot in place
    }
  }, []);

  const reconnect = React.useCallback(() => {
    dataLayer.resume();
    setTimeout(refresh, 500);
  }, [refresh]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") reconnect();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reconnect]);

  return (
    <RelayHealthContext.Provider
      value={{ ...health, gossipConnected: 0, gossipTotal: 0, reconnect }}
    >
      {children}
    </RelayHealthContext.Provider>
  );
};
