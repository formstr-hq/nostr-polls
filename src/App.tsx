// App.tsx
import React, { useEffect, useMemo } from "react";
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Outlet,
  Navigate,
  useParams,
} from "react-router-dom";

import { StatusBar, Style } from "@capacitor/status-bar";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { nostrRuntime } from "./singletons";

import { EventCreator } from "./components/EventCreator";
import { PollResponse } from "./components/PollResponse";
import { PollResults } from "./components/PollResults";
import Header from "./components/Header";
import { PrepareNote } from "./components/Notes/PrepareNote";
import { PrivateNote } from "./components/Notes/PrivateNote";

import { AppContextProvider } from "./contexts/app-context";
import { ListProvider } from "./contexts/lists-context";
import { UserProvider } from "./contexts/user-context";
import { RatingProvider } from "./contexts/RatingProvider";
import { ZapProvider } from "./contexts/ZapProvider";
import { MetadataProvider } from "./hooks/MetadataProvider";
import { NotificationProvider } from "./contexts/notification-context";
import { RelayProvider } from "./contexts/relay-context";
import { RelayHealthProvider } from "./contexts/RelayHealthContext";
import { GossipProvider } from "./contexts/GossipContext";
import { NostrNotificationsProvider } from "./contexts/nostr-notification-context";
import { DMProvider } from "./contexts/dm-context";
import { ReportsProvider } from "./contexts/reports-context";
import { TranslationBatchProvider } from "./contexts/translation-batch-context";
import { FeedScrollProvider } from "./contexts/FeedScrollContext";
import { SubNavProvider } from "./contexts/SubNavContext";
import { AppearanceProvider, useAppearance } from "./contexts/AppearanceContext";
import NavSidebar from "./components/SidePane";
import { DraggableCorner } from "./components/Common/DraggableCorner";
import { VideoPlayerProvider } from "./contexts/VideoPlayerContext";
import { FloatingVideoPlayer } from "./components/Common/FloatingVideoPlayer";
import { useAndroidNotifications } from "./hooks/useAndroidNotifications";
import { UpdateBanner } from "./components/UpdateBanner";

import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, Box, Fab } from "@mui/material";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import { buildTheme } from "./styles/theme";
import { getFontPreset, getColorPreset } from "./styles/themes";

import EventList from "./components/Feed/FeedsLayout";
import NotesFeed from "./components/Feed/NotesFeed/components";
import HomeFeed from "./components/Feed/HomeFeed";
import ProfilesFeed from "./components/Feed/ProfileFeed";
import { PollFeed } from "./components/Feed/PollFeed";
import MoviesFeed from "./components/Feed/MoviesFeed";
import FollowPacksFeed from "./components/Feed/FollowPacksFeed";
import FollowPackDetail from "./components/FollowPacks/FollowPackDetail";
import ArticlesFeed from "./components/Feed/ArticlesFeed";
import ArticleDetail from "./components/Articles/ArticleDetail";
import MoviePage from "./components/Movies/MoviePage";
import { Nip89Provider } from "./contexts/Nip89Context";
import { useUserContext } from "./hooks/useUserContext";
import { useAppContext } from "./hooks/useAppContext";
import TopicsFeed from "./components/Feed/TopicsFeed";
import TopicExplorer from "./components/Feed/TopicsFeed/TopicsExplorerFeed";
import FeedsLayout from "./components/Feed/FeedsLayout";
import ProfilePage from "./components/Profile/ProfilePage";
import ConversationList from "./components/Messages/ConversationList";
import ChatView from "./components/Messages/ChatView";
import NewConversation from "./components/Messages/NewConversation";
import NotificationsPage from "./components/Notifications/NotificationsPage";
import { SettingsScreen } from "./components/Settings/SettingsScreen";

declare global {
  interface Window {
    nostr?: any;
  }
}

function AndroidNotifications() {
  useAndroidNotifications();
  return null;
}

// Reads appearance context and provides a dynamically built MUI theme
function DynamicThemeWrapper({ children }: { children: React.ReactNode }) {
  const { fontPresetId, colorPresetId } = useAppearance();
  const fontPreset = getFontPreset(fontPresetId);
  const colorPreset = getColorPreset(colorPresetId);
  const theme = useMemo(
    () => buildTheme(
      fontPreset.fontFamily,
      colorPreset.lightPrimary,
      colorPreset.darkPrimary,
      colorPreset.lightBg,
      colorPreset.darkBg,
      colorPreset.lightSecondary,
      colorPreset.darkSecondary,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontPreset.id, colorPreset.id],
  );
  return (
    <ThemeProvider theme={theme} modeStorageKey="pollerama-color-scheme">
      {children}
    </ThemeProvider>
  );
}

// Inner component: static layout — header on top, sidebar + content below
function AppContent() {
  const [sidebarOpen, setSidebarOpen] = React.useState(
    () => localStorage.getItem("pollerama:sidebarOpen") !== "false"
  );
  const toggleSidebar = () =>
    setSidebarOpen((prev) => {
      localStorage.setItem("pollerama:sidebarOpen", String(!prev));
      return !prev;
    });

  const { user } = useUserContext();
  const { resetStore } = useAppContext();
  const prevPubkeyRef = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    const prev = prevPubkeyRef.current;
    const next = user?.pubkey ?? null;
    // undefined = first render (skip); null→pubkey or pubkey→pubkey = actual switch
    if (prev !== undefined && prev !== next) {
      resetStore();
      nostrRuntime.reconnect();
    }
    prevPubkeyRef.current = next;
  }, [user?.pubkey, resetStore]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="header-safe-area">
        <Header />
      </div>
      <UpdateBanner />

      {/* Sidebar + routes side by side — both heights are constant */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex" }}>
        <NavSidebar open={sidebarOpen} onToggle={toggleSidebar} />
        <Box key={user?.pubkey ?? 'anon'} sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {!sidebarOpen && (
            <DraggableCorner
              storageKey="pollerama:sidebarFabCorner"
              defaultCorner="bl"
              offset={{ x: 12, y: 20 }}
              zIndex={1200}
            >
              {() => (
                <Fab size="small" onClick={toggleSidebar}>
                  <MenuOpenIcon fontSize="small" />
                </Fab>
              )}
            </DraggableCorner>
          )}
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
            path="p/:nevent"
            element={<PrivateNoteWrapper />}
          />
          <Route
            path="/profile/:npubOrNprofile"
            element={<ProfilePage />}
          />
          <Route
            path="/result/:eventId"
            element={<ScrollPage><PollResults /></ScrollPage>}
          />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/notifications" element={<ScrollPage><NotificationsPage /></ScrollPage>} />
          <Route path="/messages" element={<ScrollPage><ConversationList /></ScrollPage>} />
          <Route path="/messages/new" element={<ScrollPage><NewConversation /></ScrollPage>} />
          <Route path="/messages/:npub" element={<ChatView />} />
          <Route path="/ratings" element={<EventList />} />

          <Route path="/feeds" element={<FeedsLayout />}>
            <Route path="home" element={<HomeFeed />} />
            <Route path="notes" element={<NotesFeed />} />
            <Route path="profiles" element={<ProfilesFeed />} />
            <Route path="topics" element={<TopicsFeed />}>
              <Route path=":tag" element={<TopicExplorer />} />
            </Route>
            <Route path="polls" index element={<PollFeed />} />
            <Route path="follow-packs" element={<FollowPacksFeed />} />
            <Route path="follow-packs/:naddr" element={<FollowPackDetail />} />
            <Route path="articles" element={<ArticlesFeed />} />
            <Route path="articles/:naddr" element={<ArticleDetail />} />

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
            element={<Navigate to={`/feeds/${localStorage.getItem("pollerama:lastFeed") || "home"}`} replace />}
          />
        </Routes>
        </Box>
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


  // Reconnect relay subscriptions when the app returns from background.
  // WebSocket connections are killed by the OS when backgrounded — especially
  // on mobile/Capacitor where the WebView is aggressively throttled.
  // We use Capacitor's appStateChange on native and visibilitychange on web,
  // and always reconnect on foreground (no idle threshold) so publish never
  // hits a dead connection.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      // Native: Capacitor fires appStateChange reliably on Android/iOS
      let listener: Awaited<ReturnType<typeof CapApp.addListener>> | null = null;
      CapApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) nostrRuntime.reconnect();
      }).then((l) => { listener = l; });
      // Also handle network coming back online (e.g. WiFi → cellular switch)
      const onOnline = () => nostrRuntime.reconnect();
      window.addEventListener("online", onOnline);
      return () => {
        listener?.remove();
        window.removeEventListener("online", onOnline);
      };
    } else {
      // Web: visibilitychange is reliable; reconnect whenever tab becomes visible
      const onVisibilityChange = () => {
        if (!document.hidden) nostrRuntime.reconnect();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("online", () => nostrRuntime.reconnect());
      return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  }, []);

  return (
    <NotificationProvider>
      <AppearanceProvider>
        <DynamicThemeWrapper>
          <AppContextProvider>
            <UserProvider>
              <RelayProvider>
                <RelayHealthProvider>
                <GossipProvider>
                <DMProvider>
                <NostrNotificationsProvider>
                  <TranslationBatchProvider>
                    <ListProvider>
                      <ZapProvider>
                      <RatingProvider>
                        <Nip89Provider>
                        <ReportsProvider>
                        <CssBaseline />
                        <MetadataProvider>
                          <VideoPlayerProvider>
                            <Router>
                              <AndroidNotifications />
                              <FeedScrollProvider>
                                <SubNavProvider>
                                  <AppContent />
                                </SubNavProvider>
                              </FeedScrollProvider>
                              <FloatingVideoPlayer />
                            </Router>
                          </VideoPlayerProvider>
                        </MetadataProvider>
                        </ReportsProvider>
                        </Nip89Provider>
                      </RatingProvider>
                      </ZapProvider>
                    </ListProvider>
                  </TranslationBatchProvider>
                </NostrNotificationsProvider>
                </DMProvider>
                </GossipProvider>
                </RelayHealthProvider>
              </RelayProvider>
            </UserProvider>
          </AppContextProvider>
        </DynamicThemeWrapper>
      </AppearanceProvider>
    </NotificationProvider>
  );
};

// Standalone pages need their own overflow-y:auto container because the global
// layout locks html/body overflow so Virtuoso can be the sole scroller on feeds.
// paddingBottom reserves space for the mobile bottom nav bar.
function ScrollPage({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ height: "100%", overflowY: "auto", pb: { xs: "56px", md: 0 } }}>
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

// Wrapper for the private-note reader. ViewKey lives in the URL fragment so
// it never leaves the browser.
function PrivateNoteWrapper() {
  const { nevent } = useParams();
  if (!nevent) return null;
  return (
    <Box sx={{ height: "100%", overflowY: "auto" }}>
      <PrivateNote neventId={nevent} />
    </Box>
  );
}

export default App;
