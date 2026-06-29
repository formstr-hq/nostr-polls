import React, { useEffect, useState, useCallback } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { dataLayer } from "@formstr/local-relay";
import PollResponseForm from "../PollResponse/PollResponseForm";
import UnifiedFeed from "../Feed/UnifiedFeed";

interface UserPollsFeedProps {
  pubkey: string;
  relays?: string[];
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
}

const KIND_POLL = 1068;

const UserPollsFeed: React.FC<UserPollsFeedProps> = ({ pubkey, scrollContainerRef }) => {
  const [polls, setPolls] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPolls = useCallback(() => {
    if (!pubkey) return;

    setLoading(true);
    const filters: Filter[] = [
      {
        kinds: [KIND_POLL],
        authors: [pubkey],
        limit: 50,
      },
    ];

    const handle = dataLayer.observe(filters, {
      onEvent(event) {
        setPolls((prev) => {
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
  }, [pubkey]);

  useEffect(() => {
    const cleanup = fetchPolls();
    return cleanup;
  }, [fetchPolls]);

  return (
    <UnifiedFeed
      data={polls}
      loading={loading}
      customScrollParent={scrollContainerRef?.current ?? undefined}
      emptyState={
        <Box sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body1" color="text.secondary">
            No polls yet
          </Typography>
        </Box>
      }
      itemContent={(index, poll) => (
        <Box key={poll.id} sx={{ mb: 2 }}>
          <PollResponseForm pollEvent={poll} />
        </Box>
      )}
    />
  );
};

export default UserPollsFeed;
