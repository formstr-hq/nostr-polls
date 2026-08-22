import React, { useEffect, useState, useCallback } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { dataLayer } from "@formstr/local-relay";
import { useRelayRefresh } from "../../dataLayer/hooks";
import { isRelayHydrated } from "../../dataLayer/relayRefresh";
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
  const relayRefresh = useRelayRefresh();

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
    // a fresh fetchPolls identity (and re-run below) once hydration completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, relayRefresh]);

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
