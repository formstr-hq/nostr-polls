import React, { createContext, useCallback, useContext, useLayoutEffect, useState } from "react";

/**
 * Lets a page put its primary action in the block header (Color Block: the
 * block holds whatever is in focus). The composer uses it for Post, so the
 * action stays reachable above the keyboard instead of floating over the
 * fields in a bottom dock.
 */
export type HeaderAction = {
  label: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  submitting?: boolean;
};

// Split contexts on purpose: pages only subscribe to the (stable) setter, so
// registering an action doesn't re-render the page that registered it — only
// the Header that reads the action.
const HeaderActionContext = createContext<HeaderAction | null>(null);
const HeaderActionSetterContext = createContext<(action: HeaderAction | null) => void>(() => {});

export const HeaderActionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [action, setAction] = useState<HeaderAction | null>(null);
  const set = useCallback((next: HeaderAction | null) => setAction(next), []);
  return (
    <HeaderActionSetterContext.Provider value={set}>
      <HeaderActionContext.Provider value={action}>{children}</HeaderActionContext.Provider>
    </HeaderActionSetterContext.Provider>
  );
};

/** Read the header action (used by the Header). */
export const useHeaderActionState = () => useContext(HeaderActionContext);

/** Register `action` while the calling page is mounted; pass null to clear it. */
export function useHeaderAction(action: HeaderAction | null) {
  const setAction = useContext(HeaderActionSetterContext);
  // Layout effect so the header always has the latest handler/disabled state
  // before the user can click it (typing then immediately hitting Post).
  useLayoutEffect(() => {
    setAction(action);
  }, [action, setAction]);
  useLayoutEffect(() => () => setAction(null), [setAction]);
}
