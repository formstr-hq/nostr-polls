import React, { useEffect, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  CardMedia,
  Typography,
  Button,
  CardActionArea,
  IconButton,
} from "@mui/material";
import { Event, nip19 } from "nostr-tools";
import Rate from "../../Ratings/Rate";
import { useAppContext } from "../../../hooks/useAppContext";
import { useUserContext } from "../../../hooks/useUserContext";
import { selectBestMetadataEvent } from "../../../utils/utils";
import TopicMetadataModal from "./TopicMetadataModal";
import { useMetadata } from "../../../hooks/MetadataProvider";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import { useNavigate } from "react-router-dom";
import { useListContext } from "../../../hooks/useListContext";
import { signerManager } from "../../../singletons/Signer/SignerManager";
import { FavoriteTwoTone } from "@mui/icons-material";

interface TopicCardProps {
  tag: string;
  metadataEvent?: Event;
}

const TopicCard: React.FC<TopicCardProps> = ({ tag, metadataEvent }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [isUpdatingMyTopics, setIsUpdatingTopics] = useState(false);
  const { user, requestLogin } = useUserContext();
  const { fetchUserProfileThrottled, profiles } = useAppContext();
  const { registerEntity, metadata } = useMetadata();
  const { myTopics, addTopicToMyTopics, removeTopicFromMyTopics } =
    useListContext();
  const navigate = useNavigate();

  const isInMyTopics = myTopics?.has(tag) ?? false;

  useEffect(() => {
    registerEntity("hashtag", tag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  let activeEvent: Event | null;
  if (!metadataEvent) {
    const events = metadata.get(tag) ?? [];
    activeEvent = selectBestMetadataEvent(events, user?.follows);
  } else {
    activeEvent = metadataEvent;
  }

  const title = `${tag}`;
  const thumb = activeEvent?.tags.find((t) => t[0] === "image")?.[1];
  const description = activeEvent?.tags.find(
    (t) => t[0] === "description"
  )?.[1];
  const pubkey = activeEvent?.pubkey;

  let metadataUser: any = profiles?.get(metadataEvent?.pubkey || "");
  if (!metadataUser && metadataEvent) {
    try {
      nip19.npubEncode(metadataEvent.pubkey);
      fetchUserProfileThrottled(metadataEvent?.pubkey);
      metadataUser = {
        pubkey: metadataEvent?.pubkey,
        name: "Fetching Pubkey...",
      };
    } catch {
      metadataUser = {
        pubkey: metadataEvent?.pubkey,
        name: "Preview User",
        picture: "",
      };
    }
  }

  const handleAddToMyTopics = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!user) {
      requestLogin();
      return;
    }

    setIsUpdatingTopics(true);
    try {
      await signerManager.getSigner();
      await addTopicToMyTopics(tag);
    } catch (error) {
      console.error("Failed to add topic to my topics:", error);
    } finally {
      setIsUpdatingTopics(false);
    }
  };

  const handleRemoveFromMyTopics = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;

    setIsUpdatingTopics(true);
    try {
      await removeTopicFromMyTopics(tag);
    } catch (err) {
      console.error("Failed to remove topic:", err);
    } finally {
      setIsUpdatingTopics(false);
    }
  };

  return (
    <>
      <Card
        sx={{
          display: "flex",
          mb: 2,
          borderRadius: 2,
          overflow: "hidden",
        }}
        elevation={2}
      >
        {/* Left Thumbnail Area */}
        {thumb ? (
          <Box sx={{ position: "relative", width: 120 }}>
            <CardMedia
              component="img"
              image={thumb}
              sx={{ width: 120, height: 120 }}
              alt={title}
            />
            <Button
              size="small"
              variant="text"
              onClick={(e) => {
                e.stopPropagation();
                setModalOpen(true);
              }}
              sx={{
                position: "absolute",
                top: 4,
                right: 4,
                minWidth: "auto",
                p: 0.5,
                backgroundColor: "black",
                borderRadius: "50%",
                zIndex: 1,
              }}
              title="Edit Metadata"
            >
              ✏️
            </Button>
          </Box>
        ) : (
          <Box
            sx={{
              width: 120,
              height: 120,
              bgcolor: "action.hover",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setModalOpen(true);
              }}
            >
              {activeEvent ? "Edit" : "Add"} Metadata
            </Button>
          </Box>
        )}
        <Box>
          <IconButton
            size="small"
            disabled={isUpdatingMyTopics}
            onClick={
              isInMyTopics
                ? handleRemoveFromMyTopics // ← REMOVE
                : handleAddToMyTopics // ← ADD
            }
            title={isInMyTopics ? "Remove from my topics" : "Add to my topics"}
          >
            {isInMyTopics ? (
              <FavoriteTwoTone
                color={isUpdatingMyTopics ? "disabled" : "primary"}
                fontSize="small"
              />
            ) : (
              <FavoriteBorderIcon fontSize="small" />
            )}
          </IconButton>
        </Box>

        {/* Clickable Card Content */}
        <CardActionArea
          onClick={() => navigate(`/feeds/topics/${tag}`)}
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            px: 2,
            py: 1.5,
            transition: "box-shadow 0.2s",
            "&:hover": {
              backgroundColor: "action.hover",
            },
            "&:active": {
              boxShadow: 3,
            },
          }}
        >
          <CardContent sx={{ p: 0 }}>
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography
                variant="h6"
                sx={{
                  textDecoration: "none",
                  "&:hover": {
                    textDecoration: "underline",
                  },
                }}
              >
                {title}
              </Typography>
              <Box display="flex" alignItems="center" gap={1}>
                <ChevronRightIcon color="action" />
              </Box>
            </Box>

            <Typography
              variant="body2"
              sx={{
                mt: 1,
                fontStyle: description ? "normal" : "italic",
                color: description ? "text.primary" : "text.secondary",
              }}
            >
              {description
                ? description
                : "Click to view discussions and polls on this topic."}
            </Typography>

            {pubkey && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ wordBreak: "break-word", whiteSpace: "normal", mt: 1 }}
              >
                Metadata by {metadataUser?.name || nip19.npubEncode(pubkey)}
              </Typography>
            )}

            <Rate entityId={tag} entityType="hashtag" />
          </CardContent>
        </CardActionArea>
      </Card>

      <TopicMetadataModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        topic={tag}
      />
    </>
  );
};

export default TopicCard;
