import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PeopleIcon from "@mui/icons-material/People";
import { Event, Filter, nip19 } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { useAppContext } from "../../hooks/useAppContext";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { Notes } from "../Notes";
import PollResponseForm from "../PollResponse/PollResponseForm";
import { FollowPackMembersDialog } from "./FollowPackMembersDialog";
import { calculateTimeAgo } from "../../utils/common";
import { openProfileTab } from "../../nostr";

const BATCH_SIZE = 20;

function getPackMeta(event: Event) {
  const title =
    event.tags.find((t) => t[0] === "title")?.[1] ||
    event.tags.find((t) => t[0] === "d")?.[1] ||
    "Unnamed Pack";
  const description =
    event.tags.find((t) => t[0] === "description")?.[1] ||
    event.content ||
    "";
  const image = event.tags.find((t) => t[0] === "image")?.[1];
  const members = event.tags.filter((t) => t[0] === "p").map((t) => t[1]);
  return { title, description, image, members };
}

const FollowPackDetail: React.FC = () => {
  const { naddr } = useParams<{ naddr: string }>();
  const navigate = useNavigate();
  const { profiles, fetchUserProfileThrottled } = useAppContext();

  const [packEvent, setPackEvent] = useState<Event | null>(null);
  const [packLoading, setPackLoading] = useState(true);
  const [membersOpen, setMembersOpen] = useState(false);

  const [feedEvents, setFeedEvents] = useState<Event[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedInitialDone, setFeedInitialDone] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const seen = useRef<Set<string>>(new Set());

  // Decode naddr and fetch the pack event
  useEffect(() => {
    if (!naddr) return;
    let decoded: ReturnType<typeof nip19.decode>;
    try {
      decoded = nip19.decode(naddr);
    } catch {
      setPackLoading(false);
      return;
    }
    if (decoded.type !== "naddr") { setPackLoading(false); return; }

    const { kind, pubkey, identifier } = decoded.data;
    const filter: Filter = { kinds: [kind], authors: [pubkey], "#d": [identifier], limit: 1 };
    const handle = dataLayer.observe([filter], {
      onEvent: (e) => { setPackEvent(e); setPackLoading(false); },
      // No onEose: the pack arrives via onEvent after the worker's upstream
      // fetch; the timeout below closes the interest.
    });
    setTimeout(() => { setPackLoading(false); handle.unobserve(); }, 5000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naddr]);

  // Fetch author profile once pack is loaded
  useEffect(() => {
    if (!packEvent) return;
    if (!profiles?.get(packEvent.pubkey)) fetchUserProfileThrottled(packEvent.pubkey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packEvent?.pubkey]);

  const fetchFeedBatch = (members: string[]) => {
    if (feedLoading || members.length === 0) return;
    setFeedLoading(true);

    const now = Math.floor(Date.now() / 1000);
    const newEvents: Event[] = [];
    let oldestTs: number | undefined;

    const filter: Filter = {
      kinds: [1, 1068],
      authors: members,
      limit: BATCH_SIZE,
      until: cursor ?? now,
    };

    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const handle = dataLayer.observe([filter], {
      onEvent: (e) => {
        if (!seen.current.has(e.id)) {
          seen.current.add(e.id);
          newEvents.push(e);
        }
        if (!oldestTs || e.created_at < oldestTs) oldestTs = e.created_at;
        // Commit shortly after the stream goes quiet (local EOSE precedes the
        // worker's upstream fetch under the dataLayer contract).
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finalize, 900);
      },
    });

    const finalize = () => {
      if (settled) return;
      settled = true;
      if (quietTimer) clearTimeout(quietTimer);
      handle.unobserve();
      setFeedEvents((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const merged = [...prev, ...newEvents.filter((e) => !ids.has(e.id))];
        merged.sort((a, b) => b.created_at - a.created_at);
        return merged;
      });
      if (oldestTs) setCursor(oldestTs - 1);
      setFeedInitialDone(true);
      setFeedLoading(false);
    };

    // Hard cap so an empty result (no events → no quiet timer) still settles.
    setTimeout(finalize, 5000);
  };

  // Start feed once pack is loaded
  useEffect(() => {
    if (!packEvent) return;
    const { members } = getPackMeta(packEvent);
    fetchFeedBatch(members);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packEvent?.id]);

  if (packLoading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (!packEvent) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" py={8} gap={2}>
        <Typography color="text.secondary">Pack not found.</Typography>
        <Button onClick={() => navigate(-1)}>Go back</Button>
      </Box>
    );
  }

  const { title, description, image, members } = getPackMeta(packEvent);
  const authorProfile = profiles?.get(packEvent.pubkey);
  const authorName =
    authorProfile?.display_name ||
    authorProfile?.name ||
    (() => {
      const npub = nip19.npubEncode(packEvent.pubkey);
      return npub.slice(0, 8) + "…";
    })();

  return (
    <Box sx={{ height: "100%", overflowY: "auto" }}>
      {/* Back button */}
      <Box sx={{ px: 1, pt: 1 }}>
        <IconButton size="small" onClick={() => navigate(-1)}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Pack header */}
      <Box sx={{ mb: 2 }}>
        {image ? (
          <Box
            component="img"
            src={image}
            alt={title}
            sx={{ width: "100%", height: 160, objectFit: "cover", display: "block" }}
          />
        ) : (
          <Box
            sx={{
              height: 100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                "linear-gradient(135deg, rgba(250,209,63,0.15) 0%, rgba(250,209,63,0.30) 100%)",
            }}
          >
            <PeopleIcon sx={{ fontSize: 52, color: "primary.main", opacity: 0.35 }} />
          </Box>
        )}

        <Box sx={{ px: 2, pt: 1.5 }}>
          <Typography variant="h5" fontWeight={700}>
            {title}
          </Typography>

          {description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {description}
            </Typography>
          )}

          {/* Author + member count row */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 1.5, flexWrap: "wrap" }}>
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 0.75, cursor: "pointer", "&:hover .author-name": { textDecoration: "underline" } }}
              onClick={() => openProfileTab(nip19.npubEncode(packEvent.pubkey), navigate)}
            >
              <Avatar
                src={authorProfile?.picture || DEFAULT_IMAGE_URL}
                sx={{ width: 22, height: 22 }}
              />
              <Typography className="author-name" variant="caption" color="text.secondary">
                {authorName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                · {calculateTimeAgo(packEvent.created_at)}
              </Typography>
            </Box>

            <Tooltip title="View all members">
              <Chip
                icon={<PeopleIcon sx={{ fontSize: "14px !important" }} />}
                label={`${members.length} member${members.length !== 1 ? "s" : ""}`}
                size="small"
                variant="outlined"
                onClick={() => setMembersOpen(true)}
                sx={{ cursor: "pointer", height: 24, fontSize: "0.72rem" }}
              />
            </Tooltip>
          </Box>
        </Box>
      </Box>

      {/* Feed */}
      {feedLoading && feedEvents.length === 0 ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : feedEvents.length === 0 && feedInitialDone ? (
        <Box display="flex" justifyContent="center" py={6}>
          <Typography variant="body2" color="text.secondary">
            No posts from this pack yet.
          </Typography>
        </Box>
      ) : (
        <>
          {feedEvents.map((e) =>
            e.kind === 1068 ? (
              <PollResponseForm key={e.id} pollEvent={e} />
            ) : (
              <Notes key={e.id} event={e} />
            )
          )}
          {feedInitialDone && (
            <Box display="flex" justifyContent="center" my={2}>
              <Button
                variant="contained"
                disabled={feedLoading}
                onClick={() => fetchFeedBatch(members)}
              >
                {feedLoading ? <CircularProgress size={22} /> : "Load More"}
              </Button>
            </Box>
          )}
        </>
      )}

      <FollowPackMembersDialog
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        memberPubkeys={members}
        packTitle={title}
      />
    </Box>
  );
};

export default FollowPackDetail;
