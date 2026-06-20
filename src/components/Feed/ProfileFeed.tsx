import React, { useEffect, useRef, useState } from "react";
import { Event, Filter } from "nostr-tools";
import { collectOnce } from "../../dataLayer/collect";
import ProfileCard from "../Profile/ProfileCard";
import { useUserContext } from "../../hooks/useUserContext";
import {
  Button,
  Card,
  CardContent,
  CircularProgress,
  Typography,
  Box,
} from "@mui/material";
import RateProfileModal from "../Ratings/RateProfileModal";

const BATCH_SIZE = 20;

const ProfilesFeed: React.FC = () => {
  const [profileEvents, setProfileEvents] = useState<Map<string, Event>>(new Map());
  const [modalOpen, setModalOpen] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const { user } = useUserContext();
  const seen = useRef<Set<string>>(new Set());

  const fetchRatedProfiles = async () => {
    setLoading(true);

    const now = Math.floor(Date.now() / 1000);
    const currentCursor = cursor;
    const ratedNpubs: Set<string> = new Set();
    let oldestTimestamp: number | undefined;

    const ratingFilter: Filter = {
      kinds: [34259],
      "#m": ["profile"],
      limit: BATCH_SIZE,
      until: currentCursor || now,
    };

    // Two-stage collect: gather profile ratings, then their kind-0 metadata.
    // collectOnce keeps each interest open across the worker's upstream fetch
    // (the local EOSE precedes it).
    const ratingEvents = await collectOnce([ratingFilter]);
    for (const event of ratingEvents) {
      const dTag = event.tags.find((t) => t[0] === "d");
      if (dTag && dTag[1].startsWith("profile:")) {
        const npub = dTag[1].split(":")[1];
        if (!seen.current.has(npub)) {
          seen.current.add(npub);
          ratedNpubs.add(npub);
        }
      }
      if (!oldestTimestamp || event.created_at < oldestTimestamp) {
        oldestTimestamp = event.created_at;
      }
    }

    if (ratedNpubs.size > 0) {
      const metaEvents = await collectOnce([
        { kinds: [0], authors: Array.from(ratedNpubs), limit: ratedNpubs.size },
      ]);
      setProfileEvents((prev) => {
        const updated = new Map(prev);
        for (const event of metaEvents) {
          if (!updated.has(event.pubkey)) updated.set(event.pubkey, event);
        }
        return updated;
      });
    }

    if (oldestTimestamp) setCursor(oldestTimestamp - 1);
    setInitialLoadComplete(true);
    setLoading(false);
  };

  useEffect(() => {
    fetchRatedProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const sortedProfiles = Array.from(profileEvents.values()).sort(
    (a, b) => b.created_at - a.created_at
  );

  return (
    <>
      <Card
        onClick={() => setModalOpen(true)}
        sx={{ cursor: "pointer", mb: 2 }}
        variant="outlined"
      >
        <CardContent>
          <Typography variant="h6">Rate any profile</Typography>
          <Typography variant="body2" color="text.secondary">
            Click to enter an npub and rate someone outside your feed.
          </Typography>
        </CardContent>
      </Card>

      {loading && profileEvents.size === 0 ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : (
        <Box>
          <Typography style={{ margin: 10, fontSize: 18 }}>Recently Rated</Typography>
          {sortedProfiles.map((event) => (
            <div key={event.pubkey} style={{ cursor: "pointer" }}>
              <ProfileCard event={event} />
            </div>
          ))}
        </Box>
      )}

      {initialLoadComplete && (
        <Box display="flex" justifyContent="center" my={2}>
          <Button
            onClick={fetchRatedProfiles}
            variant="contained"
            disabled={loading}
            sx={{ cursor: "pointer" }}
          >
            {loading ? <CircularProgress size={24} /> : "Load More"}
          </Button>
        </Box>
      )}

      <RateProfileModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
};

export default ProfilesFeed;
