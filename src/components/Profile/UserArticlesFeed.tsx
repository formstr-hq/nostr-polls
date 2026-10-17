import React, { useCallback, useEffect, useState } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { dataLayer } from "@formstr/local-relay";
import { useRelayHydrated, useRelayRefresh } from "../../dataLayer/hooks";
import { isRelayHydrated } from "../../dataLayer/relayRefresh";
import { useAppContext } from "../../hooks/useAppContext";
import { ArticleCard } from "../Articles/ArticleCard";
import UnifiedFeed from "../Feed/UnifiedFeed";

interface UserArticlesFeedProps {
  pubkey: string;
  relays?: string[];
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
}

const UserArticlesFeed: React.FC<UserArticlesFeedProps> = ({ pubkey, scrollContainerRef }) => {
  const [articles, setArticles] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const { fetchUserProfileThrottled, profiles } = useAppContext();
  const relayRefresh = useRelayRefresh();
  // Wait for the worker's cache before the first request, so it replays cached
  // articles instead of EOSE-ing on an empty store and re-fetching everything.
  const hydrated = useRelayHydrated();

  const fetchArticles = useCallback(() => {
    if (!pubkey) return;
    setLoading(true);
    const filter: Filter = { kinds: [30023], authors: [pubkey], limit: 50 };
    const handle = dataLayer.observe([filter], {
      onEvent(event) {
        if (!profiles?.get(event.pubkey)) fetchUserProfileThrottled(event.pubkey);
        setArticles((prev) => {
          if (prev.find((e) => e.id === event.id)) return prev;
          return [...prev, event].sort((a, b) => b.created_at - a.created_at);
        });
      },
      onEose() {
        // A pre-hydration EOSE means the store was still loading, not
        // actually empty — the relayRefresh-dep re-run below retries once
        // hydration completes, so hold off on clearing the spinner here.
        if (isRelayHydrated()) setLoading(false);
      },
    });
    // Safety net: don't let a stuck hydration signal spin forever.
    const timeout = setTimeout(() => setLoading(false), 8000);
    return () => {
      handle.unobserve();
      clearTimeout(timeout);
    };
    // `profiles`/`fetchUserProfileThrottled` are read but intentionally not deps:
    // depending on them would refetch the whole feed on every profile update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey]);

  // Hold the first request until hydration, then fetch. `relayRefresh` stays a
  // dep so a worker restart (which drops its in-memory interests) also refetches.
  useEffect(() => {
    if (!hydrated) return;
    const cleanup = fetchArticles();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchArticles, hydrated, relayRefresh]);

  return (
    <UnifiedFeed
      data={articles}
      loading={loading}
      customScrollParent={scrollContainerRef?.current ?? undefined}
      emptyState={
        <Box sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body1" color="text.secondary">
            No articles yet
          </Typography>
        </Box>
      }
      itemContent={(_index, article) => (
        <Box key={article.id} sx={{ mb: 1 }}>
          <ArticleCard event={article} />
        </Box>
      )}
      computeItemKey={(_index, article) => article.id}
    />
  );
};

export default UserArticlesFeed;
