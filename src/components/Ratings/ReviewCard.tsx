import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Avatar,
  Stack,
  CardMedia,
  Link,
} from "@mui/material";
import { nip19, Event } from "nostr-tools";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useAppContext } from "../../hooks/useAppContext";
import { useMetadata } from "../../hooks/MetadataProvider";
import { selectBestMetadataEvent } from "../../utils/utils";
import { useUserContext } from "../../hooks/useUserContext";
import { dataLayer } from "@formstr/local-relay";
import { Nip05Badge } from "../Common/Nip05Badge";
import { openProfileTab } from "../../nostr";

interface Props {
  event: Event;
}

interface EntityDisplay {
  type: "movie" | "profile" | "poll" | "note" | "unknown";
  title?: string;
  subtitle?: string;
  image?: string;
  link?: string;
}

const ReviewCard: React.FC<Props> = ({ event }) => {
  const rating =
    parseFloat(event.tags.find((t) => t[0] === "rating")?.[1] || "0") * 5;
  const content = event.content;
  const pubkey = event.pubkey;

  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { user } = useUserContext();
  const { registerEntity, metadata } = useMetadata();
  const navigate = useNavigate();

  const [entityDisplay, setEntityDisplay] = useState<EntityDisplay | null>(null);

  const reviewUser = profiles?.get(pubkey);
  if (!reviewUser) fetchUserProfileThrottled(pubkey);

  const displayName =
    reviewUser?.name || nip19.npubEncode(pubkey).slice(0, 12) + "...";
  const picture = reviewUser?.picture;
  const profileNpub = nip19.npubEncode(pubkey);

  useEffect(() => {
    const fetchEntityMetadata = async () => {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1];

      if (dTag?.startsWith("movie:")) {
        const imdbId = dTag.replace("movie:", "");
        registerEntity("movie", imdbId);

        setTimeout(() => {
          const movieMetadata = metadata.get(imdbId);
          const activeEvent = movieMetadata
            ? selectBestMetadataEvent(movieMetadata, user?.follows)
            : null;

          setEntityDisplay({
            type: "movie",
            title: activeEvent?.content || `Movie ${imdbId}`,
            subtitle: activeEvent?.tags.find((t) => t[0] === "year")?.[1],
            image: activeEvent?.tags.find((t) => t[0] === "poster")?.[1],
            link: `/feeds/movies/${imdbId}`,
          });
        }, 100);
        return;
      }

      if (dTag?.startsWith("profile:")) {
        const profilePubkey = dTag.replace("profile:", "");
        fetchUserProfileThrottled(profilePubkey);

        setTimeout(() => {
          const profile = profiles?.get(profilePubkey);
          const npub = nip19.npubEncode(profilePubkey);

          setEntityDisplay({
            type: "profile",
            title: profile?.name || profile?.username || npub.slice(0, 12) + "...",
            subtitle: profile?.nip05,
            image: profile?.picture,
            link: `/profile/${npub}`,
          });
        }, 100);
        return;
      }

      const eTagEntry = event.tags.find((t) => t[0] === "e");
      const eTag = eTagEntry?.[1];
      if (eTag) {
        try {
          const eventData = await dataLayer.fetchById(eTag);
          if (eventData) {
            if (eventData.kind === 1068) {
              const question = eventData.tags.find((t) => t[0] === "question")?.[1];
              setEntityDisplay({
                type: "poll",
                title: question || "Poll",
                subtitle: `by ${profiles?.get(eventData.pubkey)?.name || "someone"}`,
                link: `/respond/${nip19.neventEncode({ id: eTag, relays: [] })}`,
              });
            } else if (eventData.kind === 1) {
              const noteContent =
                eventData.content.slice(0, 100) +
                (eventData.content.length > 100 ? "..." : "");
              setEntityDisplay({
                type: "note",
                title: noteContent || "Note",
                subtitle: `by ${profiles?.get(eventData.pubkey)?.name || "someone"}`,
                link: `/note/${nip19.neventEncode({ id: eTag, relays: [] })}`,
              });
            }
          }
        } catch (error) {
          console.error("Failed to fetch event:", error);
        }
        return;
      }

      setEntityDisplay({
        type: "unknown",
        title: dTag || "Unknown entity",
      });
    };

    fetchEntityMetadata();
  }, [
    event,
    metadata,
    profiles,
    user?.follows,
    registerEntity,
    fetchUserProfileThrottled,
  ]);

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="flex-start" mb={2}>
          <Box
            onClick={() => openProfileTab(profileNpub, navigate)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openProfileTab(profileNpub, navigate);
              }
            }}
            role="button"
            tabIndex={0}
            sx={{
              display: "flex",
              alignItems: "flex-start",
              gap: 2,
              flex: 1,
              minWidth: 0,
              cursor: "pointer",
              "&:hover .profile-name, &:focus-visible .profile-name": {
                textDecoration: "underline",
              },
            }}
          >
            <Avatar src={picture} alt={displayName} sx={{ width: 40, height: 40 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography className="profile-name" variant="subtitle1" fontWeight={600} noWrap>
                {displayName}
              </Typography>
              <Nip05Badge nip05={reviewUser?.nip05} pubkey={pubkey} />
            </Box>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
            {rating.toFixed(1)} ★
          </Typography>
        </Stack>

        {entityDisplay && (
          <Box
            sx={{
              display: "flex",
              gap: 2,
              mb: 2,
              p: 2,
              bgcolor: "action.hover",
              borderRadius: 1,
            }}
          >
            {entityDisplay.image && (
              <CardMedia
                component="img"
                sx={{ width: 60, height: 90, objectFit: "cover", borderRadius: 1 }}
                image={entityDisplay.image}
                alt={entityDisplay.title}
              />
            )}
            <Box sx={{ flex: 1 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textTransform: "uppercase" }}
              >
                Rated {entityDisplay.type}
              </Typography>
              {entityDisplay.link ? (
                <Link
                  component={RouterLink}
                  to={entityDisplay.link}
                  variant="subtitle2"
                  sx={{
                    display: "block",
                    textDecoration: "none",
                    "&:hover": { textDecoration: "underline" },
                  }}
                >
                  {entityDisplay.title}
                </Link>
              ) : (
                <Typography variant="subtitle2">{entityDisplay.title}</Typography>
              )}
              {entityDisplay.subtitle && (
                <Typography variant="caption" color="text.secondary">
                  {entityDisplay.subtitle}
                </Typography>
              )}
            </Box>
          </Box>
        )}

        {content && <Typography variant="body1">{content}</Typography>}
      </CardContent>
    </Card>
  );
};

export default ReviewCard;
