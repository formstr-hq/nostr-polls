import React, { createContext, useCallback, useContext, useRef, useState } from "react";

type FeedScrollCtx = {
  isScrolledDown: boolean;
  reportScroll: (scrollTop: number) => void;
  resetScroll: () => void;
};

const FeedScrollContext = createContext<FeedScrollCtx>({
  isScrolledDown: false,
  reportScroll: () => {},
  resetScroll: () => {},
});

export const FeedScrollProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  const lastScrollTopRef = useRef(0);

  const reportScroll = useCallback((scrollTop: number) => {
    const last = lastScrollTopRef.current;
    if (scrollTop <= 10) {
      setIsScrolledDown(false);
    } else if (scrollTop > last + 5) {
      setIsScrolledDown(true);
    } else if (scrollTop < last - 5) {
      setIsScrolledDown(false);
    }
    lastScrollTopRef.current = scrollTop;
  }, []);

  const resetScroll = useCallback(() => {
    setIsScrolledDown(false);
    lastScrollTopRef.current = 0;
  }, []);

  return (
    <FeedScrollContext.Provider value={{ isScrolledDown, reportScroll, resetScroll }}>
      {children}
    </FeedScrollContext.Provider>
  );
};

export function useFeedScroll() {
  return useContext(FeedScrollContext);
}
