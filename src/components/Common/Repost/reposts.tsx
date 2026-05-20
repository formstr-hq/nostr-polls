import React, { useEffect, useState } from "react";
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import RepeatIcon from "@mui/icons-material/Repeat";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import { Event, EventTemplate } from "nostr-tools";
import { useUserContext } from "../../../hooks/useUserContext";
import { useNotification } from "../../../contexts/notification-context";
import { NOTIFICATION_MESSAGES } from "../../../constants/notifications";
import { useAppContext } from "../../../hooks/useAppContext";
import { useRelays } from "../../../hooks/useRelays";
import { pool } from "../../../singletons";
import { signEvent } from "../../../nostr";
import QuotePostDialog from "./QuotePostDialog";

interface RepostButtonProps {
  event: Event;
}

const RepostButton: React.FC<RepostButtonProps> = ({ event }) => {
  const { user } = useUserContext();
  const { showNotification } = useNotification();
  const { relays, writeRelays } = useRelays();
  const { repostsMap, fetchRepostsThrottled, addEventToMap } = useAppContext();

  const [reposted, setReposted] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);

  useEffect(() => {
    const checkAndFetch = async () => {
      if (!repostsMap?.get(event.id)) {
        await fetchRepostsThrottled(event.id);
      } else if (user) {
        const repostedByUser = repostsMap
          .get(event.id)
          ?.some((e: Event) => e.pubkey === user.pubkey);
        setReposted(!!repostedByUser);
      }
    };

    checkAndFetch();
  }, [event.id, repostsMap, fetchRepostsThrottled, user]);

  const handleIconClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!user) {
      showNotification(NOTIFICATION_MESSAGES.LOGIN_TO_REPOST, "warning");
      return;
    }
    setMenuAnchor(e.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handleRepost = async () => {
    handleMenuClose();

    if (reposted) return;

    const isKind1 = event.kind === 1;

    const repostTemplate: EventTemplate = {
      kind: isKind1 ? 6 : 16,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["e", event.id, relays[0], event.pubkey],
        ["p", event.pubkey],
      ],
      content: isKind1 ? JSON.stringify(event) : "",
    };

    if (!isKind1) {
      repostTemplate.tags.push(["k", event.kind.toString()]);
    }

    try {
      const signedEvent = await signEvent(repostTemplate, user!.privateKey);
      pool.publish(writeRelays, signedEvent);
      addEventToMap(signedEvent);
      setReposted(true);
    } catch (error) {
      console.error("Repost failed:", error);
      showNotification("Failed to repost event", "error");
    }
  };

  const handleQuotePost = () => {
    handleMenuClose();
    setQuoteDialogOpen(true);
  };

  return (
    <div style={{ marginLeft: 20 }}>
      <span
        onClick={handleIconClick}
        style={{
          cursor: "pointer",
          display: "flex",
          flexDirection: "row",
          padding: 2,
        }}
      >
        <RepeatIcon
          sx={
            reposted
              ? {
                  fontSize: 28,
                  color: "#4CAF50",
                  "& path": {
                    stroke: "#4CAF50",
                    strokeWidth: 2,
                  },
                }
              : {
                  fontSize: 20,
                }
          }
        />
      </span>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleRepost} disabled={reposted}>
          <ListItemIcon>
            <RepeatIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{reposted ? "Reposted" : "Repost"}</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleQuotePost}>
          <ListItemIcon>
            <FormatQuoteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{event.kind === 1068 ? "Quote Poll" : "Quote Post"}</ListItemText>
        </MenuItem>
      </Menu>
      {quoteDialogOpen && (
        <QuotePostDialog
          open={quoteDialogOpen}
          onClose={() => setQuoteDialogOpen(false)}
          event={event}
        />
      )}
    </div>
  );
};

export default RepostButton;
