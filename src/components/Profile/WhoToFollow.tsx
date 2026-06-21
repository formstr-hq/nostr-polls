import React, { useEffect, useState } from "react";
import { Avatar, Box, Button, CircularProgress, Typography } from "@mui/material";
import { EventTemplate, nip19 } from "nostr-tools";
import { useNavigate } from "react-router-dom";
import { dataLayer } from "@formstr/local-relay";
import { useUserContext } from "../../hooks/useUserContext";
import { useListContext } from "../../hooks/useListContext";
import { useAppContext } from "../../hooks/useAppContext";
import { signEvent, openProfileTab } from "../../nostr";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";

const MAX_SUGGESTIONS = 12;

/**
 * "People you may know" — a horizontal rail of follow suggestions sourced from
 * the web-of-trust worker (2nd-degree pubkeys ranked by how many of the user's
 * follows follow them). Renders nothing until recommendations exist, so it's
 * safe to drop atop any discovery surface.
 */
export const WhoToFollow: React.FC = () => {
  const { user, setUser } = useUserContext();
  const { getFollowRecommendations, fetchLatestContactList } = useListContext();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const navigate = useNavigate();
  const [followingPks, setFollowingPks] = useState<Set<string>>(new Set());

  const recommendations = getFollowRecommendations(MAX_SUGGESTIONS);

  // Warm the profile cache for the suggested pubkeys so names/avatars render.
  useEffect(() => {
    recommendations.forEach((r) => {
      if (!profiles?.get(r.pubkey)) fetchUserProfileThrottled(r.pubkey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendations.length]);

  // Mirrors the follow flow in FollowPackMembersDialog: append a `p` tag to the
  // latest kind-3, publish, and optimistically update `follows` (which drops the
  // person from the list on the next render via getFollowRecommendations).
  const handleFollow = async (pk: string) => {
    if (!user || followingPks.has(pk)) return;
    setFollowingPks((prev) => new Set(prev).add(pk));
    try {
      const contactEvent = await fetchLatestContactList();
      const existingTags = contactEvent?.tags || [];
      const pTags = existingTags.filter(([t]) => t === "p").map(([, p]) => p);
      if (pTags.includes(pk)) return;
      const newEvent: EventTemplate = {
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: [...existingTags, ["p", pk]],
        content: contactEvent?.content || "",
      };
      const signed = await signEvent(newEvent);
      dataLayer.publishEvent(signed);
      setUser((prev) =>
        prev ? { ...prev, follows: [...(prev.follows || []), pk] } : prev,
      );
    } finally {
      setFollowingPks((prev) => {
        const s = new Set(prev);
        s.delete(pk);
        return s;
      });
    }
  };

  if (!user || recommendations.length === 0) return null;

  return (
    <Box sx={{ maxWidth: 900, mx: "auto", px: 2, pt: 2, pb: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        People you may know
      </Typography>
      <Box sx={{ display: "flex", gap: 1.5, overflowX: "auto", pb: 1 }}>
        {recommendations.map((r) => {
          const profile = profiles?.get(r.pubkey);
          const npub = nip19.npubEncode(r.pubkey);
          const name =
            profile?.display_name || profile?.name || `${npub.slice(0, 8)}…`;
          const isLoading = followingPks.has(r.pubkey);
          return (
            <Box
              key={r.pubkey}
              sx={{
                flex: "0 0 auto",
                width: 150,
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                p: 1.5,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
              }}
            >
              <Avatar
                src={profile?.picture || DEFAULT_IMAGE_URL}
                sx={{ width: 56, height: 56, cursor: "pointer", mb: 1 }}
                onClick={() => openProfileTab(npub, navigate)}
              />
              <Typography
                variant="body2"
                fontWeight={600}
                noWrap
                sx={{ width: "100%", cursor: "pointer" }}
                onClick={() => openProfileTab(npub, navigate)}
              >
                {name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
                Followed by {r.score} you follow
              </Typography>
              <Button
                size="small"
                variant="outlined"
                fullWidth
                disabled={isLoading}
                onClick={() => handleFollow(r.pubkey)}
              >
                {isLoading ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  "Follow"
                )}
              </Button>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default WhoToFollow;
