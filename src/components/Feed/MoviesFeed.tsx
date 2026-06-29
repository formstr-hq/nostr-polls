// components/Feed/MoviesFeed.tsx
import React, { useEffect, useRef, useState } from "react";
import { Filter } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import MovieCard from "../Movies/MovieCard";
import RateMovieModal from "../Ratings/RateMovieModal";
import { Card, CardContent, Typography, CircularProgress, Box, Button } from "@mui/material";

const BATCH_SIZE = 50;

const MoviesFeed: React.FC = () => {
  const [movieIds, setMovieIds] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<number | undefined>(undefined);
  const seen = useRef<Set<string>>(new Set());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);
  const cursorRef = useRef<number | undefined>(undefined);

  // Keep refs in sync
  cursorRef.current = cursor;

  const fetchBatch = () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    // Cancel any in-flight timeout from a previous fetch
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    const currentCursor = cursorRef.current;
    const now = Math.floor(Date.now() / 1000);
    let oldestTimestamp: number | undefined;

    const filter: Filter = {
      kinds: [34259],
      "#m": ["movie"],
      limit: BATCH_SIZE,
      until: currentCursor || now,
    };

    // Finalize once — whichever comes first, EOSE or the fallback timeout.
    // Relying on a fixed short timeout (the old 3s) under a busy relay pool cut
    // the batch off after only a handful of events arrived; waiting for EOSE
    // collects everything the relays actually have.
    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    const finalize = () => {
      if (settled) return;
      settled = true;
      if (quietTimer) clearTimeout(quietTimer);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      handle.unobserve();

      if (oldestTimestamp) {
        setCursor(oldestTimestamp - 1);
        cursorRef.current = oldestTimestamp - 1;
      }

      setInitialLoadComplete(true);
      loadingRef.current = false;
      setLoading(false);
    };

    const handle = dataLayer.observe([filter], {
      onEvent: (event) => {
        const dTag = event.tags.find((t) => t[0] === "d");
        if (dTag && dTag[1].startsWith("movie:")) {
          const imdbId = dTag[1].split(":")[1];
          if (!seen.current.has(imdbId)) {
            seen.current.add(imdbId);

            setMovieIds((prev) => {
              const next = new Set(prev);
              next.add(imdbId);
              return next;
            });
          }
        }

        if (!oldestTimestamp || event.created_at < oldestTimestamp) {
          oldestTimestamp = event.created_at;
        }
        // Settle shortly after the stream goes quiet — local EOSE precedes the
        // worker's upstream fetch under the dataLayer contract.
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finalize, 900);
      },
    });

    // Hard cap so an empty result (no events → no quiet timer) still settles.
    timeoutRef.current = setTimeout(finalize, 8000);
  };

  const handleRated = (imdbId: string) => {
    if (!seen.current.has(imdbId)) {
      seen.current.add(imdbId);
      setMovieIds((prev) => new Set([imdbId, ...Array.from(prev)]));
    }
  };

  // Re-fetch whenever the relay list changes (e.g. when user's relay list
  // finishes loading after startup — RelayContext starts with defaultRelays
  // and replaces them asynchronously).
  useEffect(() => {
    // Cancel any in-flight fetch so the new relays take effect immediately
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    loadingRef.current = false;
    // Reset feed state so the new relay's events start fresh
    seen.current.clear();
    setMovieIds(new Set());
    setCursor(undefined);
    cursorRef.current = undefined;
    setInitialLoadComplete(false);

    fetchBatch();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box sx={{ height: "100%", overflowY: "auto" }}>
      <Card
        variant="outlined"
        sx={{ mb: 2 }}
        onClick={() => setModalOpen(true)}
      >
        <CardContent>
          <Typography variant="h6">Rate Any Movie</Typography>
          <Typography variant="body2" color="text.secondary">
            Click to enter an IMDb ID and submit a rating.
          </Typography>
        </CardContent>
      </Card>

      {loading && movieIds.size === 0 ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : (
        <Box>
          <Typography style={{ margin: 10, fontSize: 18 }}>Recently Rated</Typography>
          {Array.from(movieIds).map((id) => (
            <div key={id}>
              <MovieCard imdbId={id} />
            </div>
          ))}
        </Box>
      )}

      {initialLoadComplete && (
        <Box display="flex" justifyContent="center" my={2}>
          <Button
            onClick={fetchBatch}
            variant="contained"
            disabled={loading}
            sx={{ cursor: "pointer" }}
          >
            {loading ? <CircularProgress size={24} /> : "Load More"}
          </Button>
        </Box>
      )}

      <RateMovieModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onRated={handleRated}
      />
    </Box>
  );
};

export default MoviesFeed;
