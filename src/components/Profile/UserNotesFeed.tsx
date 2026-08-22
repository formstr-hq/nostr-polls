import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Event, Filter } from "nostr-tools";
import { Box, Typography, Tabs, Tab } from "@mui/material";
import { dataLayer } from "@formstr/local-relay";
import { useRelayRefresh } from "../../dataLayer/hooks";
import { isRelayHydrated } from "../../dataLayer/relayRefresh";
import { Notes } from "../Notes";
import UnifiedFeed from "../Feed/UnifiedFeed";

interface UserNotesFeedProps {
  pubkey: string;
  relays?: string[];
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
}

const KIND_NOTE = 1;

// A note is a "conversation" (reply) if it references another event with an
// `e` tag. Quotes use a `q` tag (NIP-18), so those stay "posts"; we also skip
// legacy quote-style `e` tags marked "mention". Everything else is a "post".
const isReply = (event: Event): boolean =>
  event.tags.some((t) => t[0] === "e" && t[3] !== "mention");

const UserNotesFeed: React.FC<UserNotesFeedProps> = ({ pubkey, scrollContainerRef }) => {
  const [notes, setNotes] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState(0);
  const relayRefresh = useRelayRefresh();

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
    // a fresh fetchNotes identity (and re-run below) once hydration completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, relayRefresh]);

  useEffect(() => {
    const cleanup = fetchNotes();
    return cleanup;
  }, [fetchNotes]);

  const posts = useMemo(() => notes.filter((n) => !isReply(n)), [notes]);
  const conversations = useMemo(() => notes.filter(isReply), [notes]);

  const data = subTab === 0 ? posts : conversations;

  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tabs
          value={subTab}
          onChange={(_, v) => setSubTab(v)}
          aria-label="notes sub tabs"
          variant="fullWidth"
        >
          <Tab label="Posts" />
          <Tab label="Conversations" />
        </Tabs>
      </Box>

      <UnifiedFeed
        data={data}
        loading={loading}
        customScrollParent={scrollContainerRef?.current ?? undefined}
        emptyState={
          <Box sx={{ p: 3, textAlign: "center" }}>
            <Typography variant="body1" color="text.secondary">
              {subTab === 0 ? "No posts yet" : "No conversations yet"}
            </Typography>
          </Box>
        }
        itemContent={(index, note) => (
          <Box key={note.id} sx={{ mb: 2 }}>
            <Notes event={note} />
          </Box>
        )}
      />
    </Box>
  );
};

export default UserNotesFeed;
