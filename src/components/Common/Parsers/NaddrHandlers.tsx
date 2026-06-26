import React, { useEffect, useMemo, useState } from "react";
import { Event, nip19 } from "nostr-tools";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Typography,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import { useNip89 } from "../../../contexts/Nip89Context";
import { useAppContext } from "../../../hooks/useAppContext";
import { useNavigate } from "react-router-dom";
import { dataLayer } from "@formstr/local-relay";
import { ArticleCard } from "../../Articles/ArticleCard";
import { MusicCard, KIND_MUSIC } from "../../Music/MusicCard";

// Addressable kinds we fetch and render inline rather than offloading to a
// NIP-89 "Open with" handler card.
const INLINE_KINDS = [30023, KIND_MUSIC];

export const NaddrHandlers: React.FC<{ encoded: string }> = ({ encoded }) => {
  const { handlersMap, registerKind } = useNip89();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const navigate = useNavigate();
  const [inlineEvent, setInlineEvent] = useState<Event | null>(null);
  const [inlineLoading, setInlineLoading] = useState(false);

  const decoded = useMemo(() => {
    try {
      const { type, data } = nip19.decode(encoded);
      return type === "naddr" ? data : null;
    } catch {
      return null;
    }
  }, [encoded]);

  useEffect(() => {
    if (decoded) registerKind(decoded.kind);
  }, [decoded, registerKind]);

  // Fetch the event inline for kinds we render ourselves (articles, music)
  useEffect(() => {
    if (!decoded || !INLINE_KINDS.includes(decoded.kind)) return;
    setInlineLoading(true);

    // Feed the naddr's relay hints into the gossip pool. The hint is often the
    // ONLY relay that hosts the addressable event (a niche music/Wavlake relay
    // that isn't in the user's set or the author's outbox), so without this the
    // worker never queries it and the card is stuck on the fallback.
    (decoded.relays ?? []).forEach((url) => dataLayer.addGossipRelay(url));

    // Fetch author-LESS (by kind + d-tag only): per the worker's routing,
    // author-scoped reads are outbox-partitioned and the gossip pool stays out,
    // so an author-scoped filter would never use the hint relays we just added.
    // Author-less reads hit user relays ∪ the gossip pool. We re-assert the
    // identity (pubkey + d) in onEvent so a same-d event from another author
    // can't slip in.
    const handle = dataLayer.observe(
      [{ kinds: [decoded.kind], "#d": [decoded.identifier], limit: 1 }],
      {
        onEvent: (e) => {
          if (e.pubkey !== decoded.pubkey) return;
          setInlineEvent(e);
          setInlineLoading(false);
          if (!profiles?.get(e.pubkey)) fetchUserProfileThrottled(e.pubkey);
        },
        // No onEose: the event arrives via onEvent after the worker's upstream
        // fetch; the timeout below closes the interest.
      }
    );
    // Stop the spinner after a grace period, but KEEP the interest open: an
    // addressable event the worker is still warming from relays can arrive after
    // 5s, and tearing down here would strand it on the fallback card permanently.
    const spinnerTimer = setTimeout(() => setInlineLoading(false), 5000);
    return () => { clearTimeout(spinnerTimer); handle.unobserve(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoded]);

  const apps = decoded ? handlersMap.get(decoded.kind) : null;
  const loading = decoded ? !handlersMap.has(decoded.kind) : false;

  // Fetch profiles for all publishers so we can show their names
  useEffect(() => {
    if (!apps) return;
    apps.flatMap((a) => a.publishers).forEach((pk) => {
      if (!profiles?.has(pk)) fetchUserProfileThrottled(pk);
    });
  }, [apps, profiles, fetchUserProfileThrottled]);

  if (!decoded) return null;

  // Render music inline for kind 36787. The app supports this kind natively, so we
  // never fall through to the NIP-89 "Open with" card — that would read as
  // "unsupported". The interest stays open, so this placeholder upgrades to a real
  // MusicCard whenever the track arrives, however late.
  if (decoded.kind === KIND_MUSIC) {
    if (inlineEvent) return <MusicCard event={inlineEvent} />;
    return (
      <Box
        display="flex"
        alignItems="center"
        gap={1}
        sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5, mt: 1, mb: 0.5, maxWidth: 420 }}
      >
        {inlineLoading ? (
          <CircularProgress size={14} />
        ) : (
          <MusicNoteIcon sx={{ fontSize: 18 }} color="disabled" />
        )}
        <Typography variant="caption" color="text.secondary">
          {inlineLoading ? "Loading track…" : "Track unavailable"}
        </Typography>
      </Box>
    );
  }

  // Render article inline for kind 30023
  if (decoded.kind === 30023) {
    if (inlineLoading && !inlineEvent) {
      return (
        <Box display="flex" alignItems="center" gap={1} sx={{ p: 1.5, mt: 1 }}>
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">Loading article…</Typography>
        </Box>
      );
    }
    if (inlineEvent) {
      // Show ArticleCard — clicking it navigates to the in-app reader
      return <ArticleCard event={inlineEvent} />;
    }
    // Fetch failed: offer in-app navigation via the naddr we already have
    const naddrForNav = nip19.naddrEncode({
      kind: decoded.kind,
      pubkey: decoded.pubkey,
      identifier: decoded.identifier,
    });
    return (
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5, mt: 1, mb: 0.5, maxWidth: 420 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<MenuBookIcon sx={{ fontSize: "0.85rem !important" }} />}
          onClick={() => navigate(`/feeds/articles/${naddrForNav}`)}
          sx={{ borderRadius: 2, textTransform: "none", fontSize: "0.8rem" }}
        >
          Read article
        </Button>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        p: 1.5,
        mt: 1,
        mb: 0.5,
        maxWidth: 420,
      }}
    >
      <Typography
        variant="caption"
        color="text.disabled"
        sx={{ display: "block", mb: 1 }}
      >
        kind {decoded.kind} · no inline preview
      </Typography>

      {loading ? (
        <Box display="flex" alignItems="center" gap={1}>
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">
            Looking for apps…
          </Typography>
        </Box>
      ) : !apps || apps.length === 0 ? (
        <Button
          size="small"
          variant="outlined"
          endIcon={<OpenInNewIcon sx={{ fontSize: "0.85rem !important" }} />}
          href={`https://njump.me/${encoded}`}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ borderRadius: 2, textTransform: "none", fontSize: "0.8rem" }}
        >
          View on njump.me
        </Button>
      ) : (
        <>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 1, fontWeight: 600 }}
          >
            Open with
          </Typography>

          <Box display="flex" flexDirection="column" gap={1}>
            {apps.map((app) => {
              const webUrl = app.urlTemplate
                .replace("<naddr>", encoded)
                .replace("{naddr}", encoded);

              const displayedPublishers = app.publishers.slice(0, 3);
              const remainder = app.publishers.length - displayedPublishers.length;
              const byLine =
                displayedPublishers
                  .map((pk) => {
                    const p = profiles?.get(pk);
                    return p?.name || p?.display_name || `${pk.slice(0, 8)}…`;
                  })
                  .join(", ") + (remainder > 0 ? ` +${remainder}` : "");

              return (
                <Box
                  key={app.urlTemplate}
                  display="flex"
                  alignItems="center"
                  gap={1.5}
                >
                  <Avatar
                    src={app.picture}
                    alt={app.name}
                    sx={{ width: 32, height: 32, fontSize: "0.85rem" }}
                  >
                    {app.name[0]}
                  </Avatar>

                  <Box flex={1} minWidth={0}>
                    <Typography variant="body2" fontWeight={600} lineHeight={1.3}>
                      {app.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                      noWrap
                    >
                      by {byLine}
                    </Typography>
                  </Box>

                  <Button
                    size="small"
                    variant="outlined"
                    endIcon={
                      <OpenInNewIcon sx={{ fontSize: "0.8rem !important" }} />
                    }
                    href={webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      borderRadius: 2,
                      textTransform: "none",
                      fontSize: "0.78rem",
                      px: 1.5,
                      py: 0.4,
                      flexShrink: 0,
                    }}
                  >
                    Open
                  </Button>
                </Box>
              );
            })}
          </Box>
        </>
      )}
    </Box>
  );
};
