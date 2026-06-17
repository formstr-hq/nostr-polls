import React, { useEffect, useState, useRef, useCallback } from "react";
import { Event, Filter } from "nostr-tools";
import { useRelays } from "../../../hooks/useRelays";
import { useNavigate, Outlet, useParams } from "react-router-dom";
import {
  Typography,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  DialogActions,
  Button,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { nostrRuntime } from "../../../singletons";
import { Virtuoso } from "react-virtuoso";
import TopicCard from "./TopicsCard";
import { useListContext } from "../../../hooks/useListContext";
import MyTopicsFeed from "./MyTopicsFeed";
import { useUserContext } from "../../../hooks/useUserContext";
import { useSubNav } from "../../../contexts/SubNavContext";
import { useGossipContext } from "../../../contexts/GossipContext";
import { useBackClose } from "../../../hooks/useBackClose";
import { useFeedActions } from "../../../contexts/FeedActionsContext";

const TopicsFeed: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"discover" | "myTopics" | "interests">(() => {
    const saved = localStorage.getItem("pollerama:lastTopicsTab");
    return (saved === "discover" || saved === "myTopics") ? saved : "interests";
  });
  const [tagsMap, setTagsMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [metadataMap, setMetadataMap] = useState<Map<string, Event>>(new Map());
  const [refreshKey, setRefreshKey] = useState(0);
  // Ref to the "My Interests" feed's refresh function (registered by MyTopicsFeed)
  const interestsRefreshRef = useRef<(() => void) | undefined>(undefined);

  const { relays } = useRelays();
  const { myTopics } = useListContext();
  const navigate = useNavigate();
  const { tag } = useParams();
  const { user, requestLogin } = useUserContext();
  const subsRef = useRef<ReturnType<typeof nostrRuntime.subscribe>[]>([]);
  const isMounted = useRef(true);
  const { setItems, clearItems } = useSubNav();
  const { registerRefresh } = useFeedActions();
  const { networkInterests } = useGossipContext();
  const handleCloseSearch = () => setSearchOpen(false);
  useBackClose(searchOpen, handleCloseSearch);

  const handleTabChange = useCallback((tab: "discover" | "myTopics" | "interests") => {
    localStorage.setItem("pollerama:lastTopicsTab", tab);
    setActiveTab(tab);
  }, []);

  useEffect(() => {
    setItems([
      {
        key: "interests",
        label: "Interests feed",
        active: activeTab === "interests",
        onClick: () => handleTabChange("interests"),
      },
      {
        key: "myTopics",
        label: "my topics",
        active: activeTab === "myTopics",
        onClick: () => handleTabChange("myTopics"),
      },
      {
        key: "discover",
        label: "discover topics",
        active: activeTab === "discover",
        onClick: () => handleTabChange("discover"),
      },
    ]);
    return () => clearItems();
  }, [activeTab, setItems, clearItems, handleTabChange]);

  function parseRatingDTag(dTagValue: string): { type: string; id: string } {
    const parts = dTagValue.split(":");
    const cleanTag =
      parts.length === 2
        ? parts[1].startsWith("#")
          ? parts[1].slice(1)
          : parts[1]
        : parts[0];

    return {
      type: parts.length === 2 ? parts[0] : "event",
      id: cleanTag,
    };
  }

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      isMounted.current = false;
      subsRef.current.forEach((s) => s.unsubscribe());
      subsRef.current = [];
    };
  }, []);
  useEffect(() => {
    if (tagsMap.size === 0 || relays.length === 0) return;
    const filter: Filter = {
      kinds: [30300],
      "#d": Array.from(tagsMap.keys()).map((tag) => `hashtag:${tag}`),
    };

    const sub = nostrRuntime.subscribe(relays, [filter], {
      onEvent: (event) => {
        const dTag = event.tags.find((t) => t[0] === "d");
        if (!dTag || !dTag[1].startsWith("hashtag:")) return;

        const topicName = dTag[1].split(":")[1];
        setMetadataMap((prev) => {
          if (prev.has(topicName)) return prev;
          const updated = new Map(prev);
          updated.set(topicName, event);
          return updated;
        });
      },
    });

    return () => sub.unsubscribe();
  }, [relays, tagsMap]);

  useEffect(() => {
    // If a specific tag is selected or no relays, don't fetch topics
    if (tag || relays.length === 0) return;

    setLoading(true);
    setTagsMap(new Map()); // clear on refresh

    subsRef.current.forEach((s) => s.unsubscribe());
    subsRef.current = [];

    // On manual retry, close stale WebSockets so we re-handshake — mobile NAT
    // often kills connections silently and pool.close() alone isn't enough.
    const fresh = refreshKey > 0;

    const upsertTag = (id: string, ts: number) => {
      setTagsMap((prev) => {
        const current = prev.get(id) || 0;
        if (ts <= current) return prev;
        const updated = new Map(prev);
        updated.set(id, ts);
        return updated;
      });
    };

    // Primary source: rating events for hashtags
    const ratingSub = nostrRuntime.subscribe(
      relays,
      [{ kinds: [34259], "#m": ["hashtag"], limit: 100 }],
      {
        onEvent: (event: Event) => {
          setLoading(false);
          const dTag = event.tags.find((t) => t[0] === "d");
          const parsedDTag = dTag ? parseRatingDTag(dTag[1]) : null;
          if (parsedDTag && parsedDTag.type === "hashtag") {
            upsertTag(parsedDTag.id, event.created_at);
          }
        },
        onEose: () => {
          if (isMounted.current) setLoading(false);
        },
        fresh,
      }
    );

    // Fallback source: interest sets (NIP-51 kind 10015) from the network.
    // Many users curate hashtags here even when they don't rate them, so this
    // surfaces topics even on sparse relays.
    const interestsSub = nostrRuntime.subscribe(
      relays,
      [{ kinds: [10015], limit: 100 }],
      {
        onEvent: (event: Event) => {
          setLoading(false);
          for (const tagArr of event.tags) {
            if (tagArr[0] !== "t" || !tagArr[1]) continue;
            const id = tagArr[1].toLowerCase().trim();
            if (id) upsertTag(id, event.created_at);
          }
        },
        fresh,
      }
    );

    subsRef.current = [ratingSub, interestsSub];

    // Stop the spinner after 5s even if EOSE never arrives, but keep the
    // subscriptions open so late events on slow mobile networks still arrive.
    const timeout = setTimeout(() => {
      if (isMounted.current) setLoading(false);
    }, 5000);

    return () => {
      clearTimeout(timeout);
      subsRef.current.forEach((s) => s.unsubscribe());
      subsRef.current = [];
    };
  }, [tag, relays, refreshKey]); // refreshKey forces a re-fetch on manual refresh

  const handleRefresh = useCallback(() => {
    if (activeTab === "interests") {
      interestsRefreshRef.current?.();
    } else {
      setRefreshKey((k) => k + 1);
    }
  }, [activeTab]);

  useEffect(() => {
    registerRefresh(handleRefresh);
  }, [registerRefresh, handleRefresh]);

  const handleSearchSubmit = () => {
    if (searchTerm.trim()) {
      setSearchOpen(false);
      navigate(`/feeds/topics/${searchTerm.trim()}`);
    }
  };
  const myTopicsList = Array.from(myTopics || []);

  if (tag) return <Outlet />;

  const tags = Array.from(tagsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  const displayTags = activeTab === "discover" ? tags : myTopicsList;

  return (
    <Box
      sx={{
        px: { xs: 0, sm: 2 },
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {activeTab !== "interests" && (
        <Box sx={{ flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
          <IconButton onClick={() => setSearchOpen(true)} aria-label="Search topics">
            <SearchIcon />
          </IconButton>
        </Box>
      )}

      <Box sx={{ flexGrow: 1, minHeight: 0 }}>
        {activeTab === "interests" ? (
          <MyTopicsFeed
            onNavigateToDiscover={() => handleTabChange("discover")}
            onSearchClick={() => setSearchOpen(true)}
            onRegisterRefresh={(fn) => { interestsRefreshRef.current = fn; }}
          />
        ) : loading && activeTab === "discover" ? (
          // Loading state for discover tab
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : displayTags.length === 0 ? (
          activeTab === "discover" ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                mt: 4,
                gap: 2,
              }}
            >
              <Typography color="text.secondary">
                No topics found yet.
              </Typography>
              <Button variant="outlined" onClick={handleRefresh}>
                Retry
              </Button>
            </Box>
          ) : !user ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                mt: 4,
                gap: 2,
              }}
            >
              <Typography variant="body1" color="text.secondary">
                Login to see your interests
              </Typography>
              <Button variant="contained" onClick={requestLogin}>
                Login
              </Button>
            </Box>
          ) : (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                mt: 4,
                gap: 2,
              }}
            >
              <Typography variant="body1" color="text.secondary">
                You haven't added any interests yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Discover topics in the "Recently Rated" tab and add them to your interests
              </Typography>
              <Button variant="contained" onClick={() => setActiveTab("discover")}>
                Browse Topics
              </Button>
            </Box>
          )
        ) : (
          // Show list of topic cards for discover / myTopics
          <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
            {/* Network interests from gossip relays — shown in discover tab only */}
            {activeTab === "discover" && networkInterests.length > 0 && (
              <Box sx={{ px: 1, pt: 1, pb: 0.5, flexShrink: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  Popular in your network
                </Typography>
                <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                  {networkInterests.slice(0, 20).map((interest) => (
                    <Chip
                      key={interest}
                      label={`#${interest}`}
                      size="small"
                      variant="outlined"
                      color="primary"
                      clickable
                      onClick={() => navigate(`/feeds/topics/${interest}`)}
                    />
                  ))}
                </Box>
              </Box>
            )}
            <Box sx={{ flexGrow: 1, minHeight: 0 }}>
              <Virtuoso
                data={displayTags}
                itemContent={(index, tag) => (
                  <TopicCard tag={tag} metadataEvent={metadataMap.get(tag)} />
                )}
                style={{ height: "100%", width: "100%" }}
              />
            </Box>
          </Box>
        )}
      </Box>

      <Dialog open={searchOpen} onClose={() => setSearchOpen(false)} fullWidth>
        <DialogTitle>Search Topic</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Enter topic name"
            fullWidth
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearchSubmit();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSearchOpen(false)}>Cancel</Button>
          <Button onClick={handleSearchSubmit}>Search</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TopicsFeed;
