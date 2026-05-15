import React, { useCallback, useEffect, useRef, useState } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { useRelays } from "../../hooks/useRelays";
import { nostrRuntime } from "../../singletons";
import { useUserContext } from "../../hooks/useUserContext";
import { useListContext } from "../../hooks/useListContext";
import { useSubNav } from "../../contexts/SubNavContext";
import { useAppContext } from "../../hooks/useAppContext";
import { ArticleCard } from "../Articles/ArticleCard";
import UnifiedFeed from "./UnifiedFeed";

const STORAGE_KEY = "pollerama:articlesSource";
const BATCH_SIZE = 20;

type Source = "global" | "following";

const ArticlesFeed: React.FC = () => {
  const { relays } = useRelays();
  const { user } = useUserContext();
  const { refetchContacts } = useListContext();
  const { fetchUserProfileThrottled, profiles } = useAppContext();
  const { setItems, clearItems } = useSubNav();

  const savedSource = (localStorage.getItem(STORAGE_KEY) as Source) || "global";
  const [source, setSource] = useState<Source>(savedSource);
  const [articles, setArticles] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const cursorRef = useRef<number | undefined>(undefined);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const select = (s: Source) => {
      localStorage.setItem(STORAGE_KEY, s);
      setSource(s);
      setArticles([]);
      seen.current.clear();
      cursorRef.current = undefined;
      setInitialLoadDone(false);
      setExhausted(false);
    };

    setItems([
      { key: "global",    label: "Global",    active: source === "global",    onClick: () => select("global") },
      { key: "following", label: "Following",  active: source === "following", disabled: !user, onClick: () => select("following") },
    ]);

    return () => clearItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, user]);

  const fetchBatch = useCallback((isInitial: boolean) => {
    if (exhausted) return;
    if (isInitial) setLoading(true); else setLoadingMore(true);

    const now = Math.floor(Date.now() / 1000);
    const newArticles: Event[] = [];
    let oldestTs: number | undefined;

    const filter: Filter = {
      kinds: [30023],
      limit: BATCH_SIZE,
      until: cursorRef.current ?? now,
    };

    if (source === "following" && user?.follows?.length) {
      filter.authors = user.follows;
    }

    const handle = nostrRuntime.subscribe(relays, [filter], {
      onEvent: (event: Event) => {
        if (!seen.current.has(event.id)) {
          seen.current.add(event.id);
          newArticles.push(event);
          if (!profiles?.get(event.pubkey)) fetchUserProfileThrottled(event.pubkey);
        }
        if (!oldestTs || event.created_at < oldestTs) oldestTs = event.created_at;
      },
      onEose: () => { finalize(); handle.unsubscribe(); },
    });

    const finalize = () => {
      if (newArticles.length < BATCH_SIZE) setExhausted(true);
      if (oldestTs) cursorRef.current = oldestTs - 1;
      setArticles((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const merged = [...prev, ...newArticles.filter((e) => !ids.has(e.id))];
        merged.sort((a, b) => b.created_at - a.created_at);
        return merged;
      });
      setInitialLoadDone(true);
      setLoading(false);
      setLoadingMore(false);
    };

    setTimeout(() => { finalize(); handle.unsubscribe(); }, 5000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, relays, exhausted]);

  useEffect(() => {
    // If we're trying to render a follow-dependent feed but follows is missing
    // (truly empty or unresolved), re-trigger the contacts fetch.
    if (source === "following" && !user?.follows?.length) refetchContacts();
    fetchBatch(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const handleEndReached = useCallback(() => {
    if (!loadingMore && !loading && initialLoadDone && !exhausted) {
      fetchBatch(false);
    }
  }, [loadingMore, loading, initialLoadDone, exhausted, fetchBatch]);

  const renderItem = useCallback((_index: number, article: Event) => (
    <Box sx={{ maxWidth: 700, mx: "auto" }}>
      <ArticleCard event={article} />
    </Box>
  ), []);

  const computeKey = useCallback((_index: number, article: Event) => article.id, []);

  return (
    <UnifiedFeed
      data={articles}
      itemContent={renderItem}
      computeItemKey={computeKey}
      loading={false}
      loadingMore={loading || loadingMore}
      onEndReached={handleEndReached}
      emptyState={
        initialLoadDone ? (
          <Box display="flex" justifyContent="center" px={3} py={8}>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {source === "following"
                ? "No articles found from people you follow."
                : "No articles found."}
            </Typography>
          </Box>
        ) : undefined
      }
    />
  );
};

export default ArticlesFeed;
