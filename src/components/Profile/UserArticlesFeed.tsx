import React, { useCallback, useEffect, useState } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { dataLayer } from "@formstr/local-relay";
import { useRelayRefresh } from "../../dataLayer/hooks";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, relayRefresh]);

  useEffect(() => {
    const cleanup = fetchArticles();
    return cleanup;
  }, [fetchArticles]);

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
