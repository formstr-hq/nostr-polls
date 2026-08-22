import React, { useEffect, useState, useCallback } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { dataLayer } from "@formstr/local-relay";
import { useRelayRefresh } from "../../dataLayer/hooks";
import { isRelayHydrated } from "../../dataLayer/relayRefresh";
import ReviewCard from "../Ratings/ReviewCard";
import UnifiedFeed from "../Feed/UnifiedFeed";

interface UserRatingsGivenProps {
  pubkey: string;
  relays?: string[];
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
}

const KIND_RATING = 34259;

const UserRatingsGiven: React.FC<UserRatingsGivenProps> = ({ pubkey, scrollContainerRef }) => {
  const [ratings, setRatings] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const relayRefresh = useRelayRefresh();

  const fetchRatings = useCallback(() => {
    if (!pubkey) return;

    setLoading(true);
    const filters: Filter[] = [
      {
        kinds: [KIND_RATING],
        authors: [pubkey],
        limit: 50,
      },
    ];

    const handle = dataLayer.observe(filters, {
      onEvent(event) {
        setRatings((prev) => {
          const exists = prev.find((e) => e.id === event.id);
          if (exists) return prev;
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
    // relayRefresh isn't read in the body — it's a dependency purely to force
    // a fresh fetchRatings identity (and re-run below) once hydration completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, relayRefresh]);

  useEffect(() => {
    const cleanup = fetchRatings();
    return cleanup;
  }, [fetchRatings]);

  return (
    <UnifiedFeed
      data={ratings}
      loading={loading}
      customScrollParent={scrollContainerRef?.current ?? undefined}
      emptyState={
        <Box sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body1" color="text.secondary">
            No ratings yet
          </Typography>
        </Box>
      }
      itemContent={(index, rating) => (
        <Box key={rating.id} sx={{ mb: 2 }}>
          <ReviewCard event={rating} />
        </Box>
      )}
    />
  );
};

export default UserRatingsGiven;
