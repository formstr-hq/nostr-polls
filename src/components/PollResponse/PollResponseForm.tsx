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
import { copyToClipboard, calculateTimeAgo } from "../../utils/common";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { useAppContext } from "../../hooks/useAppContext";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CellTowerIcon from "@mui/icons-material/CellTower";
import CircularProgress from "@mui/material/CircularProgress";
import { collectOnce } from "../../dataLayer/collect";
import { TextWithImages } from "../Common/Parsers/TextWithImages";
import { Filters } from "./Filter";
import { useUserContext } from "../../hooks/useUserContext";
import { ProofofWorkModal } from "./ProofofWorkModal";
import { getAppBaseUrl } from "../../utils/platform";
import { bytesToHex } from "@noble/hashes/utils.js";
import dayjs from "dayjs";
import { useMiningWorker } from "../../hooks/useMiningWorker";
import PollTimer from "./PollTimer";
import { FeedbackMenu } from "../FeedbackMenu";
import { useNotification } from "../../contexts/notification-context";
import { NOTIFICATION_MESSAGES } from "../../constants/notifications";
import { useReports } from "../../hooks/useReports";
import { ReportDialog } from "../Report/ReportDialog";
import { ReportReason } from "../../contexts/reports-context";
import FlagIcon from "@mui/icons-material/Flag";
import OverlappingAvatars from "../Common/OverlappingAvatars";
import { Nip05Badge } from "../Common/Nip05Badge";
import { RelaySourceModal } from "../Common/RelaySourceModal";
import { PublishDiagnosticModal } from "../Common/PublishDiagnosticModal";
import { useEventRelays } from "../../hooks/useEventRelays";
import { ClientChip } from "../Common/ClientChip";
import { publishDeletion } from "../../utils/deletion";
import { dataLayer, type PublishResult } from "@formstr/local-relay";
import { usePublishDiagnostic } from "../../hooks/usePublishDiagnostic";
import PollOptions from "./PollOptions";
import VotersModal from "./VotersModal";
import { usePollResults } from "../../hooks/usePollResults";
import { useBackClose } from "../../hooks/useBackClose";

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
  const [hasSubmitted, setHasSubmitted] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const [isDetailsOpen, setIsDetailsOpen] = useState<boolean>(false);
  const [relayModalOpen, setRelayModalOpen] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  // Compact summary just for the inline "Broadcasted X/Y" label in the menu
  const [broadcastSummary, setBroadcastSummary] = useState<{ accepted: number; total: number } | null>(null);
  const { result: diagnosticResult, open: diagnosticOpen, setOpen: setDiagnosticOpen, title: diagnosticTitle, openModal: openDiagnostic, retry } = usePublishDiagnostic();
  const [error, setError] = useState<string>("");
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [filterPubkeys, setFilterPubkeys] = useState<string[]>([]);
  const [showPoWModal, setShowPoWModal] = useState<boolean>(false);
  const [showContactListWarning, setShowContactListWarning] = useState(false);
  const [pendingFollowKey, setPendingFollowKey] = useState<string | null>(null);
  const [reportPollDialogOpen, setReportPollDialogOpen] = useState(false);
  const [reportAuthorDialogOpen, setReportAuthorDialogOpen] = useState(false);
  const [showReportedAnyway, setShowReportedAnyway] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [votersModalOpen, setVotersModalOpen] = useState(false);
  const [votersFocusOption, setVotersFocusOption] = useState<string | null>(null);

  const navigate = useNavigate();
  const { showNotification } = useNotification();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { user, setUser, requestLogin } = useUserContext();
  const { relays } = useRelays();
  const { fetchLatestContactList } = useListContext();
  const { reportEvent, reportUser, isReportedByMe, getWoTReporters, wotReportThreshold, requestUserReportCheck } = useReports();
  const eventRelays = useEventRelays(pollEvent.id);
  const handleCloseContactWarning = () => setShowContactListWarning(false);
  useBackClose(showContactListWarning, handleCloseContactWarning);

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
  const { results, totalVotes } = usePollResults(
    pollEvent,
    difficulty,
    filterPubkeys,
    showResults || votersModalOpen
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
    setBroadcastSummary(null);
    try {
      const res = await dataLayer.publishEvent(pollEvent);
      setBroadcastSummary({ accepted: res.accepted, total: res.total });
      openDiagnostic(pollEvent, res, "Broadcast relay results");
    } catch {
      const res: PublishResult = { ok: false, accepted: 0, total: relays.length, relayResults: [] };
      setBroadcastSummary({ accepted: 0, total: relays.length });
      openDiagnostic(pollEvent, res, "Broadcast relay results");
    } finally {
      setIsBroadcasting(false);
    }
  };

  const handleDeletePoll = async () => {
    setIsDetailsOpen(false);
    setAnchorEl(null);
    try {
      const { event: deletionEvent, result } = await publishDeletion([pollEvent.id], [pollEvent.kind]);
      setDeleted(true);
      openDiagnostic(deletionEvent, result, "Delete relay results");
    } catch {
      showNotification("Failed to delete poll", "error");
    }
  };

  const handleClearVotes = async () => {
    setIsDetailsOpen(false);
    setAnchorEl(null);
    if (!user) return;
    try {
      // Snapshot the user's existing votes (a finite set we act on once), then
      // delete them. The worker owns relay routing for both the read and the
      // deletion publish.
      const userResponses = await collectOnce([{
        kinds: [1018, 1070],
        authors: [user.pubkey],
        "#e": [pollEvent.id],
      }]);
      if (userResponses.length === 0) {
        showNotification("No votes found on relays", "info");
        return;
      }
      const ids = userResponses.map((e) => e.id);
      const kinds = Array.from(new Set(userResponses.map((e) => e.kind)));
      const { event: deletionEvent, result } = await publishDeletion(ids, kinds);
      setHasSubmitted(false);
      setResponses([]);
      setShowResults(false);
      openDiagnostic(deletionEvent, result, "Clear votes relay results");
    } catch {
      showNotification("Failed to clear votes", "error");
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
    dataLayer.publishEvent(signed);
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
      tags: [["e", pollEvent.id], ["p", pollEvent.pubkey], ...responses.map((r) => ["response", r])],
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
    const result = await dataLayer.publishEvent(signedResponse!);
    openDiagnostic(signedResponse!, result, "Vote publish results");
    if (result.ok) {
      showNotification(`Vote submitted to ${result.accepted}/${result.total} relays`, "success");
      if (result.accepted < result.total) {
        setDiagnosticOpen(true);
      }
    } else {
      showNotification("No relays accepted your vote", "error");
      setDiagnosticOpen(true);
    }
    setHasSubmitted(true);
    setShowResults(true);
  };

  const handleCopyNevent = async () => {
    const nevent = nip19.neventEncode({ id: pollEvent.id });
    try {
      await copyToClipboard(nevent);
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
      await copyToClipboard(`${getAppBaseUrl()}/respond/${nevent}`);
      showNotification(NOTIFICATION_MESSAGES.POLL_URL_COPIED, "success");
    } catch {
      showNotification(NOTIFICATION_MESSAGES.POLL_URL_COPY_FAILED, "error");
    }
  };

  const handleCopyNpub = async () => {
    try {
      await copyToClipboard(nip19.npubEncode(pollEvent.pubkey));
      showNotification(NOTIFICATION_MESSAGES.NPUB_COPIED, "success");
    } catch {
      showNotification(NOTIFICATION_MESSAGES.COPY_FAILED, "error");
    }
    setAnchorEl(null);
    setIsDetailsOpen(false);
  };

  const copyRawEvent = async () => {
    try {
      await copyToClipboard(JSON.stringify(pollEvent, null, 2));
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

  if (deleted && !diagnosticOpen) return null;

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
                <Box
                  onClick={() => openProfileTab(nip19.npubEncode(pollEvent.pubkey), navigate)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openProfileTab(nip19.npubEncode(pollEvent.pubkey), navigate);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  sx={{
                    minWidth: 0,
                    cursor: "pointer",
                    "&:hover .profile-name": { textDecoration: "underline" },
                  }}
                >
                  <Typography className="profile-name">
                    {profiles?.get(pollEvent.pubkey)?.name ||
                      profiles?.get(pollEvent.pubkey)?.username ||
                      profiles?.get(pollEvent.pubkey)?.nip05 ||
                      (() => {
                        const npub = nip19.npubEncode(pollEvent.pubkey);
                        return npub.slice(0, 6) + "…" + npub.slice(-4);
                      })()}
                  </Typography>
                  <Nip05Badge
                    nip05={profiles?.get(pollEvent.pubkey)?.nip05}
                    pubkey={pollEvent.pubkey}
                  />
                </Box>
              }
              subheader={calculateTimeAgo(pollEvent.created_at)}
              action={
                <Box sx={{ display: "flex", alignItems: "center" }}>
                  {user && !user.follows?.includes(pollEvent.pubkey) && (
                    <Button size="small" onClick={addToContacts}>Follow</Button>
                  )}
                  <IconButton
                    onClick={(e) => {
                      setIsDetailsOpen(!isDetailsOpen);
                      setAnchorEl(e.currentTarget);
                    }}
                  >
                    <MoreVertIcon />
                  </IconButton>
                </Box>
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
                    sx={broadcastSummary ? { color: broadcastSummary.accepted > 0 ? "success.main" : "error.main" } : {}}
                  />
                )}
                {isBroadcasting
                  ? "Broadcasting…"
                  : broadcastSummary
                  ? `Broadcasted: ${broadcastSummary.accepted} / ${broadcastSummary.total} relays`
                  : "Broadcast"}
              </MenuItem>
              {broadcastSummary && (
                <MenuItem onClick={() => { setDiagnosticOpen(true); setAnchorEl(null); }} sx={{ gap: 1, fontSize: "0.8rem", color: "text.secondary" }}>
                  View relay details
                </MenuItem>
              )}
              {eventRelays.length > 0 && (
                <MenuItem onClick={() => { setRelayModalOpen(true); setIsDetailsOpen(false); setAnchorEl(null); }} sx={{ gap: 1 }}>
                  <CellTowerIcon fontSize="small" />
                  Found on {eventRelays.length} relay{eventRelays.length !== 1 ? 's' : ''}
                </MenuItem>
              )}
              <MenuItem onClick={handleCopyNevent}>Copy Event Id</MenuItem>
              <MenuItem onClick={copyPollUrl}>Copy URL</MenuItem>
              <MenuItem onClick={handleCopyNpub}>Copy Author npub</MenuItem>
              <MenuItem onClick={copyRawEvent}>Copy Raw Event</MenuItem>
              <MenuItem onClick={() => { setVotersFocusOption(null); setVotersModalOpen(true); setIsDetailsOpen(false); setAnchorEl(null); }}>
                See voters
              </MenuItem>
              {user && (
                <MenuItem onClick={handleClearVotes} sx={{ color: "warning.main" }}>
                  Clear my votes
                </MenuItem>
              )}
              {user && user.pubkey === pollEvent.pubkey && (
                <MenuItem onClick={handleDeletePoll} sx={{ color: "error.main" }}>
                  Delete poll
                </MenuItem>
              )}
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
                  disabled={!!(pollExpiration && Number(pollExpiration) * 1000 < now.valueOf())}
                  showResults={showResults}
                  results={results}
                  tags={pollEvent.tags}
                  onVotersClick={(optionId) => { setVotersFocusOption(optionId); setVotersModalOpen(true); }}
                />

                {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

                <ClientChip tags={pollEvent.tags} />

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
                    {userResponse || hasSubmitted ? "Update Vote" : "Submit Response"}
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
        <FeedbackMenu event={pollEvent} rootKind={pollEvent.kind} />
        {diagnosticResult && (
          <PublishDiagnosticModal
            open={diagnosticOpen}
            onClose={() => setDiagnosticOpen(false)}
            title={diagnosticTitle}
            entries={diagnosticResult.relayResults}
            onRetry={retry}
          />
        )}
        <RelaySourceModal
          open={relayModalOpen}
          onClose={() => setRelayModalOpen(false)}
          relays={eventRelays}
        />
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
      <VotersModal
        open={votersModalOpen}
        onClose={() => setVotersModalOpen(false)}
        options={options}
        results={results}
        totalVotes={totalVotes}
        focusOptionId={votersFocusOption}
      />
    </div>
  );
};

export default PollResponseForm;
