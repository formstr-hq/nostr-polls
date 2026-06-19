import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { dataLayer } from "../dataLayer/client";

export interface HandlerApp {
  name: string;
  picture?: string;
  urlTemplate: string; // e.g. "https://habla.news/a/<naddr>" — naddr substituted by the consumer
  publishers: string[]; // pubkeys of everyone who published this handler
}

interface Nip89ContextType {
  // undefined = not yet fetched, [] = fetched but no handlers, [...] = has handlers
  handlersMap: Map<number, HandlerApp[]>;
  registerKind: (kind: number) => void;
}

const Nip89Context = createContext<Nip89ContextType>({
  handlersMap: new Map(),
  registerKind: () => {},
});

export const useNip89 = () => useContext(Nip89Context);

export const Nip89Provider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [handlersMap, setHandlersMap] = useState<Map<number, HandlerApp[]>>(
    new Map()
  );

  // Kinds already fetched or in-flight — skip re-requesting them
  const fetchedKinds = useRef<Set<number>>(new Set());
  const pendingKinds = useRef<Set<number>>(new Set());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(async () => {
    const kinds = Array.from(pendingKinds.current);
    pendingKinds.current.clear();
    if (kinds.length === 0) return;

    // Mark in-flight immediately so concurrent registerKind calls don't duplicate
    kinds.forEach((k) => fetchedKinds.current.add(k));

    // One-shot interest: the worker fetches the NIP-89 handlers and returns them.
    const events = await dataLayer.observeOnce([
      { kinds: [31990], "#k": kinds.map(String) },
    ]);

    setHandlersMap((prev) => {
      const next = new Map(prev);

      for (const event of events) {
        // Only handle web/naddr tags — skip iOS/Android-only handlers
        const webTag = event.tags.find(
          (t) => t[0] === "web" && (!t[2] || t[2] === "naddr")
        );
        if (!webTag?.[1]) continue;
        const urlTemplate = webTag[1];

        // Which of our requested kinds does this handler cover?
        const coveredKinds = event.tags
          .filter((t) => t[0] === "k")
          .map((t) => parseInt(t[1], 10))
          .filter((k) => !isNaN(k) && kinds.includes(k));
        if (coveredKinds.length === 0) continue;

        let meta: Record<string, string> = {};
        try {
          meta = JSON.parse(event.content);
        } catch {}
        const name = meta.name || meta.display_name || "Unknown App";

        for (const kind of coveredKinds) {
          const existing = next.get(kind) ?? [];
          const appIdx = existing.findIndex((a) => a.urlTemplate === urlTemplate);

          if (appIdx !== -1) {
            if (existing[appIdx].publishers.includes(event.pubkey)) continue;
            const updated = [...existing];
            updated[appIdx] = {
              ...updated[appIdx],
              publishers: [...updated[appIdx].publishers, event.pubkey],
            };
            next.set(kind, updated);
          } else {
            next.set(kind, [
              ...existing,
              { name, picture: meta.picture, urlTemplate, publishers: [event.pubkey] },
            ]);
          }
        }
      }

      // Ensure every requested kind has an entry so consumers can distinguish
      // "still loading" (undefined) from "no results" ([]).
      for (const kind of kinds) {
        if (!next.has(kind)) next.set(kind, []);
      }
      return next;
    });
  }, []);

  const registerKind = useCallback(
    (kind: number) => {
      if (fetchedKinds.current.has(kind)) return;
      if (pendingKinds.current.has(kind)) return;
      pendingKinds.current.add(kind);

      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(flushPending, 100);
    },
    [flushPending]
  );

  return (
    <Nip89Context.Provider value={{ handlersMap, registerKind }}>
      {children}
    </Nip89Context.Provider>
  );
};
