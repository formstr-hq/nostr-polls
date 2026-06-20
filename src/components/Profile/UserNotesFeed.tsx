import React, { useEffect, useState, useCallback } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Typography } from "@mui/material";
import { dataLayer } from "@formstr/local-relay";
import { Notes } from "../Notes";
import UnifiedFeed from "../Feed/UnifiedFeed";

interface UserNotesFeedProps {
  pubkey: string;
  relays?: string[];
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
}

const KIND_NOTE = 1;

const UserNotesFeed: React.FC<UserNotesFeedProps> = ({ pubkey, scrollContainerRef }) => {
  const [notes, setNotes] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotes = useCallback(() => {
    if (!pubkey) return;

    setLoading(true);
    const filters: Filter[] = [
      {
        kinds: [KIND_NOTE],
        authors: [pubkey],
        limit: 50,
      },
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
        setLoading(false);
      },
    });

    return () => handle.unobserve();
  }, [pubkey]);

  useEffect(() => {
    const cleanup = fetchNotes();
    return cleanup;
  }, [fetchNotes]);

  return (
    <UnifiedFeed
      data={notes}
      loading={loading}
      customScrollParent={scrollContainerRef?.current ?? undefined}
      emptyState={
        <Box sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body1" color="text.secondary">
            No notes yet
          </Typography>
        </Box>
      }
      itemContent={(index, note) => (
        <Box key={note.id} sx={{ mb: 2 }}>
          <Notes event={note} />
        </Box>
      )}
    />
  );
};

export default UserNotesFeed;
