import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { dataLayer } from "@formstr/local-relay";
import { useRelayRefresh } from "../../dataLayer/hooks";
import { isRelayHydrated } from "../../dataLayer/relayRefresh";
import { Notes } from "../Notes";
import UnifiedFeed from "../Feed/UnifiedFeed";
import RepostsCard from "../Feed/NotesFeed/components/RepostedNoteCard";
import { buildFeedItems, FeedItem, KIND_REPOST } from "../Feed/repostItems";

interface UserNotesFeedProps {
  pubkey: string;
  relays?: string[];
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
}

const KIND_NOTE = 1;

const UserNotesFeed: React.FC<UserNotesFeedProps> = ({ pubkey, scrollContainerRef }) => {
  const [notes, setNotes] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const relayRefresh = useRelayRefresh();

  const fetchNotes = useCallback(() => {
    if (!pubkey) return;

    setLoading(true);
    const filters: Filter[] = [
      { kinds: [KIND_NOTE], authors: [pubkey], limit: 50 },
      // Kind 6 = the user's own reposts of notes (NIP-18). Separate filter so a
      // heavy reposter's reposts don't eat the notes' limit (and vice versa).
      { kinds: [KIND_REPOST], authors: [pubkey], limit: 50 },
    ];

    const handle = dataLayer.observe(filters, {
      onEvent(event) {
        setNotes((prev) => {
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
  }, [pubkey]);

  // Declare immediately (cached notes paint now). `relayRefresh` stays a dep so
  // hydration and a worker restart both re-run the read.
  useEffect(() => {
    const cleanup = fetchNotes();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchNotes, relayRefresh]);

  // Reposts fold into their original note; the feed stays one chronological
  // stream so the profile doesn't nest a Posts/Conversations tab inside the
  // outer Activity/Polls/Articles tabs.
  const items: FeedItem[] = useMemo(
    () => buildFeedItems(notes, [KIND_NOTE]),
    [notes]
  );

  return (
    <UnifiedFeed
      data={items}
      loading={loading}
      customScrollParent={scrollContainerRef?.current ?? undefined}
      emptyState={
        <Box sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body1" color="text.secondary">
            No activity yet
          </Typography>
        </Box>
      }
      itemContent={(index, item) =>
        item.type === "repost" ? (
          <Box key={`repost:${item.note.id}`} sx={{ mb: 2 }}>
            <RepostsCard note={item.note} reposts={item.reposts} />
          </Box>
        ) : (
          <Box key={item.event.id} sx={{ mb: 2 }}>
            <Notes event={item.event} />
          </Box>
        )
      }
    />
  );
};

export default UserNotesFeed;
