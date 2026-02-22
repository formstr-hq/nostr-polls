import { useEffect, useMemo } from "react";
import { Button, CircularProgress } from "@mui/material";
import { useUserContext } from "../../../../hooks/useUserContext";
import RepostsCard from "./RepostedNoteCard";
import { useFollowingNotes } from "../hooks/useFollowingNotes";
import type { NoteMode } from "./index";
import UnifiedFeed from "../../UnifiedFeed";

const isRootNote = (event: { tags: string[][] }) =>
  !event.tags.some((t) => t[0] === "e");

const FollowingFeed = ({ noteMode }: { noteMode: NoteMode }) => {
  const { user, requestLogin } = useUserContext();
  const { notes, reposts, fetchNotes, loadingMore, pendingCount, mergeNewNotes } =
    useFollowingNotes();

  // Merge notes and reposts for sorting by created_at
  // Each item: { note: Event, reposts: Event[] }
  const mergedNotes = useMemo(() => {
    return Array.from(notes.values())
      .filter((note) =>
        noteMode === "notes" ? isRootNote(note) : !isRootNote(note)
      )
      .map((note) => {
        const noteReposts = reposts.get(note.id) || [];
        const latestRepostTime = noteReposts.length
          ? Math.max(...noteReposts.map((r) => r.created_at))
          : 0;

        const latestActivity = Math.max(note.created_at, latestRepostTime);

        return {
          note,
          reposts: noteReposts,
          latestActivity,
        };
      })
      .sort((a, b) => b.latestActivity - a.latestActivity);
  }, [notes, reposts, noteMode]);

  useEffect(() => {
    if (user) {
      fetchNotes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      {!user ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            margin: 10,
          }}
        >
          <Button variant="contained" onClick={requestLogin}>
            login to view feed
          </Button>
        </div>
      ) : null}
      {loadingMore ? <CircularProgress /> : null}
      <UnifiedFeed
        data={mergedNotes}
        followOutput={false}
        onEndReached={fetchNotes}
        computeItemKey={(_, item) => item.note.id}
        newItemCount={pendingCount}
        onShowNewItems={mergeNewNotes}
        newItemLabel="notes"
        itemContent={(index, item) => (
          <RepostsCard
            note={item.note}
            reposts={reposts.get(item.note.id) || []}
          />
        )}
      />
    </div>
  );
};

export default FollowingFeed;
