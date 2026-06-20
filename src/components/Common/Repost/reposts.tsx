import React, { useEffect, useState } from "react";
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Typography,
  useTheme,
} from "@mui/material";
import RepeatIcon from "@mui/icons-material/Repeat";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import { Event, EventTemplate } from "nostr-tools";
import { useUserContext } from "../../../hooks/useUserContext";
import { useNotification } from "../../../contexts/notification-context";
import { useAppContext } from "../../../hooks/useAppContext";
import { useRelays } from "../../../hooks/useRelays";
import { dataLayer } from "@formstr/local-relay";
import { signEvent } from "../../../nostr";
import QuotePostDialog from "./QuotePostDialog";

interface RepostButtonProps {
  event: Event;
}

const RepostButton: React.FC<RepostButtonProps> = ({ event }) => {
  const { user, requestLogin } = useUserContext();
  const { showNotification } = useNotification();
  const { relays } = useRelays();
  const { repostsMap, fetchRepostsThrottled, addEventToMap } = useAppContext();
  const theme = useTheme();

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
      requestLogin();
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
    const created_at = Math.floor(Date.now() / 1000);
    const baseTags = [
      ["e", event.id, relays[0], event.pubkey],
      ["p", event.pubkey],
    ];

    const repostTemplates: EventTemplate[] = [];

    if (isKind1) {
      // Standard NIP-18 note repost.
      repostTemplates.push({
        kind: 6,
        created_at,
        tags: baseTags,
        content: JSON.stringify(event),
      });
    } else {
      // Generic repost (NIP-18 kind 16) for non-note content like polls.
      repostTemplates.push({
        kind: 16,
        created_at,
        tags: [...baseTags, ["k", event.kind.toString()]],
        content: "",
      });
      // Also publish a kind-6 repost shaped like a normal note repost. Many
      // clients only surface kind-6 reposts in their feeds, so this is how
      // polls get reposted there too.
      repostTemplates.push({
        kind: 6,
        created_at,
        tags: baseTags,
        content: JSON.stringify(event),
      });
    }

    try {
      for (const template of repostTemplates) {
        const signedEvent = await signEvent(template, user!.privateKey);
        dataLayer.publishEvent(signedEvent);
        addEventToMap(signedEvent);
      }
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

  // Count unique reposters for this event
  const repostCount = new Set(
    (repostsMap?.get(event.id) || []).map((e: Event) => e.pubkey)
  ).size;

  return (
    <div style={{ marginLeft: 20 }}>
      <span
        onClick={handleIconClick}
        style={{
          cursor: "pointer",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          padding: 2,
        }}
      >
        <RepeatIcon
          sx={
            reposted
              ? {
                  fontSize: 20,
                  color: theme.palette.primary.main,
                  "& path": {
                    stroke: theme.palette.primary.main,
                    strokeWidth: 2,
                  },
                }
              : {
                  fontSize: 20,
                }
          }
        />
        {repostCount > 0 && (
          <Typography
            variant="caption"
            sx={{ color: reposted ? theme.palette.primary.main : "inherit" }}
          >
            {repostCount}
          </Typography>
        )}
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
