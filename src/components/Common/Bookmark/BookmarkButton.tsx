import React, { useEffect, useState } from "react";
import { CircularProgress, IconButton, Tooltip, Typography, useTheme } from "@mui/material";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import { Event } from "nostr-tools";
import { useListContext, eventRefOf } from "../../../hooks/useListContext";
import { useNotification } from "../../../contexts/notification-context";
import { useUserContext } from "../../../hooks/useUserContext";
import { useAppContext } from "../../../hooks/useAppContext";

interface BookmarkButtonProps {
  event: Event;
}

export const BookmarkButton: React.FC<BookmarkButtonProps> = ({ event }) => {
  const { bookmarkedEventRefs, bookmarkEvent, unbookmarkEvent } = useListContext();
  const { user, requestLogin: openLogin } = useUserContext();
  const { showNotification } = useNotification();
  const { getBookmarkCount, fetchBookmarkCountThrottled } = useAppContext();
  const theme = useTheme();
  const [pending, setPending] = useState(false);

  const ref = eventRefOf(event);
  const isBookmarked = bookmarkedEventRefs.has(ref);
  const bookmarkCount = getBookmarkCount(ref);

  useEffect(() => {
    fetchBookmarkCountThrottled(ref);
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      }}
    >
      <Tooltip title={isBookmarked ? "Remove bookmark" : "Bookmark"}>
        <IconButton size="small" disabled={pending} onClick={handleClick} color={isBookmarked ? "primary" : "default"}>
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
        <Typography
          variant="caption"
          sx={{ color: isBookmarked ? theme.palette.primary.main : "inherit" }}
        >
          {bookmarkCount}
        </Typography>
      )}
    </div>
  );
};
