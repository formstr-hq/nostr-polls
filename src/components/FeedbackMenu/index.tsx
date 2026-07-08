import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardContent,
  Collapse,
  Box,
  Button,
  Fade,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import RatingPopover from "../Ratings/RatingPopover";
import CommentTrigger from "../Common/Comments/CommentTrigger";
import CommentSection from "../Common/Comments/CommentSection";
import Likes from "../Common/Likes/likes";
import Zap from "../Common/Zaps/zaps";
import { Event, nip19 } from "nostr-tools";
import { useNavigate } from "react-router-dom";
import RepostButton from "../Common/Repost/reposts";
import ShareButton from "../Common/Share/ShareButton";

interface FeedbackMenuProps {
  event: Event;
  depth?: number;
  ancestorPubkeys?: string[];
  /** NIP-22: "kind:pubkey:identifier" for addressable events (e.g. articles) */
  addressableRef?: string;
  /** NIP-22: root event kind (e.g. 30023) */
  rootKind?: number;
}

const MAX_DEPTH = 3;

export const FeedbackMenu: React.FC<FeedbackMenuProps> = ({
  event,
  depth = 0,
  ancestorPubkeys = [],
  addressableRef,
  rootKind,
}) => {
  const [showComments, setShowComments] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Past this depth the thread is too nested to keep replies readable. Rather
  // than silently dropping the reply UI, we send the user to the note's own
  // view where it becomes a fresh top-level thread.
  const reachedMaxDepth = depth >= MAX_DEPTH;
  const openInOwnView = () =>
    navigate(`/note/${nip19.neventEncode({ id: event.id })}`);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollWidth - el.scrollLeft - el.clientWidth > 2);
  }, []);

  useEffect(() => {
    checkOverflow();
    window.addEventListener("resize", checkOverflow);
    return () => window.removeEventListener("resize", checkOverflow);
  }, [checkOverflow]);

  const handleScrollLeft = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: -120, behavior: "smooth" });
  };

  const handleScrollRight = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: 120, behavior: "smooth" });
  };

  const handleScroll = () => {
    checkOverflow();
  };

  const handleToggleComments = () => {
    setShowComments(!showComments);
  };

  const isNested = depth > 0;

  return (
    <Card
      variant={isNested ? "outlined" : "elevation"}
      elevation={isNested ? 0 : 1}
    >
      <CardContent
        sx={{
          "&:last-child": { pb: isNested ? 1 : 1.5 },
          pt: isNested ? 1 : 1.5,
          px: isNested ? 1.5 : 2,
        }}
      >
        {/* Scrollable icon row with overflow indicator */}
        <Box position="relative">
          <Box
            ref={scrollRef}
            onScroll={handleScroll}
            display="flex"
            alignItems="center"
            gap={1}
            sx={{
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              scrollbarWidth: "none",
              "&::-webkit-scrollbar": { display: "none" },
              "& > *": { flexShrink: 0 },
              ...(isNested ? { "& svg": { fontSize: "18px !important" } } : {}),
            }}
          >
            {reachedMaxDepth ? (
              <Button
                size="small"
                startIcon={<ForumOutlinedIcon />}
                onClick={openInOwnView}
                sx={{ textTransform: "none", fontSize: "0.75rem" }}
              >
                Continue thread
              </Button>
            ) : (
              <CommentTrigger
                eventId={event.id}
                showComments={showComments}
                onToggleComments={handleToggleComments}
                addressableRef={addressableRef}
              />
            )}

            <Box display="flex" alignItems="center">
              <Likes pollEvent={event} />
            </Box>

            <RepostButton event={event} />

            <ShareButton event={event} />

            <Zap pollEvent={event} />

            <Box sx={{ ml: 1.5, mt: 0.3 }}>
              <RatingPopover entityId={event.id} entityType="event" iconSize={26} />
            </Box>
          </Box>

          {/* Scroll-left indicator */}
          <Fade in={canScrollLeft}>
            <Box
              onClick={handleScrollLeft}
              sx={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                background: (theme) =>
                  `linear-gradient(to left, transparent, ${theme.palette.mode === "dark"
                    ? theme.palette.background.paper
                    : theme.palette.background.paper
                  } 60%)`,
                pr: 2,
                pl: 0.25,
                pointerEvents: canScrollLeft ? "auto" : "none",
              }}
            >
              <ChevronLeftIcon
                sx={{
                  fontSize: 20,
                  color: "text.secondary",
                  opacity: 0.7,
                }}
              />
            </Box>
          </Fade>

          {/* Scroll-right indicator */}
          <Fade in={canScrollRight}>
            <Box
              onClick={handleScrollRight}
              sx={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                // Gradient fade from transparent to card background
                background: (theme) =>
                  `linear-gradient(to right, transparent, ${theme.palette.mode === "dark"
                    ? theme.palette.background.paper
                    : theme.palette.background.paper
                  } 60%)`,
                pl: 2,
                pr: 0.25,
                pointerEvents: canScrollRight ? "auto" : "none",
              }}
            >
              <ChevronRightIcon
                sx={{
                  fontSize: 20,
                  color: "text.secondary",
                  opacity: 0.7,
                }}
              />
            </Box>
          </Fade>
        </Box>

        {/* Comment section */}
        {!reachedMaxDepth && (
          <Collapse in={showComments} timeout={250} unmountOnExit>
            <Box
              sx={{
                mt: 1.5,
                pt: 1.5,
                borderTop: 1,
                borderColor: "divider",
              }}
            >
              <CommentSection
                eventId={event.id}
                rootPubkey={event.pubkey}
                ancestorPubkeys={ancestorPubkeys}
                showComments={showComments}
                depth={depth}
                addressableRef={addressableRef}
                rootKind={rootKind}
                parentKind={event.kind}
              />
            </Box>
          </Collapse>
        )}
      </CardContent>
    </Card>
  );
};
