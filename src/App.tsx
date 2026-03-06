// App.tsx
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Outlet,
  Navigate,
  useParams,
} from "react-router-dom";

import { StatusBar, Style } from "@capacitor/status-bar";
import { nostrRuntime } from "./singletons";

import { EventCreator } from "./components/EventCreator";
import { PollResponse } from "./components/PollResponse";
import { PollResults } from "./components/PollResults";
import Header from "./components/Header";
import { PrepareNote } from "./components/Notes/PrepareNote";

import { AppContextProvider } from "./contexts/app-context";
import { ListProvider } from "./contexts/lists-context";
import { UserProvider } from "./contexts/user-context";
import { RatingProvider } from "./contexts/RatingProvider";
import { MetadataProvider } from "./hooks/MetadataProvider";
import { NotificationProvider } from "./contexts/notification-context";
import { RelayProvider } from "./contexts/relay-context";
import { NostrNotificationsProvider } from "./contexts/nostr-notification-context";
import { DMProvider } from "./contexts/dm-context";
import { TranslationBatchProvider } from "./contexts/translation-batch-context";
import { FeedScrollProvider, useFeedScroll } from "./contexts/FeedScrollContext";
import { VideoPlayerProvider } from "./contexts/VideoPlayerContext";
import { FloatingVideoPlayer } from "./components/Common/FloatingVideoPlayer";
import { useAndroidNotifications } from "./hooks/useAndroidNotifications";

import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, Box } from "@mui/material";
import { baseTheme } from "./styles/theme";

import EventList from "./components/Feed/FeedsLayout";
import NotesFeed from "./components/Feed/NotesFeed/components";
import ProfilesFeed from "./components/Feed/ProfileFeed";
import { PollFeed } from "./components/Feed/PollFeed";
import MoviesFeed from "./components/Feed/MoviesFeed";
import MoviePage from "./components/Movies/MoviePage";
import TopicsFeed from "./components/Feed/TopicsFeed";
import TopicExplorer from "./components/Feed/TopicsFeed/TopicsExplorerFeed";
import FeedsLayout from "./components/Feed/FeedsLayout";
import ProfilePage from "./components/Profile/ProfilePage";
import ConversationList from "./components/Messages/ConversationList";
import ChatView from "./components/Messages/ChatView";
import NewConversation from "./components/Messages/NewConversation";
import NotificationsPage from "./components/Notifications/NotificationsPage";

declare global {
  interface Window {
    nostr?: any;
  }
}

function AndroidNotifications() {
  useAndroidNotifications();
  return null;
}

// Inner component: reads scroll state and renders layout
function AppContent() {
  const { headerProgress } = useFeedScroll();
  const innerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(80);

  // Measure actual header height once on mount so the animation has no dead zone
  useLayoutEffect(() => {
    if (innerRef.current) setHeaderH(innerRef.current.offsetHeight);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header collapses in sync with scroll */}
      <Box
        sx={{
          overflow: "hidden",
          height: Math.max(0, headerH * (1 - headerProgress)),
          opacity: 1 - headerProgress,
        }}
      >
        <div ref={innerRef}>
          <div className="header-safe-area">
            <Header />
          </div>
        </div>
      </Box>

      {/* Routes fill remaining space */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <Routes>
          <Route path="/create" element={<ScrollPage><EventCreator /></ScrollPage>} />
          <Route
            path="/respond/:eventId"
            element={<ScrollPage><PollResponse /></ScrollPage>}
          />
          <Route
            path="note/:eventId"
            element={<PrepareNoteWrapper />}
          />
          <Route
            path="/profile/:npubOrNprofile"
            element={<ProfilePage />}
          />
          <Route
            path="/result/:eventId"
            element={<ScrollPage><PollResults /></ScrollPage>}
          />
          <Route path="/notifications" element={<ScrollPage><NotificationsPage /></ScrollPage>} />
          <Route path="/messages" element={<ScrollPage><ConversationList /></ScrollPage>} />
          <Route path="/messages/new" element={<ScrollPage><NewConversation /></ScrollPage>} />
          <Route path="/messages/:npub" element={<ChatView />} />
          <Route path="/ratings" element={<EventList />} />

          <Route path="/feeds" element={<FeedsLayout />}>
            <Route path="notes" element={<NotesFeed />} />
            <Route path="profiles" element={<ProfilesFeed />} />
            <Route path="topics" element={<TopicsFeed />}>
              <Route path=":tag" element={<TopicExplorer />} />
            </Route>
            <Route path="polls" index element={<PollFeed />} />

            <Route element={<Outlet />}>
              <Route path="movies" element={<MoviesFeed />} />
              <Route
                path="movies/:imdbId"
                element={<MoviePage />}
              />
            </Route>

            <Route index element={<PollFeed />} />
          </Route>

          <Route
            index
            path="/"
            element={<Navigate to={`/feeds/${localStorage.getItem("pollerama:lastFeed") || "polls"}`} replace />}
          />
        </Routes>
      </Box>
    </div>
  );
}

const App: React.FC = () => {
  // ⚡ Capacitor status bar setup
  useEffect(() => {
    const setupStatusBar = async () => {
      try {
        // Make sure the content starts below the status bar
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setStyle({ style: Style.Dark });
      } catch (e) {
        console.warn("StatusBar plugin error:", e);
      }
    };

    setupStatusBar();
  }, []);

  // Prune events older than 7 days every 10 minutes to keep memory bounded
  useEffect(() => {
    const interval = setInterval(() => nostrRuntime.debug.pruneOldEvents(7), 10 * 60_000);
    return () => clearInterval(interval);
  }, []);

  // Reconnect relay subscriptions when the app returns from background/idle
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 30_000) {
        nostrRuntime.reconnect();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return (
    <NotificationProvider>
      <ThemeProvider
        theme={baseTheme}
        modeStorageKey={"pollerama-color-scheme"}
      >
        <AppContextProvider>
          <UserProvider>
            <RelayProvider>
              <DMProvider>
              <NostrNotificationsProvider>
                <TranslationBatchProvider>
                  <ListProvider>
                    <RatingProvider>
                      <CssBaseline />
                      <MetadataProvider>
                        <VideoPlayerProvider>
                          <Router>
                            <AndroidNotifications />
                            <FeedScrollProvider>
                              <AppContent />
                            </FeedScrollProvider>
                            <FloatingVideoPlayer />
                          </Router>
                        </VideoPlayerProvider>
                      </MetadataProvider>
                    </RatingProvider>
                  </ListProvider>
                </TranslationBatchProvider>
              </NostrNotificationsProvider>
              </DMProvider>
            </RelayProvider>
          </UserProvider>
        </AppContextProvider>
      </ThemeProvider>
    </NotificationProvider>
  );
};

// Standalone pages need their own overflow-y:auto container because the global
// layout locks html/body overflow so Virtuoso can be the sole scroller on feeds.
function ScrollPage({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ height: "100%", overflowY: "auto" }}>
      {children}
    </Box>
  );
}

// Wrapper to pass eventId to PrepareNote.
function PrepareNoteWrapper() {
  const { eventId } = useParams();
  if (!eventId) return null;
  return (
    <Box sx={{ height: "100%", overflowY: "auto" }}>
      <PrepareNote neventId={eventId} />
    </Box>
  );
}

export default App;
