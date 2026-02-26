// App.tsx
import React, { useEffect } from "react";
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

declare global {
  interface Window {
    nostr?: any;
  }
}

// Inner component: reads scroll state and renders layout
function AppContent() {
  const { isScrolledDown } = useFeedScroll();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Animated header wrapper — collapses when scrolled down */}
      <Box
        sx={{
          overflow: "hidden",
          height: isScrolledDown ? 0 : "auto",
        }}
      >
        <Box
          sx={{
            opacity: isScrolledDown ? 0 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          <div className="header-safe-area">
            <Header />
          </div>
        </Box>
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
                        <Router>
                          <FeedScrollProvider>
                            <AppContent />
                          </FeedScrollProvider>
                        </Router>
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
