import { copyToClipboard } from "../../utils/common";
import React, { useCallback, useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Typography,
  Box,
  CircularProgress,
  Avatar,
  Card,
  Tabs,
  Tab,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip,
  Divider,
} from "@mui/material";
import { Event, EventTemplate, nip19 } from "nostr-tools";
import { useRelays } from "../../hooks/useRelays";
import { fetchUserProfile, signEvent } from "../../nostr";
import { getOutboxRelays } from "../../nostr/OutboxService";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import Rate from "../Ratings/Rate";
import UserPollsFeed from "./UserPollsFeed";
import UserNotesFeed from "./UserNotesFeed";
import UserArticlesFeed from "./UserArticlesFeed";
import UserRatingsGiven from "./UserRatingsGiven";
import { useUserContext } from "../../hooks/useUserContext";
import { useListContext } from "../../hooks/useListContext";
import { pool, nostrRuntime } from "../../singletons";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DownloadIcon from "@mui/icons-material/Download";
import MailIcon from "@mui/icons-material/Mail";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useNotification } from "../../contexts/notification-context";
import { Nip05Badge } from "../Common/Nip05Badge";
import { TextWithImages } from "../Common/Parsers/TextWithImages";
import EditIcon from "@mui/icons-material/Edit";
import LinkIcon from "@mui/icons-material/Link";
import { FeedActionsProvider } from "../../contexts/FeedActionsContext";
import CreateFAB from "../Feed/CreateFAB";
import { ProfileEditModal } from "./ProfileEditModal";
interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`profile-tabpanel-${index}`}
      aria-labelledby={`profile-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 0 }}>{children}</Box>}
    </div>
  );
}

function compactNpub(npub: string): string {
  if (npub.length <= 16) return npub;
  return `${npub.slice(0, 12)}...${npub.slice(-4)}`;
}

const ProfilePage: React.FC = () => {
  const { npubOrNprofile } = useParams<{ npubOrNprofile: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [tabValue, setTabValue] = useState(0);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [followsYou, setFollowsYou] = useState(false);
  const [showContactListWarning, setShowContactListWarning] = useState(false);
  const [pendingFollowKey, setPendingFollowKey] = useState<string | null>(null);
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const followersSetRef = useRef(new Set<string>());
  const { relays } = useRelays();
  const { user, requestLogin, setUser } = useUserContext();
  const { fetchLatestContactList } = useListContext();
  const { showNotification } = useNotification();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const [profileRelays, setProfileRelays] = useState<string[]>(relays);

  const followersHandleRef = useRef<{ unsubscribe: () => void } | null>(null);
  const relaysRef = useRef(relays);
  useEffect(() => { relaysRef.current = relays; }, [relays]);

  // Resolve profile person's outbox relays and merge with user's own relays.
  useEffect(() => {
    if (!pubkey) return;
    setProfileRelays(relays);
    getOutboxRelays(pubkey).then((outbox) => {
      if (outbox.length > 0) {
        setProfileRelays(Array.from(new Set([...relaysRef.current, ...outbox])));
      }
    });
  // Only re-run when pubkey changes; relays are read via relaysRef to avoid churn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey]);

  // Auto-subscribe to following count + follows-you check (lightweight: single contact list).
  useEffect(() => {
    if (!pubkey) return;

    setFollowingCount(null);
    setFollowsYou(false);

    let latestFollowingEvent: Event | null = null;

    const followingHandle = nostrRuntime.subscribe(
      profileRelays,
      [
        {
          kinds: [3],
          authors: [pubkey],
          limit: 1,
        },
      ],
      {
        onEvent: (event: Event) => {
          if (
            !latestFollowingEvent ||
            event.created_at > latestFollowingEvent.created_at
          ) {
            latestFollowingEvent = event;
            const pTags = event.tags.filter((t) => t[0] === "p");
            setFollowingCount(pTags.length);
            if (user && pTags.some((t) => t[1] === user.pubkey)) {
              setFollowsYou(true);
            }
          }
        },
      },
    );

    return () => {
      followingHandle.unsubscribe();
    };
  }, [pubkey, profileRelays, user]);

  // Reset followers state when pubkey changes, clean up any active subscription.
  useEffect(() => {
    followersSetRef.current = new Set();
    setFollowerCount(null);
    followersHandleRef.current?.unsubscribe();
    followersHandleRef.current = null;

    return () => {
      followersHandleRef.current?.unsubscribe();
      followersHandleRef.current = null;
    };
  }, [pubkey, profileRelays]);

  // Manually trigger followers subscription — streams counts as events arrive,
  // only cleaned up on unmount or pubkey change (pool EOSE fires early).
  const loadFollowers = useCallback(() => {
    if (!pubkey || followersHandleRef.current) return;

    followersSetRef.current = new Set();
    setFollowerCount(0);

    followersHandleRef.current = nostrRuntime.subscribe(
      profileRelays,
      [
        {
          kinds: [3],
          "#p": [pubkey],
          limit: 500,
        },
      ],
      {
        onEvent: (event: Event) => {
          followersSetRef.current.add(event.pubkey);
          setFollowerCount(followersSetRef.current.size);
        },
      },
    );
  }, [pubkey, profileRelays]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!npubOrNprofile) {
        setError("No profile identifier provided");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Decode npub or nprofile to get pubkey
        const decoded = nip19.decode(npubOrNprofile);
        let extractedPubkey: string;

        if (decoded.type === "npub") {
          extractedPubkey = decoded.data;
        } else if (decoded.type === "nprofile") {
          extractedPubkey = decoded.data.pubkey;
        } else {
          throw new Error(
            "Invalid profile identifier. Must be npub or nprofile.",
          );
        }

        setPubkey(extractedPubkey);

        // Check cache first to avoid a network round-trip when we already
        // have the profile stored (e.g. navigating back to a previously
        // visited profile).
        const cached = nostrRuntime.query({ kinds: [0], authors: [extractedPubkey] })[0];
        if (cached) {
          setProfile(JSON.parse(cached.content || "{}"));
          setLoading(false);
          return;
        }

        // Not in cache — fetch from relays using the current relay list.
        const profileEvent = await fetchUserProfile(extractedPubkey, relaysRef.current);
        if (profileEvent) {
          setProfile(JSON.parse(profileEvent.content || "{}"));
        }

        setLoading(false);
      } catch (err) {
        console.error("Error loading profile:", err);
        setError(err instanceof Error ? err.message : "Failed to load profile");
        setLoading(false);
      }
    };

    loadProfile();
    // Only re-run when the profile identifier changes, not when relays change.
    // relays are read via relaysRef to avoid double-fetching on relay updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [npubOrNprofile]);

  const addToContacts = async () => {
    if (!user) {
      requestLogin();
      return;
    }

    if (!pubkey) return;

    const contactEvent = await fetchLatestContactList();

    if (!contactEvent) {
      setPendingFollowKey(pubkey);
      setShowContactListWarning(true);
      return;
    }

    await updateContactList(contactEvent, pubkey);
  };

  const updateContactList = async (
    contactEvent: Event | null,
    pubkeyToAdd: string,
  ) => {
    const existingTags = contactEvent?.tags || [];
    const pTags = existingTags.filter(([t]) => t === "p").map(([, pk]) => pk);

    if (pTags.includes(pubkeyToAdd)) return;

    const updatedTags = [...existingTags, ["p", pubkeyToAdd]];

    const newEvent: EventTemplate = {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags: updatedTags,
      content: contactEvent?.content || "",
    };

    const signed = await signEvent(newEvent);
    pool.publish(relays, signed);
    setUser({
      pubkey: signed.pubkey,
      ...user,
      follows: [...pTags, pubkeyToAdd],
    });
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "400px",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error || !pubkey) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="error" variant="h6">
          {error || "Failed to load profile"}
        </Typography>
      </Box>
    );
  }

  const npub = nip19.npubEncode(pubkey);
  const isOwnProfile = user?.pubkey === pubkey;

  return (
    <FeedActionsProvider>
      <Box
        ref={scrollContainerRef}
        maxWidth={800}
        mx="auto"
      sx={{
        px: 2,
        py: { xs: 2, sm: 4 },
        height: "100%",
        overflowY: "auto",
      }}
    >
      {/* Profile Header */}
      <Card sx={{ mb: 3, overflow: "visible" }}>
        {/* Banner */}
        <Box
          sx={{
            height: 120,
            borderRadius: "4px 4px 0 0",
            background: profile?.banner
              ? `url(${profile.banner}) center/cover no-repeat`
              : "linear-gradient(135deg, #FAD13F 0%, transparent 100%)",
          }}
        />

        {/* Identity section */}
        <Box sx={{ px: { xs: 2, sm: 3 }, pb: 2 }}>
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              alignItems: { xs: "center", sm: "flex-start" },
              gap: 2,
              mt: "-40px",
            }}
          >
            {/* Avatar overlapping banner */}
            <Avatar
              src={profile?.picture || DEFAULT_IMAGE_URL}
              alt={profile?.name || "Profile"}
              sx={{
                width: 80,
                height: 80,
                border: "3px solid white",
                boxShadow: 1,
                flexShrink: 0,
              }}
            />

            {/* Name, nip05, npub */}
            <Box
              sx={{
                flex: 1,
                textAlign: { xs: "center", sm: "left" },
                mt: { xs: 0, sm: "44px" },
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  justifyContent: { xs: "center", sm: "flex-start" },
                  flexWrap: "wrap",
                }}
              >
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                  {profile?.name || profile?.username || "Unnamed"}
                </Typography>
                {followsYou && (
                  <Chip label="Follows you" size="small" variant="outlined" />
                )}
              </Box>

              {profile?.nip05 && (
                <Nip05Badge nip05={profile.nip05} pubkey={pubkey} variant="body2" />
              )}

              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  justifyContent: { xs: "center", sm: "flex-start" },
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: "monospace" }}
                >
                  {compactNpub(npub)}
                </Typography>
                <Tooltip title="Copy npub">
                  <IconButton
                    size="small"
                    onClick={() => {
                      copyToClipboard(npub);
                      showNotification("npub copied to clipboard", "success");
                    }}
                  >
                    <ContentCopyIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </Box>

          {/* Action buttons */}
          <Box
            sx={{
              display: "flex",
              gap: 1,
              mt: 2,
              justifyContent: { xs: "center", sm: "flex-start" },
            }}
          >
            {isOwnProfile ? (
              <Button
                variant="outlined"
                size="small"
                onClick={() => setEditModalOpen(true)}
              >
                Edit Profile
              </Button>
            ) : user ? (
              <>
                {user.follows?.includes(pubkey) ? (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<CheckCircleIcon />}
                    disableElevation
                  >
                    Following
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    size="small"
                    onClick={addToContacts}
                  >
                    {followsYou ? "Follow Back" : "Follow"}
                  </Button>
                )}
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<MailIcon />}
                  onClick={() => navigate(`/messages/${npub}`)}
                >
                  Message
                </Button>
              </>
            ) : null}
          </Box>

          {/* Bio */}
          {profile?.about && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="body2" color="text.secondary" component="div">
                <TextWithImages content={profile.about} />
              </Typography>
            </>
          )}

          {/* Website */}
          {profile?.website && (
            <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 0.5 }}>
              <LinkIcon fontSize="small" color="action" />
              <Typography
                variant="body2"
                component="a"
                href={
                  profile.website.startsWith("http")
                    ? profile.website
                    : `https://${profile.website}`
                }
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  color: "primary.main",
                  textDecoration: "none",
                  "&:hover": { textDecoration: "underline" },
                }}
              >
                {profile.website.replace(/^https?:\/\//, "")}
              </Typography>
            </Box>
          )}

          {/* Stats + Rate */}
          <Divider sx={{ my: 2 }} />
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              mb: 1,
              justifyContent: { xs: "center", sm: "flex-start" },
            }}
          >
            {followerCount !== null ? (
              <Typography variant="body2" color="text.secondary">
                <strong>{followerCount}</strong> followers
              </Typography>
            ) : (
              <Tooltip title="Load followers">
                <IconButton size="small" onClick={loadFollowers}>
                  <DownloadIcon sx={{ fontSize: 18 }} />{" "}
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    style={{ marginLeft: 2 }}
                  >
                    followers{" "}
                  </Typography>
                </IconButton>
              </Tooltip>
            )}
            <Typography variant="body2" color="text.secondary">
              <strong>{followingCount ?? "–"}</strong> following
            </Typography>
          </Box>
          <Rate entityId={pubkey} entityType="profile" />
        </Box>
      </Card>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="profile tabs"
          variant="fullWidth"
        >
          <Tab label="Polls" />
          <Tab label="Notes" />
          <Tab label="Articles" />
          <Tab label="Ratings" />
        </Tabs>
      </Box>

      {/* Tab Content */}
      <TabPanel value={tabValue} index={0}>
        <UserPollsFeed
          pubkey={pubkey}
          relays={profileRelays}
          scrollContainerRef={scrollContainerRef}
        />
      </TabPanel>
      <TabPanel value={tabValue} index={1}>
        <UserNotesFeed
          pubkey={pubkey}
          relays={profileRelays}
          scrollContainerRef={scrollContainerRef}
        />
      </TabPanel>
      <TabPanel value={tabValue} index={2}>
        <UserArticlesFeed
          pubkey={pubkey}
          relays={profileRelays}
          scrollContainerRef={scrollContainerRef}
        />
      </TabPanel>
      <TabPanel value={tabValue} index={3}>
        <UserRatingsGiven
          pubkey={pubkey}
          relays={profileRelays}
          scrollContainerRef={scrollContainerRef}
        />
      </TabPanel>

      <Dialog
        open={showContactListWarning}
        onClose={() => setShowContactListWarning(false)}
      >
        <DialogTitle>Warning</DialogTitle>
        <DialogContent>
          <Typography>
            We couldn't find your existing contact list. If you continue, your
            follow list will only contain this person.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowContactListWarning(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (pendingFollowKey) {
                updateContactList(null, pendingFollowKey);
              }
              setShowContactListWarning(false);
              setPendingFollowKey(null);
            }}
            color="primary"
            variant="contained"
          >
            Continue Anyway
          </Button>
        </DialogActions>
      </Dialog>
      </Box>

      {/* FAB with custom Profile actions */}
      <CreateFAB
        extraActions={
          isOwnProfile
            ? [
                {
                  icon: <EditIcon />,
                  name: "Edit Profile",
                  onClick: () => setEditModalOpen(true),
                },
              ]
            : []
        }
      />

      {/* Profile Edit Modal */}
      <ProfileEditModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        userProfile={profile}
      />
    </FeedActionsProvider>
  );
};

export default ProfilePage;
