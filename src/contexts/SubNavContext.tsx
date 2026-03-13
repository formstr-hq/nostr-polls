import React, { createContext, useCallback, useContext, useState } from "react";

export type SubNavItem = {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
};

type SubNavCtx = {
  items: SubNavItem[];
  setItems: (items: SubNavItem[]) => void;
  clearItems: () => void;
};

const SubNavContext = createContext<SubNavCtx>({
  items: [],
  setItems: () => {},
  clearItems: () => {},
});

export const SubNavProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [items, setItemsState] = useState<SubNavItem[]>([]);

  const setItems = useCallback((next: SubNavItem[]) => {
    setItemsState(next);
  }, []);

  const clearItems = useCallback(() => {
    setItemsState([]);
  }, []);

  return (
    <SubNavContext.Provider value={{ items, setItems, clearItems }}>
      {children}
    </SubNavContext.Provider>
  );
};

export function useSubNav() {
  return useContext(SubNavContext);
}
