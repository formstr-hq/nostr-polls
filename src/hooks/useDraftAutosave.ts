import { useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved";

const AUTOSAVE_DEBOUNCE_MS = 2000;

// Debounced autosave: calls `save` once the watched `deps` stop changing for
// AUTOSAVE_DEBOUNCE_MS, and flushes immediately on unmount (e.g. navigating
// away mid-edit) so nothing typed is silently lost. `canSave` gates saving
// when there's nothing worth persisting (e.g. empty content).
export function useDraftAutosave(
  save: () => Promise<void>,
  canSave: boolean,
  deps: React.DependencyList
): AutosaveStatus {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const saveRef = useRef(save);
  saveRef.current = save;
  const canSaveRef = useRef(canSave);
  canSaveRef.current = canSave;
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!canSave) return;
    setStatus("pending");
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = undefined;
      setStatus("saving");
      saveRef.current().then(() => setStatus("saved"));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Flush a pending save immediately when the component unmounts, so
  // navigating away just before the debounce fires doesn't drop it.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        if (canSaveRef.current) saveRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return status;
}
