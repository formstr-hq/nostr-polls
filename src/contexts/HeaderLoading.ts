import { useEffect, useId, useSyncExternalStore } from "react";

// Feeds report "I'm loading" here and the block header draws the loader along
// its curved edge. It's a tiny module-level store rather than a context because
// the header sits above every feed provider in the tree.
const active = new Set<string>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const getSnapshot = () => active.size > 0;

/** Marks the calling component as loading while `loading` is true. */
export function useReportHeaderLoading(loading: boolean) {
  const id = useId();
  useEffect(() => {
    if (!loading) return;
    active.add(id);
    emit();
    return () => {
      active.delete(id);
      emit();
    };
  }, [loading, id]);
}

/** True while any mounted feed is loading. */
export function useHeaderLoading(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
