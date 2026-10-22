import React, { useEffect, useMemo, useState } from "react";
import { Avatar, Box, ButtonBase, Typography, useTheme } from "@mui/material";
import SearchIcon from "@mui/icons-material/SearchRounded";
import AddIcon from "@mui/icons-material/AddRounded";
import { Event, nip19 } from "nostr-tools";
import { useLocation, useNavigate } from "react-router-dom";
import { collectOnce } from "../../dataLayer/collect";
import { useRelayHydrated } from "../../dataLayer/hooks";
import { useUserContext } from "../../hooks/useUserContext";
import { useListContext } from "../../hooks/useListContext";
import { useAppContext } from "../../hooks/useAppContext";
import { SearchModal } from "../Search/SearchModal";
import { sectionColorFrom } from "./useSectionColor";
import { getPackMeta, KIND_FOLLOW_PACK, packNaddr } from "../FollowPacks/packUtils";
import { safeSetItem } from "../../utils/localStorage";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";

export const RIGHT_RAIL_WIDTH = 300;

const KIND_POLL = 1068;
const TRENDING_WINDOW = 48 * 3600;

const panelSx = {
  bgcolor: "cb.slab",
  borderRadius: "26px",
  p: 2,
} as const;

const PanelTitle: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.25 }}>
    <Typography
      component="h2"
      sx={{ fontSize: 12, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "text.secondary" }}
    >
      {children}
    </Typography>
    {action}
  </Box>
);

const rowSx = {
  display: "flex",
  alignItems: "center",
  gap: 1.25,
  width: "100%",
  py: 1,
  textAlign: "left",
  fontFamily: "inherit",
  borderRadius: "12px",
  justifyContent: "flex-start",
  "& + &": { borderTop: "1px solid", borderColor: "divider" },
} as const;

function timeLeft(endsAt: number): string {
  const s = endsAt - Math.floor(Date.now() / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min left`;
  if (s < 86400) return `${Math.round(s / 3600)} hours left`;
  const d = Math.round(s / 86400);
  return `${d} day${d === 1 ? "" : "s"} left`;
}

/**
 * Hashtags counted over recent notes and polls already in the local cache: what's
 * moving right now, at no network cost. Hidden until there is enough to rank.
 */
function useTrendingTopics(hydrated: boolean, limit = 8) {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    if (!hydrated) return;
    let alive = true;
    const run = () =>
      collectOnce(
        [{ kinds: [1, KIND_POLL], since: Math.floor(Date.now() / 1000) - TRENDING_WINDOW, limit: 1000 }],
        { localOnly: true },
      ).then((events) => {
        if (!alive) return;
        // Rank by distinct authors (one prolific poster can't trend a tag on
        // their own), then by total uses.
        const byTag = new Map<string, { authors: Set<string>; uses: number }>();
        for (const e of events) {
          for (const t of e.tags) {
            if (t[0] !== "t" || !t[1]) continue;
            const tag = t[1].toLowerCase().replace(/^#/, "");
            if (tag.length < 2 || tag.length > 32) continue;
            const entry = byTag.get(tag) ?? { authors: new Set<string>(), uses: 0 };
            entry.authors.add(e.pubkey);
            entry.uses += 1;
            byTag.set(tag, entry);
          }
        }
        const ranked = Array.from(byTag.entries()).sort(
          (a, b) => b[1].authors.size - a[1].authors.size || b[1].uses - a[1].uses,
        );
        const shared = ranked.filter(([, v]) => v.authors.size >= 2);
        // Top up a thin list with tags one person used repeatedly.
        const extra = ranked.filter(([, v]) => v.authors.size < 2 && v.uses >= 3);
        setTags([...shared, ...extra].slice(0, Math.max(6, Math.min(limit, shared.length))).map(([tag]) => tag));
      });
    run();
    const id = setInterval(run, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [hydrated, limit]);
  return tags;
}

/** Open polls from the local cache, soonest end first. Relays can't sort by endsAt. */
function useClosingSoon(hydrated: boolean, limit = 3) {
  const [polls, setPolls] = useState<{ event: Event; endsAt: number }[]>([]);
  useEffect(() => {
    if (!hydrated) return;
    let alive = true;
    const run = () =>
      collectOnce([{ kinds: [KIND_POLL], limit: 500 }], { localOnly: true }).then((events) => {
        if (!alive) return;
        const now = Math.floor(Date.now() / 1000);
        setPolls(
          events
            .map((event) => ({ event, endsAt: Number(event.tags.find((t) => t[0] === "endsAt")?.[1]) }))
            .filter((p) => Number.isFinite(p.endsAt) && p.endsAt > now)
            .sort((a, b) => a.endsAt - b.endsAt)
            .slice(0, limit),
        );
      });
    run();
    const id = setInterval(run, 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [hydrated, limit]);
  return polls;
}

/** Packs from people you follow (one small relay query), shown under your own. */
function useFollowedPacks(follows: string[] | undefined, hydrated: boolean) {
  const [packs, setPacks] = useState<Event[]>([]);
  const key = follows?.length ?? 0;
  useEffect(() => {
    if (!hydrated || !follows?.length) return;
    let alive = true;
    collectOnce([{ kinds: [KIND_FOLLOW_PACK], authors: follows, limit: 6 }]).then((events) => {
      if (alive) setPacks(events.sort((a, b) => b.created_at - a.created_at));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, key]);
  return packs;
}

/**
 * Desktop right column (wide screens): search, trending topics, polls closing
 * soon, and follow packs — your own first.
 */
const RightRail: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const hydrated = useRelayHydrated();
  const { user } = useUserContext();
  const { lists } = useListContext();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const [searchOpen, setSearchOpen] = useState(false);

  const trending = useTrendingTopics(hydrated);
  const closing = useClosingSoon(hydrated);
  const followedPacks = useFollowedPacks(user?.follows, hydrated);

  const packs = useMemo(() => {
    const mine = Array.from(lists?.values() || [])
      .filter((e) => e.kind === KIND_FOLLOW_PACK && e.pubkey === user?.pubkey)
      .sort((a, b) => b.created_at - a.created_at);
    const seen = new Set(mine.map((e) => e.id));
    return [...mine, ...followedPacks.filter((e) => !seen.has(e.id))].slice(0, 4);
  }, [lists, followedPacks, user?.pubkey]);

  useEffect(() => {
    packs.forEach((p) => {
      if (!profiles?.get(p.pubkey)) fetchUserProfileThrottled(p.pubkey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packs]);

  const openMyPacks = () => {
    safeSetItem("pollerama:followPacksSource", "mine");
    navigate("/feeds/follow-packs");
  };

  return (
    <Box
      component="aside"
      aria-label="Discover"
      sx={{
        width: RIGHT_RAIL_WIDTH,
        flexShrink: 0,
        py: 2,
        display: "flex",
        flexDirection: "column",
        gap: 1.75,
        overflowY: "auto",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      <ButtonBase
        onClick={() => setSearchOpen(true)}
        sx={{
          ...panelSx,
          py: 0,
          height: 52,
          borderRadius: "18px",
          justifyContent: "flex-start",
          gap: 1.25,
          fontFamily: "inherit",
          fontSize: 14.5,
          color: "text.secondary",
        }}
      >
        <SearchIcon />
        <Box component="span" sx={{ flex: 1, textAlign: "left" }}>
          Search Pollerama
        </Box>
        <Box
          component="kbd"
          sx={{ fontFamily: "inherit", fontSize: 11.5, fontWeight: 800, px: 0.9, py: 0.25, borderRadius: "7px", bgcolor: "cb.inner" }}
        >
          Ctrl K
        </Box>
      </ButtonBase>

      {trending.length >= 3 && (
        <Box sx={panelSx}>
          <PanelTitle>Trending topics</PanelTitle>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {trending.map((tag, i) => {
              const c = sectionColorFrom(theme.palette.cb, i);
              const active = location.pathname === `/feeds/topics/${tag}`;
              return (
                <ButtonBase
                  key={tag}
                  onClick={() => navigate(`/feeds/topics/${encodeURIComponent(tag)}`)}
                  sx={{
                    height: 32,
                    px: 1.5,
                    borderRadius: "12px",
                    fontFamily: "inherit",
                    fontWeight: 700,
                    fontSize: 13.5,
                    background: c.fill,
                    color: c.on,
                    boxShadow: active ? (t) => `0 0 0 2px ${t.palette.text.primary}` : "none",
                  }}
                >
                  #{tag}
                </ButtonBase>
              );
            })}
          </Box>
        </Box>
      )}

      {closing.length >= 2 && (
        <Box sx={panelSx}>
          <PanelTitle>Closing soon</PanelTitle>
          {closing.map(({ event, endsAt }) => (
            <ButtonBase
              key={event.id}
              sx={rowSx}
              onClick={() => navigate(`/respond/${nip19.neventEncode({ id: event.id, author: event.pubkey })}`)}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  sx={{
                    fontWeight: 700,
                    fontSize: 14,
                    lineHeight: 1.35,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {event.content || "Untitled poll"}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {timeLeft(endsAt)}
                </Typography>
              </Box>
            </ButtonBase>
          ))}
        </Box>
      )}

      <Box sx={panelSx}>
        <PanelTitle
          action={
            user && (
              <ButtonBase
                onClick={() => navigate("/feeds/follow-packs/new")}
                sx={{ fontFamily: "inherit", fontWeight: 800, fontSize: 13, gap: 0.25, borderRadius: "8px", px: 0.5 }}
              >
                <AddIcon sx={{ fontSize: 18 }} />
                New
              </ButtonBase>
            )
          }
        >
          Follow packs
        </PanelTitle>
        {packs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {user ? "Make a pack: a list of people others can follow in one tap." : "Log in to see packs from people you follow."}
          </Typography>
        ) : (
          packs.map((pack) => {
            const meta = getPackMeta(pack);
            const mine = pack.pubkey === user?.pubkey;
            return (
              <ButtonBase key={pack.id} sx={rowSx} onClick={() => navigate(`/feeds/follow-packs/${packNaddr(pack)}`)}>
                <Avatar
                  variant="rounded"
                  src={meta.image || profiles?.get(pack.pubkey)?.picture || DEFAULT_IMAGE_URL}
                  sx={{ width: 36, height: 36, borderRadius: "12px" }}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontWeight: 700, fontSize: 14 }}>
                    {meta.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div" noWrap>
                    {meta.members.length} people
                    {mine ? " · yours" : ""}
                  </Typography>
                </Box>
              </ButtonBase>
            );
          })
        )}
        {user && (
          <ButtonBase
            onClick={openMyPacks}
            sx={{ mt: 1, fontFamily: "inherit", fontWeight: 700, fontSize: 13, color: "text.secondary", borderRadius: "8px", px: 0.5 }}
          >
            Manage your packs
          </ButtonBase>
        )}
      </Box>

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Box>
  );
};

export default RightRail;
