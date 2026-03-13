import React, { useState, lazy, Suspense, useEffect } from "react";
import { Typography, CircularProgress, Chip, Box } from "@mui/material";
import RateEventModal from "../../../Ratings/RateEventModal";
import { useSubNav } from "../../../../contexts/SubNavContext";

const FollowingFeed = lazy(() => import("./FollowingFeed"));
const ReactedFeed = lazy(() => import("./ReactedFeed"));
const DiscoverFeed = lazy(() => import("./DiscoverFeed"));

export type NoteMode = "notes" | "conversations";

const NotesFeed = () => {
  const NOTES_TAB_KEY = "pollerama:lastNotesTab";
  const [activeTab, setActiveTab] = useState<"following" | "reacted" | "discover">(
    () => {
      const saved = localStorage.getItem(NOTES_TAB_KEY);
      return (saved === "following" || saved === "reacted" || saved === "discover")
        ? saved
        : "discover";
    }
  );

  const handleSetActiveTab = (tab: "following" | "reacted" | "discover") => {
    setActiveTab(tab);
    localStorage.setItem(NOTES_TAB_KEY, tab);
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [noteMode, setNoteMode] = useState<NoteMode>("notes");
  const { setItems, clearItems } = useSubNav();

  useEffect(() => {
    setItems([
      {
        key: "discover",
        label: "Discover",
        active: activeTab === "discover",
        onClick: () => handleSetActiveTab("discover"),
      },
      {
        key: "following",
        label: "Following",
        active: activeTab === "following",
        onClick: () => handleSetActiveTab("following"),
      },
      {
        key: "reacted",
        label: "Reacted",
        active: activeTab === "reacted",
        onClick: () => handleSetActiveTab("reacted"),
      },
    ]);
    return () => clearItems();
  }, [activeTab, setItems, clearItems]);

  const showNoteFilter = activeTab === "following" || activeTab === "discover";

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flexShrink: 0 }}>
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

      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
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
