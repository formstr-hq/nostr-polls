import React, { useEffect, useMemo, useState } from "react";
import { Avatar, AvatarGroup, Box, Typography } from "@mui/material";
import { useListContext } from "../../hooks/useListContext";
import { useAppContext } from "../../hooks/useAppContext";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { ProfileListDialog } from "../Common/ProfileListDialog";

const MAX_AVATARS = 4;

/**
 * "Followed by alice, bob +3 others you follow" — the subset of the viewer's
 * own follows who follow `pubkey`, derived from the locally-computed web-of-trust
 * network index. Renders nothing until the index is ready or if there are no
 * mutuals.
 */
export const NetworkFollowedBy: React.FC<{ pubkey: string }> = ({ pubkey }) => {
  const { getNetworkFollowers } = useListContext();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const [dialogOpen, setDialogOpen] = useState(false);

  // getNetworkFollowers is recreated when the index updates, so this recomputes
  // once the background WoT computation finishes.
  const mutuals = useMemo(
    () => getNetworkFollowers(pubkey),
    [getNetworkFollowers, pubkey],
  );

  // Warm the profile cache for the names/avatars we show inline.
  useEffect(() => {
    mutuals.slice(0, MAX_AVATARS).forEach((pk) => {
      if (!profiles.get(pk)) fetchUserProfileThrottled(pk);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutuals]);

  if (mutuals.length === 0) return null;

  const nameOf = (pk: string) => {
    const p = profiles.get(pk);
    return p?.display_name || p?.name || "someone";
  };

  const names = mutuals.slice(0, 2).map(nameOf);
  const others = mutuals.length - names.length;

  let label: string;
  if (mutuals.length === 1) {
    label = `Followed by ${names[0]} (who you follow)`;
  } else if (others > 0) {
    label = `Followed by ${names.join(", ")} and ${others} ${
      others === 1 ? "other" : "others"
    } you follow`;
  } else {
    label = `Followed by ${names[0]} and ${names[1]} you follow`;
  }

  return (
    <>
      <Box
        onClick={() => setDialogOpen(true)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mt: 1,
          cursor: "pointer",
          justifyContent: { xs: "center", sm: "flex-start" },
        }}
      >
        <AvatarGroup
          max={MAX_AVATARS}
          sx={{ "& .MuiAvatar-root": { width: 22, height: 22, fontSize: 10 } }}
        >
          {mutuals.slice(0, MAX_AVATARS).map((pk) => (
            <Avatar
              key={pk}
              src={profiles.get(pk)?.picture || DEFAULT_IMAGE_URL}
              alt={nameOf(pk)}
            />
          ))}
        </AvatarGroup>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ "&:hover": { textDecoration: "underline" } }}
        >
          {label}
        </Typography>
      </Box>
      <ProfileListDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        pubkeys={mutuals}
        title="Followed by people you follow"
        subtitle={`${mutuals.length} ${
          mutuals.length === 1 ? "person" : "people"
        } you follow`}
      />
    </>
  );
};
