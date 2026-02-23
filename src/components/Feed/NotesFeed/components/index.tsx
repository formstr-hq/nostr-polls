import React, { useState, lazy, Suspense } from "react";
import { Typography, CircularProgress, Chip, Box } from "@mui/material";
import RateEventModal from "../../../Ratings/RateEventModal";
import NotesFeedTabs from "./NotesFeedTabs";
import { useFeedScroll } from "../../../../contexts/FeedScrollContext";

const FollowingFeed = lazy(() => import("./FollowingFeed"));
const ReactedFeed = lazy(() => import("./ReactedFeed"));
const DiscoverFeed = lazy(() => import("./DiscoverFeed"));

export type NoteMode = "notes" | "conversations";

const NotesFeed = () => {
  const [activeTab, setActiveTab] = useState<
    "following" | "reacted" | "discover"
  >("discover");
  const [modalOpen, setModalOpen] = useState(false);
  const [noteMode, setNoteMode] = useState<NoteMode>("notes");
  const { headerProgress } = useFeedScroll();

  const showNoteFilter = activeTab === "following" || activeTab === "discover";

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box
        sx={{
          overflow: "hidden",
          height: Math.max(0, 126 * (1 - headerProgress)),
          opacity: 1 - headerProgress,
        }}
      >
        <NotesFeedTabs activeTab={activeTab} setActiveTab={setActiveTab} />

        <Typography sx={{ mt: 2 }}>
          {activeTab === "following"
            ? "Notes from people you follow"
            : activeTab === "reacted"
            ? "Notes reacted to by contacts"
            : "Discover new posts from friends of friends"}
        </Typography>

        {showNoteFilter && (
          <Box display="flex" gap={1} sx={{ mt: 1, mb: 1, ml: 1 }}>
            <Chip
              label="Notes"
              size="small"
              variant={noteMode === "notes" ? "filled" : "outlined"}
              color={noteMode === "notes" ? "primary" : "default"}
              onClick={() => setNoteMode("notes")}
            />
            <Chip
              label="Conversations"
              size="small"
              variant={noteMode === "conversations" ? "filled" : "outlined"}
              color={noteMode === "conversations" ? "primary" : "default"}
              onClick={() => setNoteMode("conversations")}
            />
          </Box>
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<CircularProgress sx={{ m: 4 }} />}>
          {activeTab === "following" ? (
            <FollowingFeed noteMode={noteMode} />
          ) : activeTab === "reacted" ? (
            <ReactedFeed />
          ) : (
            <DiscoverFeed noteMode={noteMode} />
          )}
        </Suspense>
      </Box>

      <RateEventModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </Box>
  );
};

export default NotesFeed;
