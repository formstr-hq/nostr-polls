import React, { useState } from "react";
import { Button, CircularProgress } from "@mui/material";
import { EventTemplate } from "nostr-tools";
import { useUserContext } from "../../hooks/useUserContext";
import { useListContext } from "../../hooks/useListContext";
import { ProfileListDialog } from "../Common/ProfileListDialog";
import { signEvent } from "../../nostr";
import { dataLayer } from "@formstr/local-relay";

interface FollowPackMembersDialogProps {
  open: boolean;
  onClose: () => void;
  memberPubkeys: string[];
  packTitle: string;
}

export const FollowPackMembersDialog: React.FC<FollowPackMembersDialogProps> = ({
  open,
  onClose,
  memberPubkeys,
  packTitle,
}) => {
  const { user, setUser } = useUserContext();
  const { fetchLatestContactList } = useListContext();
  const [followingPks, setFollowingPks] = useState<Set<string>>(new Set());

  const handleFollow = async (e: React.MouseEvent, pk: string) => {
    e.stopPropagation();
    if (!user || followingPks.has(pk)) return;
    setFollowingPks((prev) => new Set(prev).add(pk));
    try {
      const contactEvent = await fetchLatestContactList();
      const existingTags = contactEvent?.tags || [];
      const pTags = existingTags.filter(([t]) => t === "p").map(([, p]) => p);
      if (pTags.includes(pk)) return;
      const newEvent: EventTemplate = {
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: [...existingTags, ["p", pk]],
        content: contactEvent?.content || "",
      };
      const signed = await signEvent(newEvent);
      dataLayer.publishEvent(signed);
      setUser((prev) =>
        prev ? { ...prev, follows: [...(prev.follows || []), pk] } : prev
      );
    } finally {
      setFollowingPks((prev) => {
        const s = new Set(prev);
        s.delete(pk);
        return s;
      });
    }
  };

  const renderAction = (pk: string) => {
    if (!user || user.pubkey === pk || user.follows?.includes(pk)) return undefined;
    const isLoading = followingPks.has(pk);
    return (
      <Button
        size="small"
        variant="outlined"
        disabled={isLoading}
        sx={{ minWidth: 70 }}
        onClick={(e) => handleFollow(e, pk)}
      >
        {isLoading ? <CircularProgress size={16} color="inherit" /> : "Follow"}
      </Button>
    );
  };

  return (
    <ProfileListDialog
      open={open}
      onClose={onClose}
      pubkeys={memberPubkeys}
      title={packTitle}
      subtitle={`${memberPubkeys.length} member${memberPubkeys.length !== 1 ? "s" : ""}`}
      renderAction={renderAction}
    />
  );
};
