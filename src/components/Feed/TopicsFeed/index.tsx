import React, { useEffect, useState, useRef } from "react";
import { Event, Filter } from "nostr-tools";
import { useRelays } from "../../../hooks/useRelays";
import { useNavigate, Outlet, useParams } from "react-router-dom";
import {
  Typography,
  Box,
  CircularProgress,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  DialogActions,
  Button,
  Tabs,
  Tab,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { nostrRuntime } from "../../../singletons";
import { Virtuoso } from "react-virtuoso";
import TopicCard from "./TopicsCard";
import { useListContext } from "../../../hooks/useListContext";
import MyTopicsFeed from "./MyTopicsFeed";
import { useUserContext } from "../../../hooks/useUserContext";
import { useFeedScroll } from "../../../contexts/FeedScrollContext";

const TopicsFeed: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    "discover" | "myTopics" | "interests"
  >("interests");
  const { headerProgress } = useFeedScroll();
  const [tagsMap, setTagsMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [metadataMap, setMetadataMap] = useState<Map<string, Event>>(new Map());

  const theme = useTheme();

  const { relays } = useRelays();
  const { myTopics } = useListContext();
  const navigate = useNavigate();
  const { tag } = useParams();
  const { user, requestLogin } = useUserContext();
  const subRef = useRef<ReturnType<typeof nostrRuntime.subscribe> | null>(null);
  const isMounted = useRef(true);
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

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
      if (subRef.current) {
        subRef.current.unsubscribe();
        subRef.current = null;
      }
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

    if (subRef.current) {
      subRef.current.unsubscribe();
      subRef.current = null;
    }

    // Subscribe once
    const sub = nostrRuntime.subscribe(
      relays,
      [{ kinds: [34259], "#m": ["hashtag"], limit: 100 }],
      {
        onEvent: (event: Event) => {
          setLoading(false);
          const dTag = event.tags.find((t) => t[0] === "d");
          const parsedDTag = dTag ? parseRatingDTag(dTag[1]) : null;

          if (parsedDTag && parsedDTag.type === "hashtag") {
            const id = parsedDTag.id;

            setTagsMap((prev) => {
              const currentTimestamp = prev.get(id) || 0;
              if (event.created_at > currentTimestamp) {
                const updated = new Map(prev);
                updated.set(id, event.created_at);
                return updated;
              }
              return prev;
            });
          }
        },
        onEose: () => {
          if (isMounted.current) setLoading(false);
        },
      }
    );

    subRef.current = sub;

    // Timeout to stop loading even if no onEose event
    const timeout = setTimeout(() => {
      if (isMounted.current) setLoading(false);
      if (subRef.current) {
        subRef.current.unsubscribe();
        subRef.current = null;
      }
    }, 5000);

    return () => {
      clearTimeout(timeout);
      if (subRef.current) {
        subRef.current.unsubscribe();
        subRef.current = null;
      }
    };
  }, [tag, relays]);

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
        px: 2,
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        sx={{
          overflow: "hidden",
          height: Math.max(0, 64 * (1 - headerProgress)),
          opacity: 1 - headerProgress,
        }}
      >
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="flex-start"
        >
          <Tabs
            value={activeTab}
            onChange={(_, newValue) => setActiveTab(newValue)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              mb: 2,
              borderBottom: `1px solid ${theme.palette.divider}`,
              "& .MuiTab-root": {
                textTransform: "none",
                minWidth: isMobile ? 80 : 120,
                fontWeight: 500,
              },
            }}
          >
            <Tab
              label="Notes from Interests"
              value="interests"
              sx={{ py: 0, textTransform: "none" }}
            />
            <Tab
              label="My Interests"
              value="myTopics"
              sx={{ py: 0, textTransform: "none" }}
            />
            <Tab
              label="Recently Rated"
              value="discover"
              sx={{ py: 0, textTransform: "none" }}
            />
          </Tabs>
          <IconButton
            onClick={() => setSearchOpen(true)}
            aria-label="Search topics"
            sx={{ mt: -1 }}
          >
            <SearchIcon />
          </IconButton>
        </Box>
      </Box>

      <Box sx={{ flexGrow: 1, minHeight: 0 }}>
        {activeTab === "interests" ? (
          <MyTopicsFeed onNavigateToDiscover={() => setActiveTab("discover")} />
        ) : loading && activeTab === "discover" ? (
          // Loading state for discover tab
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : displayTags.length === 0 ? (
          activeTab === "discover" ? (
            <Typography color="text.secondary" sx={{ textAlign: "center", mt: 4 }}>
              No topics found yet.
            </Typography>
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
          <Virtuoso
            data={displayTags}
            itemContent={(index, tag) => (
              <TopicCard tag={tag} metadataEvent={metadataMap.get(tag)} />
            )}
            style={{ height: "100%", width: "100%" }}
          />
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
