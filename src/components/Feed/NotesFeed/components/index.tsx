import React, { useState, lazy, Suspense, useEffect, useRef } from "react";
import { Typography, CircularProgress, Chip, Box } from "@mui/material";
import RateEventModal from "../../../Ratings/RateEventModal";
import { useFeedActions } from "../../../../contexts/FeedActionsContext";
import { useSubNav } from "../../../../contexts/SubNavContext";

const FollowingFeed = lazy(() => import("./FollowingFeed"));
const ReactedFeed = lazy(() => import("./ReactedFeed"));
const DiscoverFeed = lazy(() => import("./DiscoverFeed"));
const ZappedFeed = lazy(() => import("./ZappedFeed"));

export type NoteMode = "notes" | "conversations";
type NotesTab = "following" | "reacted" | "discover" | "zapped";

const NotesFeed = () => {
  const NOTES_TAB_KEY = "pollerama:lastNotesTab";
  const [activeTab, setActiveTab] = useState<NotesTab>(
    () => {
      const saved = localStorage.getItem(NOTES_TAB_KEY);
      return (saved === "following" || saved === "reacted" || saved === "discover" || saved === "zapped")
        ? saved
        : "discover";
    }
  );

  const handleSetActiveTab = (tab: NotesTab) => {
    setActiveTab(tab);
    localStorage.setItem(NOTES_TAB_KEY, tab);
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [noteMode, setNoteMode] = useState<NoteMode>("notes");
  const { setItems, clearItems } = useSubNav();
  const { registerRefresh } = useFeedActions();
  // Ref for the active feed's refresh function — set by each feed via onRegisterRefresh
  const refreshRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    // Clear ref when tab changes — new feed will register its own refresh
    refreshRef.current = undefined;
    // Register a stable wrapper so the SpeedDial always calls the active sub-feed's refresh
    registerRefresh(() => refreshRef.current?.());
  }, [activeTab, registerRefresh]);

  useEffect(() => {
    setItems([
      {
        key: "discover",
        label: "Network",
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
      {
        key: "zapped",
        label: "Zapped",
        active: activeTab === "zapped",
        onClick: () => handleSetActiveTab("zapped"),
      },
    ]);
    return () => clearItems();
  }, [activeTab, setItems, clearItems]);

  const showNoteFilter = activeTab === "following" || activeTab === "discover";

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flexShrink: 0 }}>
        <Typography sx={{ color: "text.secondary", fontSize: "0.85rem", mt: 2, mb: showNoteFilter ? 0 : 1 }}>
          {activeTab === "following"
            ? "Notes from people you follow"
            : activeTab === "reacted"
            ? "Notes reacted to by contacts"
            : activeTab === "zapped"
            ? "Notes zapped by your contacts"
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
            <FollowingFeed
              noteMode={noteMode}
              onRegisterRefresh={(fn) => { refreshRef.current = fn; }}
            />
          ) : activeTab === "reacted" ? (
            <ReactedFeed onRegisterRefresh={(fn) => { refreshRef.current = fn; }} />
          ) : activeTab === "zapped" ? (
            <ZappedFeed onRegisterRefresh={(fn) => { refreshRef.current = fn; }} />
          ) : (
            <DiscoverFeed
              noteMode={noteMode}
              onRegisterRefresh={(fn) => { refreshRef.current = fn; }}
            />
          )}
        </Suspense>
      </Box>

      <RateEventModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </Box>
  );
};

export default NotesFeed;
