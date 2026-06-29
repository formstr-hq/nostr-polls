import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Event } from "nostr-tools";
import { nip57 } from "nostr-tools";
import { useRelays } from "../hooks/useRelays";
import { dataLayer } from "@formstr/local-relay";

export interface ZapInfo {
  event: Event;
  senderPubkey: string;
  sats: number;
  comment: string;
}

interface ZapContextType {
  registerEventId: (id: string) => void;
  getZapInfos: (eventId: string) => ZapInfo[];
  getTotalSats: (eventId: string) => number;
  addZapEvent: (event: Event) => void;
}

export const ZapContext = createContext<ZapContextType>({
  registerEventId: () => {},
  getZapInfos: () => [],
  getTotalSats: () => 0,
  addZapEvent: () => {},
});

export function useZaps() {
  return useContext(ZapContext);
}

function parseZapInfo(event: Event): ZapInfo {
  let sats = 0;
  const bolt11 = event.tags.find((t) => t[0] === "bolt11")?.[1];
  if (bolt11) {
    try { sats = nip57.getSatoshisAmountFromBolt11(bolt11) ?? 0; } catch {}
  }

  let senderPubkey = event.tags.find((t) => t[0] === "P")?.[1] ?? event.pubkey;
  let comment = "";
  const description = event.tags.find((t) => t[0] === "description")?.[1];
  if (description) {
    try {
      const req = JSON.parse(description) as Event;
      if (req.pubkey) senderPubkey = req.pubkey;
      if (req.content) comment = req.content;
    } catch {}
  }

  return { event, senderPubkey, sats, comment };
}

export const ZapProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // eventId -> ZapInfo[]
  const [zapsMap, setZapsMap] = useState<Map<string, ZapInfo[]>>(new Map());
  const trackedIdsRef = useRef<Set<string>>(new Set());
  const lastTrackedIds = useRef<string[]>([]);
  const subscriptionRef = useRef<ReturnType<typeof dataLayer.observe> | null>(null);
  const { relays } = useRelays();

  const addZapEvent = useCallback((event: Event) => {
    const eTag = event.tags.find((t) => t[0] === "e")?.[1];
    if (!eTag) return;
    const info = parseZapInfo(event);
    setZapsMap((prev) => {
      const existing = prev.get(eTag) ?? [];
      if (existing.some((z) => z.event.id === event.id)) return prev;
      const next = new Map(prev);
      next.set(eTag, [...existing, info]);
      return next;
    });
  }, []);

  const registerEventId = useCallback((id: string) => {
    trackedIdsRef.current.add(id);
  }, []);

  const getZapInfos = useCallback((eventId: string): ZapInfo[] => {
    return zapsMap.get(eventId) ?? [];
  }, [zapsMap]);

  const getTotalSats = useCallback((eventId: string): number => {
    return (zapsMap.get(eventId) ?? []).reduce((sum, z) => sum + z.sats, 0);
  }, [zapsMap]);

  useEffect(() => {
    const interval = setInterval(() => {
      const ids = Array.from(trackedIdsRef.current);
      const hasChanged =
        ids.length !== lastTrackedIds.current.length ||
        ids.some((id, i) => id !== lastTrackedIds.current[i]);
      if (!hasChanged) return;

      lastTrackedIds.current = [...ids];
      subscriptionRef.current?.unobserve();
      if (ids.length === 0) return;

      subscriptionRef.current = dataLayer.observe(
        [{ kinds: [9735], "#e": ids }],
        { onEvent: addZapEvent }
      );
    }, 3000);

    return () => {
      clearInterval(interval);
      subscriptionRef.current?.unobserve();
    };
  }, [relays, addZapEvent]);

  return (
    <ZapContext.Provider value={{ registerEventId, getZapInfos, getTotalSats, addZapEvent }}>
      {children}
    </ZapContext.Provider>
  );
};
