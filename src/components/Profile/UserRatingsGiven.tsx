import React, { useEffect, useState, useCallback } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { dataLayer } from "@formstr/local-relay";
import { useRelayRefresh } from "../../dataLayer/hooks";
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
        setLoading(false);
      },
    });

    return () => handle.unobserve();
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
