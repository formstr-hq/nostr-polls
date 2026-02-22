// src/features/Notes/components/Feeds/DiscoverFeed.tsx

import { useEffect, useMemo } from "react";
import { Button, Box, Typography } from "@mui/material";
import { useUserContext } from "../../../../hooks/useUserContext";
import RepostsCard from "./RepostedNoteCard";
import { useDiscoverNotes } from "../hooks/useDiscoverNotes";
import type { NoteMode } from "./index";
import UnifiedFeed from "../../UnifiedFeed";

const isRootNote = (event: { tags: string[][] }) =>
  !event.tags.some((t) => t[0] === "e");

const DiscoverFeed = ({ noteMode }: { noteMode: NoteMode }) => {
  const { user, requestLogin } = useUserContext();
  const { notes, pendingCount, fetchNotes, loadingMore, mergeNewNotes } =
    useDiscoverNotes();

  useEffect(() => {
    if (user && user.webOfTrust && user.webOfTrust.size > 0) {
      fetchNotes(user.webOfTrust);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const mergedNotes = useMemo(() => {
    return Array.from(notes.values())
      .filter((note) =>
        noteMode === "notes" ? isRootNote(note) : !isRootNote(note)
      )
      .map((note) => ({
        note,
        latestActivity: note.created_at,
      }))
      .sort((a, b) => b.latestActivity - a.latestActivity);
  }, [notes, noteMode]);

  if (!user) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "50vh",
          gap: 2,
        }}
      >
        <Typography variant="body1" color="text.secondary">
          Login to see notes from people you follow
        </Typography>
        <Button variant="contained" onClick={requestLogin}>
          Login
        </Button>
      </Box>
    );
  }

  if (!user.webOfTrust || user.webOfTrust.size === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "50vh",
          gap: 2,
        }}
      >
        <Typography variant="body1" color="text.secondary">
          You're not following anyone yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Follow people to see your social graph in your discover feed
        </Typography>
      </Box>
    );
  }

  return (
    <UnifiedFeed
      data={mergedNotes}
      loading={loadingMore && mergedNotes.length === 0}
      followOutput={false}
      newItemCount={pendingCount}
      newItemLabel="notes"
      onShowNewItems={mergeNewNotes}
      computeItemKey={(_, item) => item.note.id}
      itemContent={(index, item) => (
        <RepostsCard note={item.note} reposts={[]} />
      )}
    />
  );
};

export default DiscoverFeed;
