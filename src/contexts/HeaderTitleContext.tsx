import React, { createContext, useContext, useEffect, useState } from "react";

// Lets a page put its own focus into the block header (Color Block: the block
// holds whatever is in focus) — e.g. the chat contact instead of "Chat".
type Ctx = { title: React.ReactNode | null; setTitle: (t: React.ReactNode | null) => void };

const HeaderTitleContext = createContext<Ctx>({ title: null, setTitle: () => {} });

export const HeaderTitleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [title, setTitle] = useState<React.ReactNode | null>(null);
  return <HeaderTitleContext.Provider value={{ title, setTitle }}>{children}</HeaderTitleContext.Provider>;
};

export const useHeaderTitleOverride = () => useContext(HeaderTitleContext).title;

/** Show `title` in the block header while the calling page is mounted. */
export function useHeaderTitle(title: React.ReactNode | null) {
  const { setTitle } = useContext(HeaderTitleContext);
  useEffect(() => {
    setTitle(title);
  }, [title, setTitle]);
  useEffect(() => () => setTitle(null), [setTitle]);
}
