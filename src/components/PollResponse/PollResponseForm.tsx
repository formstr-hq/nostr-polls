// PollResponseForm.tsx
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Menu,
  CardActions,
  CardHeader,
  Avatar,
  Typography,
  Alert,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useMediaQuery } from "@mui/material";
import { Event } from "nostr-tools/lib/types/core";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { openProfileTab, signEvent } from "../../nostr";
import { useRelays } from "../../hooks/useRelays";
import { useListContext } from "../../hooks/useListContext";
import { calculateTimeAgo } from "../../utils/common";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { useAppContext } from "../../hooks/useAppContext";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CellTowerIcon from "@mui/icons-material/CellTower";
import CircularProgress from "@mui/material/CircularProgress";
import { waitForPublish } from "../../utils/publish";
import { TextWithImages } from "../Common/Parsers/TextWithImages";
import { Filters } from "./Filter";
import { useUserContext } from "../../hooks/useUserContext";
import { ProofofWorkModal } from "./ProofofWorkModal";
import { getAppBaseUrl } from "../../utils/platform";
import { bytesToHex } from "@noble/hashes/utils";
import dayjs from "dayjs";
import { useMiningWorker } from "../../hooks/useMiningWorker";
import PollTimer from "./PollTimer";
import { FeedbackMenu } from "../FeedbackMenu";
import { useNotification } from "../../contexts/notification-context";
import { NOTIFICATION_MESSAGES } from "../../constants/notifications";
import { pool } from "../../singletons";
import { useReports } from "../../hooks/useReports";
import { ReportDialog } from "../Report/ReportDialog";
import { ReportReason } from "../../contexts/reports-context";
import FlagIcon from "@mui/icons-material/Flag";
import OverlappingAvatars from "../Common/OverlappingAvatars";
import PollOptions from "./PollOptions";
import { usePollResults } from "../../hooks/usePollResults";

interface PollResponseFormProps {
  pollEvent: Event;
  userResponse?: Event;
}

const PollResponseForm: React.FC<PollResponseFormProps> = ({
  pollEvent,
  userResponse,
}) => {
  const theme = useTheme();
  const isSmall = useMediaQuery(theme.breakpoints.down("sm"));
  const isMedium = useMediaQuery(theme.breakpoints.between("sm", "md"));
  const maxContentHeight = isSmall ? 400 : isMedium ? 500 : 600;
  const primaryColor = theme.palette.primary.main;

  const [responses, setResponses] = useState<string[]>(
    userResponse?.tags.filter((t) => t[0] === "response")?.map((t) => t[1]) || []
  );
  const [showResults, setShowResults] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const [isDetailsOpen, setIsDetailsOpen] = useState<boolean>(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{
    accepted: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string>("");
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [filterPubkeys, setFilterPubkeys] = useState<string[]>([]);
  const [showPoWModal, setShowPoWModal] = useState<boolean>(false);
  const [showContactListWarning, setShowContactListWarning] = useState(false);
  const [pendingFollowKey, setPendingFollowKey] = useState<string | null>(null);
  const [reportPollDialogOpen, setReportPollDialogOpen] = useState(false);
  const [reportAuthorDialogOpen, setReportAuthorDialogOpen] = useState(false);
  const [showReportedAnyway, setShowReportedAnyway] = useState(false);

  const navigate = useNavigate();
  const { showNotification } = useNotification();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { user, setUser, requestLogin } = useUserContext();
  const { relays } = useRelays();
  const { fetchLatestContactList } = useListContext();
  const { reportEvent, reportUser, isReportedByMe, getWoTReporters, wotReportThreshold, requestUserReportCheck } = useReports();

  const difficulty = Number(
    pollEvent.tags.find((t) => t[0] === "PoW")?.[1]
  );
  const pollExpiration = pollEvent.tags.find((t) => t[0] === "endsAt")?.[1];
  const now = dayjs();
  const { minePow, cancelMining, progress } = useMiningWorker(difficulty);
  const pollType =
    pollEvent.tags.find((t) => t[0] === "polltype")?.[1] || "singlechoice";
  const options = pollEvent.tags.filter(
    (t) => t[0] === "option"
  ) as [string, string, string][];
  const label =
    pollEvent.tags.find((t) => t[0] === "label")?.[1] || pollEvent.content;

  // Fetch results lazily — only when the user wants to see them (or after voting)
  const { results } = usePollResults(
    pollEvent,
    difficulty,
    filterPubkeys,
    showResults
  );

  // Check whether the content area overflows its maxHeight cap
  const checkOverflow = () => {
    const el = contentRef.current;
    if (el) setIsOverflowing(el.scrollHeight > el.clientHeight);
  };

  useLayoutEffect(() => {
    checkOverflow();
  });

  useEffect(() => {
    if (!profiles?.has(pollEvent.pubkey)) {
      fetchUserProfileThrottled(pollEvent.pubkey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollEvent.pubkey]);

  useEffect(() => {
    requestUserReportCheck([pollEvent.pubkey]);
  }, [pollEvent.pubkey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBroadcast = async () => {
    if (isBroadcasting) return;
    setIsBroadcasting(true);
    setBroadcastResult(null);
    try {
      const res = await waitForPublish(relays, pollEvent);
      setBroadcastResult({ accepted: res.accepted, total: res.total });
    } catch {
      setBroadcastResult({ accepted: 0, total: relays.length });
    } finally {
      setIsBroadcasting(false);
    }
  };

  const updateContactList = async (
    contactEvent: Event | null,
    pubkeyToAdd: string
  ) => {
    const existingTags = contactEvent?.tags || [];
    const pTags = existingTags.filter(([t]) => t === "p").map(([, pk]) => pk);
    if (pTags.includes(pubkeyToAdd)) return;
    const updatedTags = [...existingTags, ["p", pubkeyToAdd]];
    const newEvent = {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags: updatedTags,
      content: contactEvent?.content || "",
    };
    const signed = await signEvent(newEvent);
    pool.publish(relays, signed);
    setUser({ pubkey: signed.pubkey, ...user, follows: [...pTags, pubkeyToAdd] });
  };

  const addToContacts = async () => {
    if (!user) { requestLogin(); return; }
    const pubkeyToAdd = pollEvent.pubkey;
    const contactEvent = await fetchLatestContactList();
    if (!contactEvent) {
      setPendingFollowKey(pubkeyToAdd);
      setShowContactListWarning(true);
      return;
    }
    await updateContactList(contactEvent, pubkeyToAdd);
  };

  const displaySubmit = () => {
    if (showResults) return false;
    if (pollExpiration && Number(pollExpiration) * 1000 < now.valueOf()) return false;
    return true;
  };

  const handleResponseChange = (optionValue: string) => {
    if (error) setError("");
    if (pollType === "singlechoice") {
      setResponses([optionValue]);
    } else {
      setResponses((prev) =>
        prev.includes(optionValue)
          ? prev.filter((v) => v !== optionValue)
          : [...prev, optionValue]
      );
    }
  };

  const handleSubmitResponse = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (responses.length === 0) {
      setError("Please select at least one option before submitting.");
      return;
    }

    let responseUser = user;
    if (!user) {
      showNotification(NOTIFICATION_MESSAGES.ANONYMOUS_LOGIN, "success");
      const secret = generateSecretKey();
      const pubkey = getPublicKey(secret);
      responseUser = { pubkey, privateKey: bytesToHex(secret) };
      setUser(responseUser);
    }

    const responseEvent = {
      kind: 1018,
      content: "",
      tags: [["e", pollEvent.id], ...responses.map((r) => ["response", r])],
      created_at: Math.floor(Date.now() / 1000),
      pubkey: responseUser!.pubkey,
    };

    let useEvent = responseEvent;
    if (difficulty) {
      setShowPoWModal(true);
      const minedEvent = await minePow(responseEvent).catch(() => undefined);
      if (!minedEvent) { setShowPoWModal(false); return; }
      useEvent = minedEvent;
    }

    setShowPoWModal(false);
    const signedResponse = await signEvent(useEvent, responseUser!.privateKey);
    const eventRelays = pollEvent.tags.filter((t) => t[0] === "relay").map((t) => t[1]);
    pool.publish(eventRelays.length ? eventRelays : relays, signedResponse!);
    setShowResults(true);
  };

  const handleCopyNevent = async () => {
    const nevent = nip19.neventEncode({ id: pollEvent.id });
    try {
      await navigator.clipboard.writeText(nevent);
      showNotification(NOTIFICATION_MESSAGES.NEVENT_COPIED, "success");
    } catch {
      showNotification(NOTIFICATION_MESSAGES.COPY_FAILED, "error");
    }
    setAnchorEl(null);
    setIsDetailsOpen(false);
  };

  const copyPollUrl = async () => {
    const nevent = nip19.neventEncode({ id: pollEvent.id });
    try {
      await navigator.clipboard.writeText(`${getAppBaseUrl()}/respond/${nevent}`);
      showNotification(NOTIFICATION_MESSAGES.POLL_URL_COPIED, "success");
    } catch {
      showNotification(NOTIFICATION_MESSAGES.POLL_URL_COPY_FAILED, "error");
    }
  };

  const handleCopyNpub = async () => {
    try {
      await navigator.clipboard.writeText(nip19.npubEncode(pollEvent.pubkey));
      showNotification(NOTIFICATION_MESSAGES.NPUB_COPIED, "success");
    } catch {
      showNotification(NOTIFICATION_MESSAGES.COPY_FAILED, "error");
    }
    setAnchorEl(null);
    setIsDetailsOpen(false);
  };

  const copyRawEvent = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(pollEvent, null, 2));
      showNotification(NOTIFICATION_MESSAGES.RAW_EVENT_COPIED, "success");
    } catch {
      showNotification(NOTIFICATION_MESSAGES.COPY_FAILED, "error");
    }
    setAnchorEl(null);
    setIsDetailsOpen(false);
  };

  const subtleGradient = `linear-gradient(to bottom, ${alpha(theme.palette.background.paper ?? "#fff", 0)}, ${alpha(primaryColor, 0.55)} 100%)`;

  const wotEventReporters = getWoTReporters(pollEvent.id);
  const wotAuthorReporters = getWoTReporters(pollEvent.pubkey);
  const wotReporters = new Set([
    ...Array.from(wotEventReporters),
    ...Array.from(wotAuthorReporters),
  ]);
  const hiddenByReport =
    !showReportedAnyway &&
    (isReportedByMe(pollEvent.id) ||
      isReportedByMe(pollEvent.pubkey) ||
      (wotReportThreshold > 0 && wotReporters.size >= wotReportThreshold));

  const handleReportPoll = async (reason: ReportReason, content: string) => {
    await reportEvent(pollEvent.id, pollEvent.pubkey, reason, content);
    showNotification("Poll reported", "success");
  };

  const handleReportAuthor = async (reason: ReportReason, content: string) => {
    await reportUser(pollEvent.pubkey, reason, content);
    showNotification("User reported", "success");
  };

  if (hiddenByReport) {
    return (
      <div>
        <Card variant="outlined" sx={{ m: 1, p: 1.5, border: "1px dashed #e57373" }}>
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <Typography variant="body2" color="text.secondary">
              Content hidden — reported by
            </Typography>
            <OverlappingAvatars
              ids={
                isReportedByMe(pollEvent.id) && wotReporters.size === 0
                  ? [user!.pubkey]
                  : isReportedByMe(pollEvent.id)
                  ? [user!.pubkey, ...Array.from(wotReporters)]
                  : Array.from(wotReporters)
              }
              maxAvatars={5}
            />
            <Button size="small" sx={{ ml: "auto" }} onClick={() => setShowReportedAnyway(true)}>
              Show anyway
            </Button>
          </Box>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Card variant="elevation" className="poll-response-form" sx={{ mx: { xs: 0, sm: 1 }, my: 1 }}>
        <form onSubmit={handleSubmitResponse}>
          <Card variant="outlined">
            <CardHeader
              avatar={
                <Avatar
                  src={profiles?.get(pollEvent.pubkey)?.picture || DEFAULT_IMAGE_URL}
                  onClick={() => openProfileTab(nip19.npubEncode(pollEvent.pubkey), navigate)}
                  sx={{ cursor: "pointer" }}
                />
              }
              title={
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography>
                    {profiles?.get(pollEvent.pubkey)?.name ||
                      profiles?.get(pollEvent.pubkey)?.username ||
                      profiles?.get(pollEvent.pubkey)?.nip05 ||
                      (() => {
                        const npub = nip19.npubEncode(pollEvent.pubkey);
                        return npub.slice(0, 6) + "…" + npub.slice(-4);
                      })()}
                  </Typography>
                  {user && !user.follows?.includes(pollEvent.pubkey) && (
                    <Button onClick={addToContacts}>Follow</Button>
                  )}
                </div>
              }
              subheader={calculateTimeAgo(pollEvent.created_at)}
              action={
                <IconButton
                  onClick={(e) => {
                    setIsDetailsOpen(!isDetailsOpen);
                    setAnchorEl(e.currentTarget);
                  }}
                >
                  <MoreVertIcon />
                </IconButton>
              }
              sx={{ m: 0, pl: 2, pt: 1 }}
            />

            <Menu
              open={isDetailsOpen}
              anchorEl={anchorEl}
              onClose={() => { setAnchorEl(null); setIsDetailsOpen(false); }}
            >
              <MenuItem onClick={handleBroadcast} disabled={isBroadcasting} sx={{ gap: 1 }}>
                {isBroadcasting ? (
                  <CircularProgress size={16} />
                ) : (
                  <CellTowerIcon
                    fontSize="small"
                    sx={broadcastResult ? { color: broadcastResult.accepted > 0 ? "success.main" : "error.main" } : {}}
                  />
                )}
                {isBroadcasting
                  ? "Broadcasting…"
                  : broadcastResult
                  ? `Broadcasted: ${broadcastResult.accepted} / ${broadcastResult.total} relays`
                  : "Broadcast"}
              </MenuItem>
              <MenuItem onClick={handleCopyNevent}>Copy Event Id</MenuItem>
              <MenuItem onClick={copyPollUrl}>Copy URL</MenuItem>
              <MenuItem onClick={handleCopyNpub}>Copy Author npub</MenuItem>
              <MenuItem onClick={copyRawEvent}>Copy Raw Event</MenuItem>
              {user && (
                <MenuItem
                  onClick={() => {
                    setIsDetailsOpen(false);
                    setAnchorEl(null);
                    setReportPollDialogOpen(true);
                  }}
                  sx={{ color: "error.main" }}
                >
                  <FlagIcon fontSize="small" sx={{ mr: 1 }} />
                  Report poll
                </MenuItem>
              )}
              {user && (
                <MenuItem
                  onClick={() => {
                    setIsDetailsOpen(false);
                    setAnchorEl(null);
                    setReportAuthorDialogOpen(true);
                  }}
                  sx={{ color: "error.main" }}
                >
                  <FlagIcon fontSize="small" sx={{ mr: 1 }} />
                  Report author
                </MenuItem>
              )}
            </Menu>

            {/* Clipped content area with "See more" */}
            <Box sx={{ position: "relative" }}>
              <CardContent
                ref={contentRef}
                sx={{
                  position: "relative",
                  overflow: isExpanded ? "visible" : "hidden",
                  maxHeight: isExpanded ? "none" : maxContentHeight,
                  transition: "max-height 0.3s ease",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Typography variant="body1" sx={{ mb: 1 }}>
                  <TextWithImages content={label} tags={pollEvent.tags} />
                </Typography>

                <div style={{ display: "flex", flexDirection: "column", marginBottom: 8 }}>
                  {difficulty > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      required difficulty: {difficulty} bits
                    </Typography>
                  )}
                  <PollTimer pollExpiration={pollExpiration} />
                </div>

                <PollOptions
                  options={options}
                  pollType={pollType as "singlechoice" | "multiplechoice"}
                  selectedResponses={responses}
                  onResponseChange={handleResponseChange}
                  disabled={!!userResponse || showResults}
                  showResults={showResults}
                  results={results}
                  tags={pollEvent.tags}
                />

                {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

                {/* See more overlay */}
                {!isExpanded && isOverflowing && (
                  <Box
                    sx={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      width: "100%",
                      height: 64,
                      background: subtleGradient,
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "flex-end",
                      pointerEvents: "none",
                    }}
                  >
                    <Box sx={{ backdropFilter: "blur(6px)", pb: 1, pointerEvents: "auto" }}>
                      <Button variant="contained" size="small" onClick={() => setIsExpanded(true)}>
                        See more
                      </Button>
                    </Box>
                  </Box>
                )}
              </CardContent>
            </Box>

            <CardActions>
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                {displaySubmit() ? (
                  <Button type="submit" variant="contained" color="primary">
                    Submit Response
                  </Button>
                ) : (
                  <div />
                )}
                <div style={{ display: "flex", flexDirection: "row" }}>
                  {showResults && (
                    <Filters onChange={(pubkeys) => setFilterPubkeys(pubkeys)} />
                  )}
                  <Button
                    onClick={() => setShowResults((v) => !v)}
                    color="secondary"
                    variant="contained"
                  >
                    {showResults ? "hide results" : "results"}
                  </Button>
                </div>
              </div>
            </CardActions>
          </Card>
        </form>
        <FeedbackMenu event={pollEvent} />
      </Card>

      <ProofofWorkModal
        show={showPoWModal}
        progress={progress}
        targetDifficulty={difficulty}
        onCancel={() => { cancelMining(); setShowPoWModal(false); }}
      />

      <Dialog open={showContactListWarning} onClose={() => setShowContactListWarning(false)}>
        <DialogTitle>Warning</DialogTitle>
        <DialogContent>
          <Typography>
            We couldn't find your existing contact list. If you continue, your
            follow list will only contain this person.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowContactListWarning(false)}>Cancel</Button>
          <Button
            onClick={() => {
              if (pendingFollowKey) updateContactList(null, pendingFollowKey);
              setShowContactListWarning(false);
              setPendingFollowKey(null);
            }}
            color="primary"
            variant="contained"
          >
            Continue Anyway
          </Button>
        </DialogActions>
      </Dialog>

      <ReportDialog
        open={reportPollDialogOpen}
        onClose={() => setReportPollDialogOpen(false)}
        onSubmit={handleReportPoll}
        title="Report poll"
      />
      <ReportDialog
        open={reportAuthorDialogOpen}
        onClose={() => setReportAuthorDialogOpen(false)}
        onSubmit={handleReportAuthor}
        title="Report author"
      />
    </div>
  );
};

export default PollResponseForm;
