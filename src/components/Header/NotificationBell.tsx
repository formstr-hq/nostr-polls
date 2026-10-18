import React from "react";
import { Badge, IconButton } from "@mui/material";
import NotificationsIcon from "@mui/icons-material/NotificationsRounded";
import { useNostrNotifications } from "../../contexts/nostr-notification-context";
import { useNavigate } from "react-router-dom";

export const NotificationBell: React.FC = () => {
  const { unreadCount } = useNostrNotifications();
  const navigate = useNavigate();

  return (
    <IconButton color="inherit" onClick={() => navigate("/notifications")} aria-label="Notifications">
      <Badge
        badgeContent={unreadCount}
        invisible={unreadCount === 0}
        max={99}
        // Colors come from the block header, which inverts its badges.
        color="primary"
      >
        <NotificationsIcon />
      </Badge>
    </IconButton>
  );
};
