import React, { useState } from "react";
import { CircularProgress, IconButton, Tooltip } from "@mui/material";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import { Event } from "nostr-tools";
import { useListContext, eventRefOf } from "../../../hooks/useListContext";
import { useNotification } from "../../../contexts/notification-context";
import { useUserContext } from "../../../hooks/useUserContext";

interface BookmarkButtonProps {
  event: Event;
}

export const BookmarkButton: React.FC<BookmarkButtonProps> = ({ event }) => {
  const { bookmarkedEventRefs, bookmarkEvent, unbookmarkEvent } = useListContext();
  const { user, requestLogin: openLogin } = useUserContext();
  const { showNotification } = useNotification();
  const [pending, setPending] = useState(false);

  const ref = eventRefOf(event);
  const isBookmarked = bookmarkedEventRefs.has(ref);

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
  );
};
