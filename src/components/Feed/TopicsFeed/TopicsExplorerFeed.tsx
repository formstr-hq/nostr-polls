import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Typography,
  Tabs,
  Tab,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  SelectChangeEvent,
  IconButton,
} from "@mui/material";
import { ArrowBack } from "@mui/icons-material";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import FavoriteIcon from "@mui/icons-material/Favorite";
import { useNavigate, useParams } from "react-router-dom";
import { Event, SimplePool } from "nostr-tools";
import { useUserContext } from "../../../hooks/useUserContext";
import { useRelays } from "../../../hooks/useRelays";
import { Notes } from "../../Notes";
import PollResponseForm from "../../PollResponse/PollResponseForm";
import Rate from "../../../components/Ratings/Rate";
import UnifiedFeed from "../UnifiedFeed";
import OverlappingAvatars from "../../../components/Common/OverlappingAvatars";
import { signEvent } from "../../../nostr";
import { pool, nostrRuntime } from "../../../singletons";
import { useMetadata } from "../../../hooks/MetadataProvider";
import { selectBestMetadataEvent } from "../../../utils/utils";
import {
  loadModeratorPrefs,
  saveModeratorPrefs,
} from "../../../utils/localStorage";
import ModeratorSelectorDialog from "../../../components/Moderator/ModeratorSelectorDialog";
import { useListContext } from "../../../hooks/useListContext";
import { signerManager } from "../../../singletons/Signer/SignerManager";

const OFFTOPIC_KIND = 1011;

const TopicExplorer: React.FC = () => {
  const { tag } = useParams<{ tag: string }>();
  const { relays } = useRelays();
  const { user, requestLogin } = useUserContext();
  const { metadata } = useMetadata();
  const { myTopics, addTopicToMyTopics, removeTopicFromMyTopics } =
    useListContext();
  const navigate = useNavigate();

  const [tabValue, setTabValue] = useState<0 | 1>(0);
  const [feedMode, setFeedMode] = useState<
    "unfiltered" | "global" | "contacts"
  >("global");
  const [notesEvents, setNotesEvents] = useState<Event[]>([]);
  const [pollsEvents, setPollsEvents] = useState<Event[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingPolls, setLoadingPolls] = useState(false);
  const [isAddingToMyTopics, setIsAddingToMyTopics] = useState(false);

  const curatedByMap = useRef<Map<string, Map<string, string>>>(new Map()); // noteId -> (moderatorPubkey -> moderationEventId)
  const [curatedIds, setCuratedIds] = useState<Set<string>>(new Set());
  const [showAnywaySet, setShowAnywaySet] = useState<Set<string>>(new Set());

  const seenNoteIds = useRef<Set<string>>(new Set());
  const seenPollIds = useRef<Set<string>>(new Set());
  const blockedUsersMap = useRef<Map<string, Map<string, string>>>(new Map()); // targetPubkey -> (moderatorPubkey -> moderationEventId)
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const deletedModerationIds = useRef<Set<string>>(new Set());
  const [moderationVersion, setModerationVersion] = useState(0);
  const [moderatorDialogOpen, setModeratorDialogOpen] = useState(false);
  const [visibleModerators, setVisibleModerators] = useState<string[]>([]);

  const topicMetadataEvent = useMemo(() => {
    const events = metadata.get(tag ?? "") ?? [];
    return selectBestMetadataEvent(events, user?.follows);
  }, [metadata, tag, user?.follows]);

  const isInMyTopics = myTopics?.has(tag ?? "") ?? false;

  const tagMap: Record<string, string> = {};
  topicMetadataEvent?.tags.forEach(([key, val]) => {
    if (key && val) tagMap[key] = val;
  });

  const topicImage = tagMap["image"];
  const topicDescription = tagMap["description"];

  const toggleShowAnyway = (id: string) => {
    setShowAnywaySet((prev) => {
      const updated = new Set(prev);
      if (updated.has(id)) {
        updated.delete(id);
      } else {
        updated.add(id);
      }
      return updated;
    });
  };

  const handleAddToMyTopics = async () => {
    if (!user) {
      requestLogin();
      return;
    }

    if (!tag) return;

    setIsAddingToMyTopics(true);
    try {
      await signerManager.getSigner();
      await addTopicToMyTopics(tag);
    } catch (error) {
      console.error("Failed to add topic to my topics:", error);
    } finally {
      setIsAddingToMyTopics(false);
    }
  };

  const handleRemoveFromMyTopics = async () => {
    if (!user) {
      requestLogin();
      return;
    }

    if (!tag) return;

    try {
      await signerManager.getSigner();
      await removeTopicFromMyTopics(tag);
    } catch (error) {
      console.error("Failed to remove topic:", error);
    }
  };

  const allModerators = useMemo(() => {
    const modSet = new Set<string>();
    curatedByMap.current.forEach((curators) => {
      curators.forEach((eventId, pubkey) => {
        if (!deletedModerationIds.current.has(eventId)) {
          modSet.add(pubkey);
        }
      });
    });
    blockedUsersMap.current.forEach((blockers) => {
      blockers.forEach((eventId, pubkey) => {
        if (!deletedModerationIds.current.has(eventId)) {
          modSet.add(pubkey);
        }
      });
    });
    return Array.from(modSet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curatedIds, blockedUserIds, moderationVersion]);

  useEffect(() => {
    if (!tag) return;
    setVisibleModerators(loadModeratorPrefs(tag, allModerators));
  }, [tag, allModerators]);

  const handleModerationEvent = async (
    noteEvent: Event,
    type: "off-topic" | "remove-user",
  ) => {
    if (!user) return requestLogin();
    if (!tag) return;

    const tags = [
      ["t", tag],
      type === "off-topic" ? ["e", noteEvent.id] : ["p", noteEvent.pubkey],
    ];

    const unsignedEvent = {
      kind: OFFTOPIC_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content:
        type === "off-topic"
          ? "Marked as off-topic"
          : "Removed user from topic",
      pubkey: user.pubkey,
    };

    const signed = await signEvent(unsignedEvent);
    await pool.publish(relays, signed);

    if (type === "off-topic") {
      if (!curatedByMap.current.has(noteEvent.id)) {
        curatedByMap.current.set(noteEvent.id, new Map());
      }
      curatedByMap.current.get(noteEvent.id)!.set(user.pubkey, signed.id);
      setCuratedIds(new Set(curatedByMap.current.keys()));
    } else {
      const blocked = blockedUsersMap.current;
      if (!blocked.has(noteEvent.pubkey)) {
        blocked.set(noteEvent.pubkey, new Map());
      }
      blocked.get(noteEvent.pubkey)!.set(user.pubkey, signed.id);
      setBlockedUserIds(new Set(blocked.keys()));
    }
  };

  const handleUnmoderationEvent = async (
    noteEvent: Event,
    type: "off-topic" | "remove-user",
  ) => {
    if (!user) return requestLogin();
    if (!tag) return;

    let moderationEventId: string | undefined;
    if (type === "off-topic") {
      moderationEventId = curatedByMap.current
        .get(noteEvent.id)
        ?.get(user.pubkey);
    } else {
      moderationEventId = blockedUsersMap.current
        .get(noteEvent.pubkey)
        ?.get(user.pubkey);
    }

    if (
      !moderationEventId ||
      deletedModerationIds.current.has(moderationEventId)
    )
      return;

    const signed = await signEvent({
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["e", moderationEventId],
        ["k", String(OFFTOPIC_KIND)],
      ],
      content: "Undo moderation",
    });

    await pool.publish(relays, signed);

    // Optimistic local update
    deletedModerationIds.current.add(moderationEventId);
    if (type === "off-topic") {
      curatedByMap.current.get(noteEvent.id)?.delete(user.pubkey);
    } else {
      blockedUsersMap.current.get(noteEvent.pubkey)?.delete(user.pubkey);
    }
    setCuratedIds(new Set(curatedByMap.current.keys()));
    setBlockedUserIds(new Set(blockedUsersMap.current.keys()));
    setModerationVersion((v) => v + 1);
  };

  const subRef = useRef<ReturnType<SimplePool["subscribeMany"]> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!tag || relays.length === 0) return;

    subRef.current?.close();

    const filters = [
      { kinds: [OFFTOPIC_KIND], "#t": [tag], limit: 200 },
      { kinds: [1], "#t": [tag], limit: 50 },
      { kinds: [1068], "#t": [tag], limit: 50 },
      { kinds: [5], "#k": [String(OFFTOPIC_KIND)], limit: 500 },
    ];

    const handle = nostrRuntime.subscribe(relays, filters, {
      onEvent: (event: Event) => {
        if (event.kind === 5) {
          const targetIds = new Set(
            event.tags.filter((t) => t[0] === "e").map((t) => t[1]),
          );

          let changed = false;
          curatedByMap.current.forEach((moderators) => {
            moderators.forEach((eventId, pubkey) => {
              if (targetIds.has(eventId) && pubkey === event.pubkey) {
                moderators.delete(pubkey);
                changed = true;
              }
            });
          });
          blockedUsersMap.current.forEach((moderators) => {
            moderators.forEach((eventId, pubkey) => {
              if (targetIds.has(eventId) && pubkey === event.pubkey) {
                moderators.delete(pubkey);
                changed = true;
              }
            });
          });
          targetIds.forEach((id) => deletedModerationIds.current.add(id));

          if (changed) {
            setCuratedIds(new Set(curatedByMap.current.keys()));
            setBlockedUserIds(new Set(blockedUsersMap.current.keys()));
            setModerationVersion((v) => v + 1);
          }
          return;
        }

        if (event.kind === OFFTOPIC_KIND) {
          if (deletedModerationIds.current.has(event.id)) return;

          const eTags = event.tags.filter((t) => t[0] === "e").map((t) => t[1]);
          for (const e of eTags) {
            if (!curatedByMap.current.has(e)) {
              curatedByMap.current.set(e, new Map());
            }
            curatedByMap.current.get(e)!.set(event.pubkey, event.id);
          }

          const pTags = event.tags.filter((t) => t[0] === "p").map((t) => t[1]);
          for (const pubkey of pTags) {
            if (!blockedUsersMap.current.has(pubkey)) {
              blockedUsersMap.current.set(pubkey, new Map());
            }
            blockedUsersMap.current.get(pubkey)!.set(event.pubkey, event.id);
          }

          setCuratedIds(new Set(curatedByMap.current.keys()));
          setBlockedUserIds(new Set(blockedUsersMap.current.keys()));
          return;
        }

        if (event.kind === 1 && !seenNoteIds.current.has(event.id)) {
          seenNoteIds.current.add(event.id);
          setNotesEvents((prev) => [...prev, event]);
        }

        if (event.kind === 1068 && !seenPollIds.current.has(event.id)) {
          seenPollIds.current.add(event.id);
          setPollsEvents((prev) => [...prev, event]);
        }
      },
    });

    // Store reference for cleanup
    subRef.current = {
      close: () => handle.unsubscribe(),
    };

    // Handle loading state after timeout
    setTimeout(() => {
      setLoadingNotes(false);
      setLoadingPolls(false);
    }, 3000);

    return () => {
      if (subRef.current) {
        subRef.current.close();
      }
    };
  }, [tag, relays]);

  const sortedEvents = useMemo(() => {
    const base = tabValue === 0 ? notesEvents : pollsEvents;
    return base.sort((a, b) => b.created_at - a.created_at);
  }, [tabValue, notesEvents, pollsEvents]);

  const loading = tabValue === 0 ? loadingNotes : loadingPolls;

  const itemContent = useMemo(
    () => (_: any, event: Event) => {
      const curatorMap =
        curatedByMap.current.get(event.id) ?? new Map<string, string>();

      // Get active (non-deleted) curator pubkeys
      const activeCurators: string[] = [];
      curatorMap.forEach((eventId, pubkey) => {
        if (!deletedModerationIds.current.has(eventId)) {
          activeCurators.push(pubkey);
        }
      });

      // Filter curators based on feed mode
      const visibleCurators =
        feedMode === "contacts" && user?.follows
          ? activeCurators.filter((id) => user.follows!.includes(id))
          : activeCurators;

      // Check if the user has active blocked-user moderations
      const blockerMap =
        blockedUsersMap.current.get(event.pubkey) ?? new Map<string, string>();
      const activeBlockers: string[] = [];
      blockerMap.forEach((eventId, pubkey) => {
        if (!deletedModerationIds.current.has(eventId)) {
          activeBlockers.push(pubkey);
        }
      });

      const isUserBlocked =
        feedMode !== "unfiltered" &&
        activeBlockers.length > 0 &&
        !showAnywaySet.has(event.id);

      const isHidden =
        (feedMode !== "unfiltered" &&
          visibleCurators.length > 0 &&
          !showAnywaySet.has(event.id)) ||
        isUserBlocked;

      // Check if current user has active moderations on this note
      const userHasOffTopic = user?.pubkey
        ? (() => {
            const eid = curatorMap.get(user.pubkey);
            return eid ? !deletedModerationIds.current.has(eid) : false;
          })()
        : false;
      const userHasBlockedUser = user?.pubkey
        ? (() => {
            const eid = blockerMap.get(user.pubkey);
            return eid ? !deletedModerationIds.current.has(eid) : false;
          })()
        : false;

      let showReason: React.ReactNode;

      if (visibleCurators.length > 0) {
        showReason = (
          <Box>
            <Typography style={{ margin: 10 }}>
              Marked as off-topic by:
            </Typography>
            <OverlappingAvatars ids={visibleCurators} maxAvatars={3} />
            <Button
              size="small"
              variant="text"
              sx={{ mt: 1 }}
              onClick={() => toggleShowAnyway(event.id)}
            >
              <Typography style={{ marginTop: 10 }}>Show Anyway</Typography>
            </Button>
          </Box>
        );
      } else if (isUserBlocked) {
        const visibleBlockers =
          feedMode === "contacts" && user?.follows
            ? activeBlockers.filter((id) => user.follows!.includes(id))
            : activeBlockers;

        if (visibleBlockers.length > 0) {
          showReason = (
            <Box>
              <Typography style={{ margin: 10 }}>
                User removed from topic by:
              </Typography>
              <OverlappingAvatars ids={visibleBlockers} maxAvatars={3} />
              <Button
                size="small"
                variant="text"
                sx={{ mt: 1 }}
                onClick={() => toggleShowAnyway(event.id)}
              >
                <Typography style={{ marginTop: 10 }}>Show Anyway</Typography>
              </Button>
            </Box>
          );
        } else {
          showReason = (
            <Box>
              <Typography style={{ margin: 10 }}>
                User removed from this topic.
              </Typography>
              <Button
                size="small"
                variant="text"
                sx={{ mt: 1 }}
                onClick={() => toggleShowAnyway(event.id)}
              >
                <Typography style={{ marginTop: 10 }}>Show Anyway</Typography>
              </Button>
            </Box>
          );
        }
      }

      return (
        <Box sx={{ position: "relative" }}>
          {event.kind === 1 ? (
            <Notes
              event={event}
              hidden={isHidden}
              showReason={showReason}
              extras={
                <>
                  {userHasOffTopic ? (
                    <MenuItem
                      onClick={() =>
                        handleUnmoderationEvent(event, "off-topic")
                      }
                    >
                      Unmark Off-Topic
                    </MenuItem>
                  ) : (
                    <MenuItem
                      onClick={() => handleModerationEvent(event, "off-topic")}
                    >
                      Mark Off-Topic
                    </MenuItem>
                  )}
                  {userHasBlockedUser ? (
                    <MenuItem
                      onClick={() =>
                        handleUnmoderationEvent(event, "remove-user")
                      }
                    >
                      Unblock User From Topic
                    </MenuItem>
                  ) : (
                    <MenuItem
                      onClick={() =>
                        handleModerationEvent(event, "remove-user")
                      }
                    >
                      Remove User From Topic
                    </MenuItem>
                  )}
                  {feedMode !== "unfiltered" &&
                  showAnywaySet.has(event.id) &&
                  (visibleCurators.length > 0 || isUserBlocked) ? (
                    <MenuItem onClick={() => toggleShowAnyway(event.id)}>
                      Hide Again
                    </MenuItem>
                  ) : null}
                </>
              }
            />
          ) : (
            <>
              <PollResponseForm pollEvent={event} />
            </>
          )}
        </Box>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      curatedIds,
      feedMode,
      showAnywaySet,
      user?.follows,
      user?.pubkey,
      moderationVersion,
    ],
  );

  return (
    <Box
      ref={scrollContainerRef}
      sx={{ px: 2, py: 4, height: "100%", overflowY: "auto" }}
    >
      <Button
        variant="outlined"
        startIcon={<ArrowBack />}
        onClick={() => navigate("/feeds/topics")}
        sx={{ mb: 2 }}
      >
        Back to Topics
      </Button>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          mb: 1,
          justifyContent: "space-between",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center" }}>
          {topicImage && (
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: 1,
                overflow: "hidden",
                mr: 2,
                flexShrink: 0,
              }}
            >
              <img
                src={topicImage}
                alt={tag}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </Box>
          )}
          <Box>
            <Typography variant="h5">#{tag}</Typography>
            {topicDescription && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5, fontStyle: "italic" }}
              >
                {topicDescription}
              </Typography>
            )}
          </Box>
        </Box>
        <IconButton
          size="small"
          onClick={
            isInMyTopics ? handleRemoveFromMyTopics : handleAddToMyTopics
          }
          disabled={isAddingToMyTopics}
          title={isInMyTopics ? "Remove from my topics" : "Add to my topics"}
        >
          {isInMyTopics ? (
            <FavoriteIcon color="primary" fontSize="small" />
          ) : (
            <FavoriteBorderIcon fontSize="small" />
          )}
        </IconButton>
      </Box>

      <Rate entityId={tag!} entityType="hashtag" />
      {allModerators.length > 0 && (
        <Box
          onClick={() => setModeratorDialogOpen(true)}
          sx={{
            mt: 2,
            mb: 1,
            display: "flex",
            alignItems: "center",
            cursor: "pointer",
          }}
        >
          <Typography sx={{ mr: 1 }} variant="subtitle2">
            Moderated by:
          </Typography>
          <OverlappingAvatars ids={visibleModerators} maxAvatars={5} />
        </Box>
      )}

      <FormControl sx={{ mt: 2, mb: 1 }} size="small">
        <InputLabel>Feed Mode</InputLabel>
        <Select
          value={feedMode}
          label="Feed Mode"
          onChange={(e: SelectChangeEvent) => {
            if (!user && e.target.value === "contacts") return;
            setFeedMode(e.target.value as typeof feedMode);
          }}
        >
          <MenuItem value="unfiltered">Unfiltered</MenuItem>
          <MenuItem value="global">Filtered (Global)</MenuItem>
          <MenuItem
            value="contacts"
            onClick={(e: any) => {
              if (!user) {
                requestLogin();
                return;
              } else {
                setFeedMode("contacts");
              }
            }}
            sx={{
              color: !user ? "text.disabled" : "inherit",
              pointerEvents: "auto",
              opacity: !user ? 0.5 : 1,
            }}
          >
            Filtered (My Contacts)
          </MenuItem>
        </Select>
      </FormControl>

      <Tabs value={tabValue} onChange={(_, val) => setTabValue(val)}>
        <Tab label="Notes" />
        <Tab label="Polls" />
      </Tabs>

      <UnifiedFeed
        data={sortedEvents}
        loading={loading}
        emptyState={<Typography>No content found for this topic.</Typography>}
        scrollContainerRef={scrollContainerRef}
        followOutput={false}
        itemContent={itemContent}
      />
      <ModeratorSelectorDialog
        open={moderatorDialogOpen}
        moderators={allModerators}
        selected={visibleModerators}
        onSubmit={(pubkeys) => {
          setVisibleModerators(pubkeys);
          if (tag) saveModeratorPrefs(tag, pubkeys);
        }}
        onClose={() => setModeratorDialogOpen(false)}
      />
    </Box>
  );
};

export default TopicExplorer;
