import React, { useEffect, useState } from "react";
import {
  Avatar,
  Box,
  Card,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import PeopleIcon from "@mui/icons-material/People";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import EditIcon from "@mui/icons-material/EditRounded";
import { Event, nip19 } from "nostr-tools";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../../hooks/useAppContext";
import { useListContext } from "../../hooks/useListContext";
import { useUserContext } from "../../hooks/useUserContext";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import OverlappingAvatars from "../Common/OverlappingAvatars";
import { calculateTimeAgo } from "../../utils/common";
import { FollowPackMembersDialog } from "./FollowPackMembersDialog";
import { openProfileTab } from "../../nostr";
import { getPackMeta, packNaddr } from "./packUtils";

interface FollowPackCardProps {
  event: Event;
}

export { getPackMeta } from "./packUtils";

export const FollowPackCard: React.FC<FollowPackCardProps> = ({ event }) => {
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { bookmarkedPackKeys, bookmarkFollowPack, unbookmarkFollowPack } = useListContext();
  const { user } = useUserContext();
  const navigate = useNavigate();
  const [membersOpen, setMembersOpen] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);

  const { title, description, image, members } = getPackMeta(event);

  const adref = `39089:${event.pubkey}:${event.tags.find((t) => t[0] === "d")?.[1] || ""}`;
  const isBookmarked = bookmarkedPackKeys.has(adref);

  useEffect(() => {
    if (!profiles?.get(event.pubkey)) fetchUserProfileThrottled(event.pubkey);
    members.slice(0, 8).forEach((pk) => {
      if (!profiles?.get(pk)) fetchUserProfileThrottled(pk);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.pubkey]);

  const authorProfile = profiles?.get(event.pubkey);
  const authorName =
    authorProfile?.display_name ||
    authorProfile?.name ||
    (() => {
      const npub = nip19.npubEncode(event.pubkey);
      return npub.slice(0, 8) + "…";
    })();

  const handleCardClick = () => {
    const naddr = nip19.naddrEncode({
      kind: 39089,
      pubkey: event.pubkey,
      identifier: event.tags.find((t) => t[0] === "d")?.[1] || "",
    });
    navigate(`/feeds/follow-packs/${naddr}`);
  };

  const handleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user || bookmarking) return;
    setBookmarking(true);
    try {
      if (isBookmarked) {
        await unbookmarkFollowPack(event);
      } else {
        await bookmarkFollowPack(event);
      }
    } finally {
      setBookmarking(false);
    }
  };

  return (
    <>
      <Card
        variant="outlined"
        sx={{
          m: 1,
          cursor: "pointer",
          "&:hover": { borderColor: "primary.main" },
          transition: "border-color 0.15s",
        }}
        onClick={handleCardClick}
      >
        {/* Cover — clipped only here so inner content can overflow freely */}
        <Box sx={{ overflow: "hidden", borderRadius: "inherit", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          {image ? (
            <Box
              component="img"
              src={image}
              alt={title}
              sx={{ width: "100%", height: 130, objectFit: "cover", display: "block" }}
            />
          ) : (
            <Box
              sx={{
                height: 80,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background:
                  "linear-gradient(135deg, rgba(250,209,63,0.15) 0%, rgba(250,209,63,0.30) 100%)",
              }}
            >
              <PeopleIcon sx={{ fontSize: 44, color: "primary.main", opacity: 0.35 }} />
            </Box>
          )}
        </Box>

        <Box sx={{ p: 2, pb: 1.5 }}>
          {/* Title + bookmark button */}
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 0.25 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1, lineHeight: 1.3 }}>
              {title}
            </Typography>
            {user?.pubkey === event.pubkey && (
              <Tooltip title="Edit pack">
                <IconButton
                  size="small"
                  aria-label="Edit pack"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/feeds/follow-packs/${packNaddr(event)}/edit`);
                  }}
                  sx={{ mt: -0.25, flexShrink: 0, color: "text.secondary" }}
                >
                  <EditIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
            {user && (
              <Tooltip title={isBookmarked ? "Remove bookmark" : "Bookmark pack"}>
                <IconButton
                  size="small"
                  disabled={bookmarking}
                  onClick={handleBookmark}
                  sx={{ mt: -0.25, flexShrink: 0, color: isBookmarked ? "primary.main" : "text.disabled" }}
                >
                  {bookmarking ? (
                    <CircularProgress size={18} color="inherit" />
                  ) : isBookmarked ? (
                    <BookmarkIcon sx={{ fontSize: 18 }} />
                  ) : (
                    <BookmarkBorderIcon sx={{ fontSize: 18 }} />
                  )}
                </IconButton>
              </Tooltip>
            )}
          </Box>

          {/* Description */}
          {description && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mb: 1.5,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                lineHeight: 1.5,
              }}
            >
              {description}
            </Typography>
          )}

          {/* Members row */}
          <Tooltip title="View all members">
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}
              onClick={(e) => { e.stopPropagation(); setMembersOpen(true); }}
            >
              <OverlappingAvatars ids={members.slice(0, 6)} maxAvatars={6} />
              <Chip
                label={`${members.length} member${members.length !== 1 ? "s" : ""}`}
                size="small"
                variant="outlined"
                sx={{ height: 22, fontSize: "0.68rem", "& .MuiChip-label": { px: 0.75 }, cursor: "pointer", flexShrink: 0 }}
              />
            </Box>
          </Tooltip>

          {/* Author + timestamp */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 0.75, cursor: "pointer", "&:hover .author-name": { textDecoration: "underline" } }}
              onClick={(e) => { e.stopPropagation(); openProfileTab(nip19.npubEncode(event.pubkey), navigate); }}
            >
              <Avatar src={authorProfile?.picture || DEFAULT_IMAGE_URL} sx={{ width: 20, height: 20 }} />
              <Typography className="author-name" variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                {authorName}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
              {calculateTimeAgo(event.created_at)}
            </Typography>
          </Box>
        </Box>
      </Card>

      <FollowPackMembersDialog
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        memberPubkeys={members}
        packTitle={title}
      />
    </>
  );
};
