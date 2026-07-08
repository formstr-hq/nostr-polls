import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { LocalDraft } from "../components/EventCreator/draftModel";
import {
  deleteDraftRecord,
  getAllDrafts,
  putDraft,
} from "../components/EventCreator/draftStore";

interface DraftsContextInterface {
  // id → local draft. `undefined` until the first IndexedDB load resolves.
  drafts: Map<string, LocalDraft> | undefined;
  saveDraft: (draft: LocalDraft) => Promise<void>;
  deleteDraft: (id: string) => Promise<void>;
}

const DraftsContext = createContext<DraftsContextInterface | null>(null);

export function DraftsProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Map<string, LocalDraft> | undefined>();
  // Authoritative copy, updated synchronously by save/delete — mirrors the
  // playlists context's rationale: state updates are async, so back-to-back
  // save/delete calls would otherwise race against a stale `drafts` closure.
  const draftsRef = useRef<Map<string, LocalDraft> | undefined>(undefined);

  const applyMap = useCallback((map: Map<string, LocalDraft>) => {
    draftsRef.current = map;
    setDrafts(map);
  }, []);

  // Drafts are device-local, not per-account, so load once on mount.
  useEffect(() => {
    let alive = true;
    getAllDrafts()
      .then((all) => {
        if (!alive) return;
        const map = new Map<string, LocalDraft>();
        all
          .sort((a, b) => b.updated_at - a.updated_at)
          .forEach((d) => map.set(d.id, d));
        applyMap(map);
      })
      .catch(() => alive && applyMap(new Map()));
    return () => {
      alive = false;
    };
  }, [applyMap]);

  const saveDraft = useCallback(
    async (draft: LocalDraft) => {
      await putDraft(draft);
      applyMap(new Map(draftsRef.current ?? []).set(draft.id, draft));
    },
    [applyMap]
  );

  const deleteDraft = useCallback(
    async (id: string) => {
      await deleteDraftRecord(id);
      const next = new Map(draftsRef.current ?? []);
      next.delete(id);
      applyMap(next);
    },
    [applyMap]
  );

  return (
    <DraftsContext.Provider value={{ drafts, saveDraft, deleteDraft }}>
      {children}
    </DraftsContext.Provider>
  );
}

export function useDrafts() {
  const ctx = useContext(DraftsContext);
  if (!ctx) throw new Error("useDrafts must be used within DraftsProvider");
  return ctx;
}
