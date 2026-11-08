import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ButtonBase,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import { Event } from "nostr-tools";
import { useListContext, eventRefOf } from "../../../hooks/useListContext";
import { useNotification } from "../../../contexts/notification-context";
import { useUserContext } from "../../../hooks/useUserContext";
import { useAppContext } from "../../../hooks/useAppContext";
import { ProfileListDialog } from "../ProfileListDialog";

interface BookmarkButtonProps {
  event: Event;
}

export const BookmarkButton: React.FC<BookmarkButtonProps> = ({ event }) => {
  const { bookmarkedEventRefs, bookmarkEvent, unbookmarkEvent } = useListContext();
  const { user, requestLogin: openLogin } = useUserContext();
  const { showNotification } = useNotification();
  const {
    bookmarksMap,
    getBookmarkCount,
    fetchBookmarkCountThrottled,
  } = useAppContext();
  const theme = useTheme();
  const [pending, setPending] = useState(false);
  const [bookmarkersOpen, setBookmarkersOpen] = useState(false);

  const ref = eventRefOf(event);
  const isBookmarked = bookmarkedEventRefs.has(ref);
  const bookmarkCount = getBookmarkCount(ref);
  const bookmarkers = useMemo(() => {
    const events = bookmarksMap.get(ref) ?? [];
    return Array.from(new Set(events.map((bookmark) => bookmark.pubkey)));
  }, [bookmarksMap, ref]);
  const buttonRef = useRef<HTMLDivElement>(null);

  // Fetch the count only when the button is actually on screen: the
  // author-less kind-10003 count query is one of the heavier interests, and
  // offscreen cards shouldn't pay for it. The context layer applies its own
  // 5-minute TTL on top, so re-entering the viewport re-checks cheaply.
  useEffect(() => {
    const el = buttonRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      fetchBookmarkCountThrottled(ref);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) fetchBookmarkCountThrottled(ref);
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, fetchBookmarkCountThrottled]);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pending) return;
    if (!user) {
      openLogin();
      return;
    }
    setPending(true);
    try {
      if (isBookmarked) {
        await unbookmarkEvent(event);
        showNotification("Removed bookmark", "success", 2500);
      } else {
        await bookmarkEvent(event);
        showNotification("Bookmarked", "success", 2500);
      }
    } catch {
      showNotification("Couldn't update bookmark — try again", "error", 3000);
    } finally {
      setPending(false);
    }
  };

  const handleShowBookmarkers = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (bookmarkers.length > 0) setBookmarkersOpen(true);
  };

  return (
    <>
      <div
        ref={buttonRef}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Tooltip title={isBookmarked ? "Remove bookmark" : "Bookmark"}>
          <IconButton
            size="small"
            disabled={pending}
            onClick={handleClick}
            color={isBookmarked ? "primary" : "default"}
          >
            {pending ? (
              <CircularProgress size={18} color="inherit" />
            ) : isBookmarked ? (
              <BookmarkIcon />
            ) : (
              <BookmarkBorderIcon />
            )}
          </IconButton>
        </Tooltip>
        {bookmarkCount > 0 && (
          <Tooltip title="See who bookmarked this">
            <ButtonBase
              onClick={handleShowBookmarkers}
              aria-label={`See ${bookmarkCount} bookmarker${bookmarkCount === 1 ? "" : "s"}`}
              sx={{
                px: 0.5,
                py: 0.25,
                borderRadius: 1,
                color: isBookmarked ? theme.palette.primary.main : "inherit",
                "&:hover": { textDecoration: "underline" },
              }}
            >
              <Typography variant="caption">{bookmarkCount}</Typography>
            </ButtonBase>
          </Tooltip>
        )}
      </div>

      <ProfileListDialog
        open={bookmarkersOpen}
        onClose={() => setBookmarkersOpen(false)}
        pubkeys={bookmarkers}
        title="Bookmarked by"
        subtitle={`${bookmarkCount} ${bookmarkCount === 1 ? "person" : "people"}`}
      />
    </>
  );
};
