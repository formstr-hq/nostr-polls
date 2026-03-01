import React, { useRef, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  Box,
  TextField,
  InputAdornment,
  IconButton,
  Typography,
  CircularProgress,
  Chip,
  List,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Divider,
  Button,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import TagIcon from "@mui/icons-material/Tag";
import PersonIcon from "@mui/icons-material/Person";
import HubIcon from "@mui/icons-material/Hub";
import { useNavigate } from "react-router-dom";
import { nip19, Event } from "nostr-tools";
import { useSearch, Nip19Result } from "./useSearch";
import { useAppContext } from "../../hooks/useAppContext";

const INITIAL_LIMIT = 4;

interface Props {
  open: boolean;
  onClose: () => void;
}

function parseProfile(event: Event): {
  name?: string;
  picture?: string;
  nip05?: string;
  display_name?: string;
} {
  try {
    return JSON.parse(event.content);
  } catch {
    return {};
  }
}

function getNip19Label(type: string): string {
  switch (type) {
    case "npub":
    case "nprofile":
      return "Go to profile";
    case "note":
      return "Go to note";
    case "nevent":
      return "Go to event";
    case "naddr":
      return "Go to article";
    default:
      return "Go to entity";
  }
}

function resolveNip19Path(result: Nip19Result): string | null {
  const { type, data, original } = result;
  switch (type) {
    case "npub":
    case "nprofile":
      return `/profile/${original}`;
    case "note": {
      const nevent = nip19.neventEncode({ id: data as string, kind: 1 });
      return `/note/${nevent}`;
    }
    case "nevent":
    case "naddr":
      return `/note/${original}`;
    default:
      return null;
  }
}

function RelayFooter({ relays }: { relays: string[] }) {
  if (!relays.length) return null;
  const names = relays.map((r) => {
    try {
      return new URL(r).hostname;
    } catch {
      return r;
    }
  });
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 2,
        py: 1,
        borderTop: "1px solid",
        borderColor: "divider",
      }}
    >
      <HubIcon sx={{ fontSize: 12, color: "text.disabled" }} />
      <Typography variant="caption" color="text.disabled">
        via {names.join(" · ")}
      </Typography>
    </Box>
  );
}

function AuthorChip({
  pubkey,
  onNavigate,
}: {
  pubkey: string;
  onNavigate: (path: string) => void;
}) {
  const { getProfile } = useAppContext();
  const profile = getProfile(pubkey);
  const npub = nip19.npubEncode(pubkey);
  const displayName =
    profile?.display_name || profile?.name || npub.slice(0, 12) + "…";

  return (
    <Box
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(`/profile/${npub}`);
      }}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        mb: 0.5,
        cursor: "pointer",
        maxWidth: "100%",
        overflow: "hidden",
        "&:hover .author-name": { textDecoration: "underline" },
      }}
    >
      <Avatar
        src={profile?.picture}
        sx={{ width: 18, height: 18, fontSize: 10, flexShrink: 0 }}
      >
        {displayName[0]}
      </Avatar>
      <Typography
        className="author-name"
        variant="caption"
        color="text.secondary"
        noWrap
        sx={{ lineHeight: 1 }}
      >
        {displayName}
      </Typography>
    </Box>
  );
}

function SeeMoreButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <Box sx={{ px: 2, py: 0.5 }}>
      <Button
        size="small"
        variant="text"
        onClick={onClick}
        sx={{ textTransform: "none", fontSize: "0.75rem" }}
      >
        See {count} more
      </Button>
    </Box>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        fontWeight={600}
        sx={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        {children}
      </Typography>
    </Box>
  );
}

export function SearchModal({ open, onClose }: Props) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const { fetchUserProfileThrottled } = useAppContext();
  const {
    query,
    setQuery,
    inputType,
    nip19Result,
    nip05Pubkey,
    nip05Loading,
    results,
    loading,
    error,
    searchedRelays,
  } = useSearch();

  const [showAllProfiles, setShowAllProfiles] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [showAllPolls, setShowAllPolls] = useState(false);

  // Reset "see more" state whenever results change
  useEffect(() => {
    setShowAllProfiles(false);
    setShowAllNotes(false);
    setShowAllPolls(false);
  }, [results]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Fetch author profiles for notes and polls so AuthorChip can render
  useEffect(() => {
    const pubkeys = new Set([
      ...results.notes.map((e) => e.pubkey),
      ...results.polls.map((e) => e.pubkey),
    ]);
    pubkeys.forEach((pk) => fetchUserProfileThrottled(pk));
  }, [results.notes, results.polls, fetchUserProfileThrottled]);

  const handleClose = () => {
    setQuery("");
    onClose();
  };

  const goTo = (path: string) => {
    navigate(path);
    handleClose();
  };

  const handleNip19Navigate = () => {
    if (!nip19Result) return;
    const path = resolveNip19Path(nip19Result);
    if (path) goTo(path);
  };

  const handleNip05Navigate = () => {
    if (!nip05Pubkey) return;
    goTo(`/profile/${nip19.npubEncode(nip05Pubkey)}`);
  };

  const handleHashtagNavigate = () => {
    const tag = query.trim().slice(1);
    if (tag) goTo(`/feeds/topics/${tag}`);
  };

  const hasResults =
    results.profiles.length > 0 ||
    results.notes.length > 0 ||
    results.polls.length > 0;

  const visibleProfiles = showAllProfiles
    ? results.profiles
    : results.profiles.slice(0, INITIAL_LIMIT);
  const visibleNotes = showAllNotes
    ? results.notes
    : results.notes.slice(0, INITIAL_LIMIT);
  const visiblePolls = showAllPolls
    ? results.polls
    : results.polls.slice(0, INITIAL_LIMIT);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          borderRadius: { xs: 0, sm: 2 },
          mt: { xs: 0, sm: "8vh" },
          mx: { xs: 0, sm: 2 },
          mb: { xs: 0, sm: "auto" },
          // Inset content below the status bar on Android/iOS.
          // border-box sizing means the content area shrinks by this amount,
          // so height:100dvh stays correct without overflow.
          paddingTop: { xs: "env(safe-area-inset-top)", sm: 0 },
          height: { xs: "100dvh", sm: "auto" },
          maxHeight: { xs: "100dvh", sm: "78vh" },
          display: "flex",
          flexDirection: "column",
          overflowX: "hidden",
        },
      }}
    >
      {/* Search input row */}
      <Box
        sx={{ px: 1.5, py: 1, display: "flex", alignItems: "center", gap: 1 }}
      >
        <TextField
          inputRef={inputRef}
          fullWidth
          placeholder="npub, note, user@domain, #topic, or anything..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              handleClose();
            } else if (e.key === "Enter") {
              if (inputType === "nip19" && nip19Result) handleNip19Navigate();
              else if (inputType === "nip05" && nip05Pubkey)
                handleNip05Navigate();
              else if (inputType === "hashtag") handleHashtagNavigate();
            }
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          variant="outlined"
          size="small"
        />
        <IconButton onClick={handleClose} size="small" edge="end">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Divider />

      {/* Results / hints */}
      <DialogContent
        sx={{ p: 0, overflowY: "auto", overflowX: "hidden", flex: 1 }}
      >
        {/* Idle state */}
        {inputType === "idle" && (
          <Box sx={{ p: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Search by npub · note ID · NIP-05 · #topic · or free text
            </Typography>
          </Box>
        )}

        {/* NIP-19 detected */}
        {inputType === "nip19" && (
          <Box sx={{ p: 2 }}>
            {nip19Result ? (
              <Chip
                icon={<ArrowForwardIcon />}
                label={getNip19Label(nip19Result.type)}
                onClick={handleNip19Navigate}
                color="primary"
                clickable
              />
            ) : (
              <Typography variant="body2" color="error">
                Invalid Nostr identifier
              </Typography>
            )}
          </Box>
        )}

        {/* NIP-05 resolution */}
        {inputType === "nip05" && (
          <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 1 }}>
            {nip05Loading ? (
              <>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Resolving {query.trim()}…
                </Typography>
              </>
            ) : nip05Pubkey ? (
              <Chip
                icon={<PersonIcon />}
                label={`Go to ${query.trim()}`}
                onClick={handleNip05Navigate}
                color="primary"
                clickable
              />
            ) : error ? (
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            ) : null}
          </Box>
        )}

        {/* Hashtag shortcut */}
        {inputType === "hashtag" && query.trim().length > 1 && (
          <Box sx={{ p: 2 }}>
            <Chip
              icon={<TagIcon />}
              label={`Browse ${query.trim()}`}
              onClick={handleHashtagNavigate}
              color="primary"
              clickable
            />
          </Box>
        )}

        {/* NIP-50 results */}
        {inputType === "text" && (
          <>
            {loading && (
              <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                <CircularProgress size={24} />
              </Box>
            )}

            {!loading && error && (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="error">
                  {error}
                </Typography>
              </Box>
            )}

            {!loading && !error && query.trim().length >= 2 && !hasResults && (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  No results found
                </Typography>
              </Box>
            )}

            {!loading && !error && hasResults && (
              <>
                {/* Profiles */}
                {results.profiles.length > 0 && (
                  <>
                    <SectionLabel>Profiles</SectionLabel>
                    <List dense disablePadding>
                      {visibleProfiles.map((event) => {
                        const p = parseProfile(event);
                        return (
                          <ListItemButton
                            key={event.id}
                            onClick={() =>
                              goTo(
                                `/profile/${nip19.npubEncode(event.pubkey)}`
                              )
                            }
                            sx={{ minWidth: 0 }}
                          >
                            <ListItemAvatar sx={{ minWidth: 48 }}>
                              <Avatar
                                src={p.picture}
                                sx={{ width: 36, height: 36 }}
                              >
                                {(p.display_name || p.name || "?")[0]}
                              </Avatar>
                            </ListItemAvatar>
                            <ListItemText
                              primary={p.display_name || p.name || "Unknown"}
                              secondary={p.nip05}
                              primaryTypographyProps={{
                                variant: "body2",
                                noWrap: true,
                              }}
                              secondaryTypographyProps={{
                                variant: "caption",
                                noWrap: true,
                              }}
                              sx={{ minWidth: 0, overflow: "hidden" }}
                            />
                          </ListItemButton>
                        );
                      })}
                    </List>
                    {!showAllProfiles &&
                      results.profiles.length > INITIAL_LIMIT && (
                        <SeeMoreButton
                          count={results.profiles.length - INITIAL_LIMIT}
                          onClick={() => setShowAllProfiles(true)}
                        />
                      )}
                  </>
                )}

                {/* Notes */}
                {results.notes.length > 0 && (
                  <>
                    <SectionLabel>Notes</SectionLabel>
                    <List dense disablePadding>
                      {visibleNotes.map((event) => {
                        const nevent = nip19.neventEncode({
                          id: event.id,
                          kind: event.kind,
                        });
                        const preview =
                          event.content.length > 140
                            ? event.content.slice(0, 140) + "…"
                            : event.content;
                        return (
                          <ListItemButton
                            key={event.id}
                            onClick={() => goTo(`/note/${nevent}`)}
                            sx={{
                              alignItems: "flex-start",
                              flexDirection: "column",
                              py: 1,
                              minWidth: 0,
                              overflow: "hidden",
                            }}
                          >
                            <AuthorChip
                              pubkey={event.pubkey}
                              onNavigate={goTo}
                            />
                            <Typography
                              variant="body2"
                              sx={{
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                width: "100%",
                              }}
                            >
                              {preview}
                            </Typography>
                          </ListItemButton>
                        );
                      })}
                    </List>
                    {!showAllNotes &&
                      results.notes.length > INITIAL_LIMIT && (
                        <SeeMoreButton
                          count={results.notes.length - INITIAL_LIMIT}
                          onClick={() => setShowAllNotes(true)}
                        />
                      )}
                  </>
                )}

                {/* Polls */}
                {results.polls.length > 0 && (
                  <>
                    <SectionLabel>Polls</SectionLabel>
                    <List dense disablePadding>
                      {visiblePolls.map((event) => {
                        const question =
                          event.tags.find((t) => t[0] === "question")?.[1] ||
                          event.content ||
                          "Untitled poll";
                        const preview =
                          question.length > 140
                            ? question.slice(0, 140) + "…"
                            : question;
                        return (
                          <ListItemButton
                            key={event.id}
                            onClick={() => goTo(`/respond/${event.id}`)}
                            sx={{
                              alignItems: "flex-start",
                              flexDirection: "column",
                              py: 1,
                              minWidth: 0,
                              overflow: "hidden",
                            }}
                          >
                            <AuthorChip
                              pubkey={event.pubkey}
                              onNavigate={goTo}
                            />
                            <Typography
                              variant="body2"
                              sx={{ wordBreak: "break-word", width: "100%" }}
                            >
                              {preview}
                            </Typography>
                          </ListItemButton>
                        );
                      })}
                    </List>
                    {!showAllPolls &&
                      results.polls.length > INITIAL_LIMIT && (
                        <SeeMoreButton
                          count={results.polls.length - INITIAL_LIMIT}
                          onClick={() => setShowAllPolls(true)}
                        />
                      )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </DialogContent>

      {/* Subtle relay attribution — only shown during/after NIP-50 search */}
      {inputType === "text" && searchedRelays.length > 0 && (
        <RelayFooter relays={searchedRelays} />
      )}
    </Dialog>
  );
}
