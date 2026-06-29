import React, { createContext, useContext, useRef, useState, useEffect } from "react";
import { Event, Filter } from "nostr-tools";
import { collectOnce } from "../dataLayer/collect";

type EntityType = "movie" | "hashtag";

interface MetadataContextValue {
  metadata: Map<string, Event[]>;
  registerEntity: (type: EntityType, id: string) => void;
}

const MetadataContext = createContext<MetadataContextValue | null>(null);

export const MetadataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [metadata, setMetadata] = useState<Map<string, Event[]>>(new Map());
  const pending = useRef<Set<string>>(new Set());
  const entityMap = useRef<Map<string, string>>(new Map()); // dTag => id

  const loaded = useRef<Set<string>>(new Set());
  // Queue flushing effect
  useEffect(() => {
    const interval = setInterval(() => {
      if (pending.current.size === 0) return;

      const tags = Array.from(pending.current);
      pending.current.clear();

      const filter: Filter = {
        kinds: [30300],
        "#d": tags,
      };

      collectOnce([filter]).then((events: Event[]) => {
        const grouped = new Map<string, Event[]>();

        for (const event of events) {
          const dTag = event.tags.find(([k]) => k === "d")?.[1];
          if (!dTag) continue;

          const id = entityMap.current.get(dTag);
          if (!id) continue;

          if (!grouped.has(id)) grouped.set(id, []);
          grouped.get(id)!.push(event);
        }

        setMetadata((prev) => {
          const next = new Map(prev);

          for (const [id, evs] of Array.from(grouped.entries())) {
            next.set(id, evs);
          }

          return next;
        });

        // mark completed only after successful response
        for (const tag of tags) {
          loaded.current.add(tag);
        }
      });
    }, 2000); // Debounce interval

    return () => clearInterval(interval);
  }, []);

  const registerEntity = (type: EntityType, id: string) => {
    const dTag = `${type}:${id}`;
    if (loaded.current.has(dTag) || pending.current.has(dTag)) return;

    pending.current.add(dTag);
    entityMap.current.set(dTag, id);
  };

  return (
    <MetadataContext.Provider value={{ metadata, registerEntity }}>
      {children}
    </MetadataContext.Provider>
  );
};

export const useMetadata = () => {
  const ctx = useContext(MetadataContext);
  if (!ctx) throw new Error("useMetadata must be used within MetadataProvider");
  return ctx;
};
