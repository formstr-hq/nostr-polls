import React, { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Typography,
  Collapse,
  Box,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CellTowerIcon from "@mui/icons-material/CellTower";
import FlagIcon from "@mui/icons-material/Flag";
import { useAppContext } from "../../../hooks/useAppContext";
import { signEvent } from "../../../nostr";
import { useRelays } from "../../../hooks/useRelays";
import { Event, nip19 } from "nostr-tools";
import { DEFAULT_IMAGE_URL } from "../../../utils/constants";
import { useUserContext } from "../../../hooks/useUserContext";
import { TextWithImages } from "../Parsers/TextWithImages";
import { copyToClipboard, calculateTimeAgo } from "../../../utils/common";
import CommentInput from "./CommentInput";
import { extractMentionTags } from '../../EventCreator/MentionTextArea';
import { getColorsWithTheme } from "../../../styles/theme";
import { useNotification } from "../../../contexts/notification-context";
import { nostrRuntime } from "../../../singletons";
import { SubscriptionHandle } from "../../../nostrRuntime/types";
import { publishWithGossip } from "../../../utils/publish";
import { usePublishDiagnostic } from "../../../hooks/usePublishDiagnostic";
import { PublishDiagnosticModal } from "../PublishDiagnosticModal";
import { FeedbackMenu } from "../../FeedbackMenu";
import { RelaySourceModal } from "../RelaySourceModal";
import { useEventRelays } from "../../../hooks/useEventRelays";
import { useReports } from "../../../hooks/useReports";
import { ReportDialog } from "../../Report/ReportDialog";
import { ReportReason } from "../../../contexts/reports-context";
import { getAppBaseUrl } from "../../../utils/platform";
import { Profile } from "../../../nostr/types";
import { useNavigate } from "react-router-dom";
import { openProfileTab } from "../../../nostr";

function dedup(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
}

// ── Removable "Notifying" chips shown beneath a comment input ────────────────
const NotifyHint: React.FC<{
  pubkeys: string[];
  profiles: Map<string, Profile> | undefined;
  onRemove: (pk: string) => void;
}> = ({ pubkeys, profiles, onRemove }) => {
  if (pubkeys.length === 0) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
      <Typography variant="caption" color="text.secondary">
        Notifying:
      </Typography>
      {pubkeys.map((pk) => {
        const profile = profiles?.get(pk);
        const name = profile?.name || nip19.npubEncode(pk).slice(0, 10) + "…";
        return (
          <Chip
            key={pk}
            size="small"
            avatar={<Avatar src={profile?.picture || DEFAULT_IMAGE_URL} />}
            label={name}
            onDelete={() => onRemove(pk)}
            sx={{ fontSize: "0.7rem", height: 22 }}
          />
        );
      })}
    </Box>
  );
};

// ── Per-comment card with context menu ──────────────────────────────────────
interface CommentCardProps {
  comment: Event;
  depth: number;
  commentAncestors: string[];
  children?: React.ReactNode;
}

const CommentCard: React.FC<CommentCardProps> = ({ comment, depth, commentAncestors, children }) => {
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { user } = useUserContext();
  const eventRelays = useEventRelays(comment.id);
  const { reportEvent, reportUser } = useReports();
  const navigate = useNavigate();

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [relayModalOpen, setRelayModalOpen] = useState(false);
  const [reportPostOpen, setReportPostOpen] = useState(false);
  const [reportUserOpen, setReportUserOpen] = useState(false);

  const commentUser = profiles?.get(comment.pubkey);
  if (!commentUser) fetchUserProfileThrottled(comment.pubkey);

  const handleCopyNevent = () => {
    copyToClipboard(nip19.neventEncode({ id: comment.id }));
    setMenuAnchor(null);
  };
  const handleCopyLink = () => {
    copyToClipboard(`${getAppBaseUrl()}/note/${nip19.neventEncode({ id: comment.id })}`);
    setMenuAnchor(null);
  };
  const handleCopyNpub = () => {
    copyToClipboard(nip19.npubEncode(comment.pubkey));
    setMenuAnchor(null);
  };

  const authorName =
    commentUser?.name ||
    (() => { const n = nip19.npubEncode(comment.pubkey); return n.slice(0, 10) + "..."; })();
  const authorNpub = nip19.npubEncode(comment.pubkey);

  return (
    <>
      <Card variant="outlined" style={{ marginTop: "8px" }}>
        <CardHeader
          avatar={
            <Avatar
              src={commentUser?.picture || DEFAULT_IMAGE_URL}
              onClick={() => openProfileTab(authorNpub, navigate)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openProfileTab(authorNpub, navigate);
                }
              }}
              role="button"
              tabIndex={0}
              sx={{ cursor: "pointer" }}
            />
          }
          title={
            <Box
              onClick={() => openProfileTab(authorNpub, navigate)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openProfileTab(authorNpub, navigate);
                }
              }}
              role="button"
              tabIndex={0}
              sx={{
                display: "inline-flex",
                maxWidth: "100%",
                cursor: "pointer",
                "&:hover .profile-name, &:focus-visible .profile-name": {
                  textDecoration: "underline",
                },
              }}
            >
              <Typography className="profile-name" noWrap>
                {authorName}
              </Typography>
            </Box>
          }
          subheader={calculateTimeAgo(comment.created_at)}
          action={
            <IconButton size="small" onClick={(e) => setMenuAnchor(e.currentTarget)}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
          }
        />
        <CardContent style={{ marginLeft: "8px", padding: "8px" }}>
          <Typography>
            <TextWithImages content={comment.content} tags={comment.tags} />
          </Typography>
        </CardContent>

        <Box sx={{ px: 1, pb: 1 }}>
          <FeedbackMenu event={comment} depth={depth + 1} ancestorPubkeys={commentAncestors} />
        </Box>

        {children}
      </Card>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        {eventRelays.length > 0 && (
          <MenuItem onClick={() => { setRelayModalOpen(true); setMenuAnchor(null); }} sx={{ gap: 1 }}>
            <CellTowerIcon fontSize="small" />
            Found on {eventRelays.length} relay{eventRelays.length !== 1 ? "s" : ""}
          </MenuItem>
        )}
        <MenuItem onClick={handleCopyNevent}>Copy Event Id</MenuItem>
        <MenuItem onClick={handleCopyLink}>Copy Link</MenuItem>
        <MenuItem onClick={handleCopyNpub}>Copy Author npub</MenuItem>
        {user && (
          <MenuItem onClick={() => { setMenuAnchor(null); setReportPostOpen(true); }} sx={{ color: "error.main" }}>
            <FlagIcon fontSize="small" sx={{ mr: 1 }} />
            Report post
          </MenuItem>
        )}
        {user && (
          <MenuItem onClick={() => { setMenuAnchor(null); setReportUserOpen(true); }} sx={{ color: "error.main" }}>
            <FlagIcon fontSize="small" sx={{ mr: 1 }} />
            Report user
          </MenuItem>
        )}
      </Menu>

      <RelaySourceModal open={relayModalOpen} onClose={() => setRelayModalOpen(false)} relays={eventRelays} />
      <ReportDialog
        open={reportPostOpen}
        onClose={() => setReportPostOpen(false)}
        onSubmit={(reason: ReportReason, content: string) => { reportEvent(comment.id, comment.pubkey, reason, content); setReportPostOpen(false); }}
        title="Report post"
      />
      <ReportDialog
        open={reportUserOpen}
        onClose={() => setReportUserOpen(false)}
        onSubmit={(reason: ReportReason, content: string) => { reportUser(comment.pubkey, reason, content); setReportUserOpen(false); }}
        title="Report user"
      />
    </>
  );
};

interface CommentSectionProps {
  eventId: string;
  rootPubkey?: string;
  ancestorPubkeys?: string[];
  showComments: boolean;
  depth?: number;
  /** NIP-22: pass "30023:pubkey:identifier" to use kind 1111 + #a filter */
  addressableRef?: string;
  /** NIP-22: root event kind, e.g. 30023 for articles */
  rootKind?: number;
}

const CommentSection: React.FC<CommentSectionProps> = ({
  eventId,
  rootPubkey,
  ancestorPubkeys = [],
  showComments,
  depth = 0,
  addressableRef,
  rootKind,
}) => {
  const { showNotification } = useNotification();
  const {
    fetchCommentsThrottled,
    commentsMap,
    addEventToMap,
    profiles,
  } = useAppContext();

  const isNip22 = !!addressableRef || rootKind != null;

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [showReplies, setShowReplies] = useState<Map<string, boolean>>(new Map());
  const [topLevelNotify, setTopLevelNotify] = useState<string[]>(
    dedup([...ancestorPubkeys, ...(rootPubkey ? [rootPubkey] : [])])
  );
  const { result: publishResult, open: diagnosticOpen, setOpen: setDiagnosticOpen, title: diagnosticTitle, openModal, retry } = usePublishDiagnostic();

  const { user, requestLogin } = useUserContext();
  const { relays, writeRelays } = useRelays();

  const fetchComments = () => {
    const filters: object[] = [{ kinds: [1], "#e": [eventId] }];
    if (addressableRef) {
      filters.push({ kinds: [1111], "#a": [addressableRef] });
    } else if (rootKind != null) {
      filters.push({ kinds: [1111], "#E": [eventId] });
      filters.push({ kinds: [1111], "#e": [eventId] });
    }
    const handle = nostrRuntime.subscribe(relays, filters as any, {
      onEvent: addEventToMap,
    });
    return handle;
  };

  useEffect(() => {
    let handle: SubscriptionHandle | undefined;
    if (!handle && showComments) {
      handle = fetchComments();
      return () => {
        if (handle) handle.unsubscribe();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showComments]);

  useEffect(() => {
    // Warm the cache for both the event id and the addressable ref
    if (!commentsMap?.get(eventId)) fetchCommentsThrottled(eventId);
    if (addressableRef && !commentsMap?.get(addressableRef)) fetchCommentsThrottled(addressableRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmitComment = async (content: string, parentId?: string, notifyPubkeys: string[] = []) => {
    if (!user) {
      requestLogin();
      return;
    }

    const mentionTags = extractMentionTags(content);
    const mentionedPubkeys = new Set(mentionTags.map((t) => t[1]));
    const pTags = notifyPubkeys
      .filter((pk) => !mentionedPubkeys.has(pk))
      .map((pk) => ["p", pk]);

    // When replying to a specific comment, match its kind.
    // Top-level comments follow the root mode (isNip22).
    const parentEvent = parentId ? comments.find((c) => c.id === parentId) : null;
    const useNip22 = parentEvent ? parentEvent.kind === 1111 : isNip22;

    const tags = useNip22
      ? [
          ...mentionTags,
          ...pTags,
          ...(addressableRef
            ? [["A", addressableRef, "", "root"]]
            : [["E", eventId, "", "root"]]),
          ...(rootKind != null ? [["K", String(rootKind)]] : []),
          ...(parentId ? [["e", parentId, "", "reply"], ["k", "1111"]] : []),
        ]
      : [
          ...mentionTags,
          ...pTags,
          ["e", eventId, "", "root"],
          ...(parentId ? [["e", parentId, "", "reply"]] : []),
        ];

    const commentEvent = {
      kind: useNip22 ? 1111 : 1,
      content,
      tags,
      created_at: Math.floor(Date.now() / 1000),
    };

    const signedComment = await signEvent(commentEvent, user.privateKey);
    if (!signedComment) return;

    const result = await publishWithGossip(writeRelays, signedComment);
    openModal(signedComment, result, "Comment publish results");

    if (result.ok) {
      showNotification("Comment published!", "success");
      addEventToMap(signedComment);
    } else {
      showNotification("Comment failed to publish to any relay", "error");
    }
    setReplyTo(null);
  };

  const renderComments = (comments: Event[], parentId: string | null, accumulatedAncestors: string[]) => {
    return comments
      .filter((comment) => {
        const isReplyTo = comment.tags.filter(
          (tag) => tag[3] === "reply"
        )?.[0]?.[1];

        if (parentId === null) {
          return !isReplyTo || replyTo === eventId;
        }

        return comment.tags.some(
          (tag) => tag[1] === parentId && tag[3] === "reply"
        );
      })
      .map((comment) => {
        const hasReplies = comments.some((c) =>
          c.tags.some((tag) => tag[3] === "reply" && tag[1] === comment.id)
        );
        // Ancestors for comments nested under this one = current ancestors + this comment's pubkey
        const childAncestors = dedup([...accumulatedAncestors, comment.pubkey]);

        return (
          <div key={comment.id} style={{ marginLeft: "8px" }}>
            <CommentCard comment={comment} depth={depth} commentAncestors={accumulatedAncestors}>
              {/* Show/Hide Replies Button */}
              {hasReplies && (
                <Box sx={{ px: 2, pb: 1 }}>
                  <Button
                    onClick={() =>
                      setShowReplies((prev) => {
                        const updated = new Map(prev);
                        updated.set(comment.id, !prev.get(comment.id));
                        return updated;
                      })
                    }
                    size="small"
                    sx={(theme) => ({
                      ...getColorsWithTheme(theme, { color: "#000000" }),
                      p: 0,
                      fontSize: "0.75rem",
                    })}
                  >
                    {showReplies.get(comment.id) ? "Hide Replies" : "Show Replies"}
                  </Button>
                </Box>
              )}
            </CommentCard>

            {/* Render child comments if visible */}
            <Collapse
              in={!!showReplies.get(comment.id)}
              timeout={200}
              unmountOnExit
            >
              {renderComments(comments, comment.id, childAncestors)}
            </Collapse>
          </div>
        );
      });
  };

  // Merge comments from both the event id key and the addressable ref key (deduped by id)
  const comments = useMemo(() => {
    const byEvent = commentsMap?.get(eventId) || [];
    const byAddr = addressableRef ? (commentsMap?.get(addressableRef) || []) : [];
    const seen = new Set<string>();
    return [...byEvent, ...byAddr].filter((e) => seen.has(e.id) ? false : (seen.add(e.id), true));
  }, [commentsMap, eventId, addressableRef]);
  const localCommentsMap = new Map((comments || []).map((c) => [c.id, c]));

  if (!showComments) {
    return null;
  }

  return (
    <div style={{ width: "100%" }}>
      <CommentInput onSubmit={(content) => handleSubmitComment(content, undefined, topLevelNotify)} />
      <NotifyHint
        pubkeys={topLevelNotify}
        profiles={profiles}
        onRemove={(pk) => setTopLevelNotify((prev) => prev.filter((p) => p !== pk))}
      />
      <div style={{ marginTop: "16px" }}>
        {comments.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No comments yet
          </Typography>
        ) : (
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Comments
          </Typography>
        )}
        {renderComments(Array.from(localCommentsMap.values()), null, topLevelNotify)}
      </div>

      {publishResult && (
        <PublishDiagnosticModal
          open={diagnosticOpen}
          onClose={() => setDiagnosticOpen(false)}
          title={diagnosticTitle}
          entries={publishResult.relayResults}
          onRetry={retry}
        />
      )}
    </div>
  );
};

export default CommentSection;
