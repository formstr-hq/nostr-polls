import React from "react";
import { Badge, IconButton } from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useNostrNotifications } from "../../contexts/nostr-notification-context";
import { useNavigate } from "react-router-dom";

export const NotificationBell: React.FC = () => {
  const { unreadCount } = useNostrNotifications();
  const navigate = useNavigate();

  return (
    <IconButton color="inherit" onClick={() => navigate("/notifications")} sx={{ mr: 1 }}>
      <Badge badgeContent={unreadCount} color="primary" invisible={unreadCount === 0}>
        <NotificationsIcon />
      </Badge>
    </IconButton>
  );
};
