import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Typography,
  Paper,
  Chip,
  CircularProgress,
  Tooltip,
  IconButton,
} from "@mui/material";
import ReplyIcon from "@mui/icons-material/Reply";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import TimerOffIcon from "@mui/icons-material/TimerOff";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { useTheme } from "@mui/material/styles";
import { MsgSendStatus, RelayStatus } from "./ChatView";
import dayjs from "dayjs";
import { DMMessage } from "../../contexts/dm-context";
import { TextWithImages } from "../Common/Parsers/TextWithImages";
import { PublishDiagnosticModal } from "../Common/PublishDiagnosticModal";
import { decryptBlob, FileMeta } from "../../nostr/fileMessage";

const SWIPE_THRESHOLD = 64;

export interface GroupedReaction {
  emoji: string;
  count: number;
  pubkeys: string[];
  tags?: string[][];
}

// Small dot showing a single relay's publish status
const RelayDot: React.FC<{ relay: string; status: RelayStatus; reason?: string }> = ({
  relay,
  status,
  reason,
}) => {
  const hostname = (() => { try { return new URL(relay).hostname; } catch { return relay; } })();
  const label = reason ? `${hostname}: ${reason}` : `${hostname} · ${status}`;

  let indicator: React.ReactElement;
  if (status === "pending") {
    indicator = <CircularProgress size={7} thickness={5} sx={{ color: "text.disabled" }} />;
  } else if (status === "sent") {
    indicator = <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "success.main" }} />;
  } else if (status === "timeout") {
    indicator = <TimerOffIcon sx={{ fontSize: 11, color: "text.disabled" }} />;
  } else {
    indicator = <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "error.main" }} />;
  }

  return <Tooltip title={label} placement="top">{indicator}</Tooltip>;
};

/** Session-memory object URLs for decrypted attachments. Nothing at rest —
 *  the cache (and the blobs behind it) dies with the page. */
const mediaUrlCache = new Map<string, string>();
function cachedMediaUrl(
  cacheKey: string,
  produce: () => Promise<Blob>
): Promise<string> {
  const hit = mediaUrlCache.get(cacheKey);
  if (hit) return Promise.resolve(hit);
  return produce().then((blob) => {
    const url = URL.createObjectURL(blob);
    mediaUrlCache.set(cacheKey, url);
    return url;
  });
}

/** Hook: decrypt-on-demand -> objectURL with a loading/error state. */
function useDecryptedMedia(meta: FileMeta): [string | null, "loading" | "ready" | "error"] {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let alive = true;
    setState("loading");
    cachedMediaUrl(meta.url + (meta.key ?? ""), () => decryptBlob(meta))
      .then((u) => {
        if (!alive) return;
        setUrl(u);
        setState("ready");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
    // Keyed by the message's url+key — stable for the message's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.url, meta.key]);
  return [url, state];
}

/** Encrypted image attachment: decrypt -> render inline, tap = full view. */
const ImageAttachment: React.FC<{ meta: FileMeta }> = ({ meta }) => {
  const [url, state] = useDecryptedMedia(meta);
  const [w, h] = (meta.dim ?? "").split(" ").map((v) => parseInt(v, 10) || 0);
  const boxW = Math.min(260, 260);
  const boxH = w > 0 ? Math.round((h / w) * boxW) : 180;
  if (state === "error") {
    return (
      <Box display="flex" alignItems="center" gap={0.5}>
        <ErrorOutlineIcon sx={{ fontSize: 16, color: "error.main" }} />
        <Typography variant="caption" color="error.main">
          Couldn't decrypt image
        </Typography>
      </Box>
    );
  }
  if (!url) {
    return (
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        sx={{
          width: boxW,
          height: state === "loading" ? Math.min(boxH, 180) : undefined,
          minWidth: 120,
          minHeight: 60,
          borderRadius: 1.5,
          bgcolor: "rgba(128,128,128,0.15)",
        }}
      >
        <CircularProgress size={18} color="inherit" />
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={url}
      alt={meta.fileName || "attachment"}
      loading="lazy"
      onClick={(e) => {
        e.stopPropagation();
        window.open(url, "_blank");
      }}
      sx={{
        maxWidth: 260,
        maxHeight: 320,
        borderRadius: 1.5,
        display: "block",
        cursor: "zoom-in",
        objectFit: "contain",
      }}
    />
  );
};

/** Encrypted audio (voice note): play/pause + waveform + duration. */
const VoiceBubble: React.FC<{ meta: FileMeta }> = ({ meta }) => {
  const [url, state] = useDecryptedMedia(meta);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const bars = meta.waveform && meta.waveform.length > 0
    ? meta.waveform
    : new Array(32).fill(0).map((_, i) => 30 + Math.round(40 * Math.abs(Math.sin(i * 1.7))));
  const durationLabel = meta.duration
    ? `${Math.min(60, Math.round(meta.duration))}s`
    : "";

  useEffect(
    () => () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    },
    []
  );

  const toggle = () => {
    if (!url) return;
    let a = audioRef.current;
    if (!a || a.src !== url) {
      if (a) a.pause();
      a = new Audio(url);
      audioRef.current = a;
      a.onended = () => {
        setPlaying(false);
        setProgress(1);
        if (tickRef.current) clearInterval(tickRef.current);
        tickRef.current = null;
      };
    }
    if (playing) {
      a.pause();
      setPlaying(false);
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    } else {
      void a.play().catch(() => undefined);
      setPlaying(true);
      tickRef.current = setInterval(() => {
        const el = audioRef.current;
        if (el && el.duration > 0) {
          setProgress(Math.min(1, el.currentTime / el.duration));
        }
      }, 150);
    }
  };

  if (state === "error") {
    return (
      <Box display="flex" alignItems="center" gap={0.5}>
        <ErrorOutlineIcon sx={{ fontSize: 16, color: "error.main" }} />
        <Typography variant="caption" color="error.main">
          Couldn't decrypt voice note
        </Typography>
      </Box>
    );
  }

  return (
    <Box display="flex" alignItems="center" gap={0.75} minWidth={180}>
      <IconButton
        size="small"
        onClick={toggle}
        disabled={state === "loading"}
        sx={{
          bgcolor: "rgba(128,128,128,0.18)",
          "&:hover": { bgcolor: "rgba(128,128,128,0.28)" },
        }}
      >
        {state === "loading" ? (
          <CircularProgress size={14} color="inherit" />
        ) : playing ? (
          <PauseIcon sx={{ fontSize: 18 }} />
        ) : (
          <PlayArrowIcon sx={{ fontSize: 18 }} />
        )}
      </IconButton>
      {/* Waveform: filled through the playhead */}
      <Box display="flex" alignItems="center" gap="2px" flex={1} height={28}>
        {bars.slice(0, 60).map((v, i) => {
          const passed = i / bars.length <= progress - 0.0001;
          return (
            <Box
              key={i}
              sx={{
                width: 3,
                borderRadius: 1.5,
                height: 4 + Math.round((v / 100) * 20),
                bgcolor: passed ? "primary.main" : "rgba(128,128,128,0.4)",
              }}
            />
          );
        })}
      </Box>
      {durationLabel && (
        <Typography variant="caption" color="text.secondary">
          {durationLabel}
        </Typography>
      )}
    </Box>
  );
};

/** Generic encrypted file: decrypt-on-tap, then hand the plaintext to the browser. */
const FileCard: React.FC<{ meta: FileMeta }> = ({ meta }) => {
  const [phase, setPhase] = useState<"idle" | "busy" | "error">("idle");
  const name =
    meta.fileName ||
    (meta.url ? decodeURIComponent(meta.url.split("/").pop() || "") : "") ||
    "file";

  const download = async () => {
    if (phase !== "idle") return;
    setPhase("busy");
    try {
      const blob = await decryptBlob(meta);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setPhase("idle");
    } catch {
      setPhase("error");
    }
  };

  return (
    <Box
      display="flex"
      alignItems="center"
      gap={1}
      onClick={(e) => {
        e.stopPropagation();
        void download();
      }}
      sx={{ cursor: phase === "idle" ? "pointer" : "default", minWidth: 180 }}
    >
      <InsertDriveFileOutlinedIcon sx={{ fontSize: 26, color: "text.secondary" }} />
      <Box flex={1} minWidth={0}>
        <Typography
          variant="body2"
          sx={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 180,
          }}
        >
          {name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {phase === "busy"
            ? "Decrypting…"
            : phase === "error"
            ? "Couldn't decrypt — tap to retry"
            : typeof meta.size === "number" && meta.size > 0
            ? `${Math.max(1, Math.round(meta.size / 1024))} KB · tap to download`
            : "tap to download"}
        </Typography>
      </Box>
      {phase === "busy" ? (
        <CircularProgress size={16} color="inherit" />
      ) : (
        <DownloadIcon sx={{ fontSize: 18, color: "text.secondary" }} />
      )}
    </Box>
  );
};

const Attachment: React.FC<{ msg: DMMessage }> = ({ msg }) => {
  const meta = msg.file as FileMeta;
  if (meta.mimeType.startsWith("image/")) return <ImageAttachment meta={meta} />;
  if (meta.mimeType.startsWith("audio/")) return <VoiceBubble meta={meta} />;
  return <FileCard meta={meta} />;
};

interface MessageBubbleProps {
  msg: DMMessage;
  isMine: boolean;
  reactions: Record<string, GroupedReaction>;
  referencedMsg?: DMMessage;
  referencedMsgSenderName?: string;
  sendStatus?: MsgSendStatus;
  onLongPress: (msg: DMMessage) => void;
  onReact: (emoji: string, msgId: string) => void;
  onSwipeReply: (msg: DMMessage) => void;
  onRetry?: (rumorId: string, relay?: string) => void;
}

// Renders an emoji or a custom emoji shortcode like :name:
const RenderEmoji: React.FC<{ content: string; tags?: string[][] }> = ({
  content,
  tags,
}) => {
  const match = content.match(/^:([a-zA-Z0-9_]+):$/);
  if (match && tags) {
    const shortcode = match[1];
    const emojiTag = tags.find((t) => t[0] === "emoji" && t[1] === shortcode);
    if (emojiTag && emojiTag[2]) {
      return (
        <img
          src={emojiTag[2]}
          alt={`:${shortcode}:`}
          title={`:${shortcode}:`}
          style={{ height: "1em", width: "auto", verticalAlign: "middle" }}
        />
      );
    }
  }
  return <>{content}</>;
};

const MessageBubble: React.FC<MessageBubbleProps> = ({
  msg,
  isMine,
  reactions,
  referencedMsg,
  referencedMsgSenderName,
  sendStatus,
  onLongPress,
  onReact,
  onSwipeReply,
  onRetry,
}) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const [diagOpen, setDiagOpen] = useState(false);

  // Sent-bubble colour tokens — warm amber palette, mode-aware.
  // Dark: deep amber bg so it doesn't sear against the #4d4d4d page background.
  // Light: pale gold bg, stays consistent with the goldenrod theme.
  const sent = {
    bg:          isDark ? "#5C4A00"               : "#FEF3C7",
    text:        isDark ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.87)",
    link:        theme.palette.primary.main,
    subtext:     isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)",
    quoteBorder: isDark ? "rgba(250,209,63,0.5)"  : "rgba(218,165,32,0.6)",
    quoteBg:     isDark ? "rgba(0,0,0,0.25)"      : "rgba(0,0,0,0.05)",
    quoteName:   theme.palette.primary.main,
    quoteText:   isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.6)",
  };

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  // Swipe-to-reply — use refs + direct DOM mutation to avoid re-renders on every touchmove
  const paperRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isHorizontalSwipe = useRef(false);
  const swipeTriggered = useRef(false);

  const applySwipe = (x: number, animate: boolean) => {
    if (paperRef.current) {
      paperRef.current.style.transition = animate
        ? "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)"
        : "none";
      paperRef.current.style.transform = `translateX(${x}px)`;
    }
    if (indicatorRef.current) {
      const progress = Math.min(x / SWIPE_THRESHOLD, 1);
      indicatorRef.current.style.transition = animate
        ? "opacity 0.25s, transform 0.25s"
        : "none";
      indicatorRef.current.style.opacity = String(progress);
      indicatorRef.current.style.transform = `translateY(-50%) scale(${progress})`;
    }
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems={isMine ? "flex-end" : "flex-start"}
    >
      <Box sx={{ position: "relative", maxWidth: "85%" }}>
        {/* Swipe-to-reply indicator — revealed as the bubble slides right */}
        <div
          ref={indicatorRef}
          style={{
            position: "absolute",
            left: -36,
            top: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: "50%",
            backgroundColor: "rgba(128,128,128,0.2)",
            transform: "translateY(-50%) scale(0)",
            opacity: 0,
            pointerEvents: "none",
          }}
        >
          <ReplyIcon style={{ fontSize: 16 }} />
        </div>

        <Paper
          ref={paperRef}
          elevation={1}
          onTouchStart={(e) => {
            longPressTriggered.current = false;
            swipeTriggered.current = false;
            isHorizontalSwipe.current = false;
            touchStartX.current = e.touches[0].clientX;
            touchStartY.current = e.touches[0].clientY;
            longPressTimer.current = setTimeout(() => {
              longPressTriggered.current = true;
              if (navigator.vibrate) navigator.vibrate(30);
              onLongPress(msg);
            }, 500);
          }}
          onTouchMove={(e) => {
            const dx = e.touches[0].clientX - touchStartX.current;
            const dy = e.touches[0].clientY - touchStartY.current;

            // On the first significant movement, lock gesture direction
            if (
              !isHorizontalSwipe.current &&
              (Math.abs(dx) > 8 || Math.abs(dy) > 8)
            ) {
              if (Math.abs(dy) > Math.abs(dx)) return; // vertical scroll wins, ignore
              isHorizontalSwipe.current = true;
            }

            if (!isHorizontalSwipe.current) return;

            // Cancel long-press once we know it's a swipe
            if (longPressTimer.current) {
              clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }

            if (dx <= 0) return; // right-swipe only

            // Apply resistance past the threshold so it feels springy
            const x =
              dx < SWIPE_THRESHOLD
                ? dx
                : SWIPE_THRESHOLD + (dx - SWIPE_THRESHOLD) * 0.2;
            applySwipe(x, false);

            if (dx >= SWIPE_THRESHOLD && !swipeTriggered.current) {
              swipeTriggered.current = true;
              if (navigator.vibrate) navigator.vibrate(30);
              onSwipeReply(msg);
            }
          }}
          onTouchEnd={() => {
            if (longPressTimer.current) {
              clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
            applySwipe(0, true); // snap back
            isHorizontalSwipe.current = false;
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            onLongPress(msg);
          }}
          sx={{
            px: 2,
            py: 1,
            borderRadius: 2,
            overflow: "hidden",
            backgroundColor: isMine ? sent.bg : "action.hover",
            cursor: "default",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          {/* Quoted message preview */}
          {referencedMsg && (
            <Box
              sx={{
                borderLeft: "3px solid",
                borderColor: isMine ? sent.quoteBorder : "primary.main",
                pl: 1,
                mb: 0.75,
                borderRadius: "0 4px 4px 0",
                bgcolor: isMine ? sent.quoteBg : "rgba(0,0,0,0.06)",
                py: 0.25,
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: isMine ? sent.quoteName : "primary.main",
                  fontWeight: 600,
                  display: "block",
                  lineHeight: 1.4,
                }}
              >
                {referencedMsgSenderName}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: isMine ? sent.quoteText : "text.secondary",
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  lineHeight: 1.4,
                }}
              >
                {referencedMsg.content}
              </Typography>
            </Box>
          )}

          {msg.file && msg.file.url ? (
            <Attachment msg={msg} />
          ) : (
            <Box
              sx={{
                color: isMine ? sent.text : "text.primary",
                wordBreak: "break-word",
                fontSize: "0.875rem",
                "& a": {
                  color: isMine ? sent.link : theme.palette.primary.main,
                },
              }}
            >
              <TextWithImages content={msg.content} tags={msg.tags} />
            </Box>
          )}
          <Typography
            variant="caption"
            sx={{
              color: isMine ? sent.subtext : "text.secondary",
              display: "block",
              textAlign: "right",
              mt: 0.5,
            }}
          >
            {dayjs.unix(msg.created_at).format("HH:mm")}
          </Typography>
        </Paper>
      </Box>

      {/* Reaction badges */}
      {Object.keys(reactions).length > 0 && (
        <Box display="flex" gap={0.5} mt={0.5} flexWrap="wrap">
          {Object.values(reactions).map((r) => (
            <Chip
              key={r.emoji}
              label={
                <Box display="flex" alignItems="center" gap={0.5}>
                  <RenderEmoji content={r.emoji} tags={r.tags} />
                  {r.count > 1 && <span>{r.count}</span>}
                </Box>
              }
              size="small"
              variant="outlined"
              onClick={() => onReact(r.emoji, msg.id)}
              sx={{ height: 24, fontSize: "0.75rem", cursor: "pointer" }}
            />
          ))}
        </Box>
      )}

      {/* Relay send status */}
      {sendStatus && (() => {
        const entries = Object.entries(sendStatus.relays);
        const allSent = entries.every(([, s]) => s === "sent");
        const anyProblem = entries.some(([, s]) => s === "failed" || s === "timeout");
        const allFailed = entries.length > 0 && entries.every(([, s]) => s === "failed" || s === "timeout");
        if (allSent) return null;
        return (
          <Box
            display="flex"
            alignItems="center"
            gap={0.5}
            mt={0.5}
            sx={{ alignSelf: isMine ? "flex-end" : "flex-start" }}
          >
            {!allFailed && entries.map(([relay, status]) => (
              <RelayDot key={relay} relay={relay} status={status} reason={sendStatus.reasons[relay]} />
            ))}
            {allFailed && (
              <>
                <WarningAmberIcon sx={{ fontSize: 13, color: "error.main" }} />
                <Typography variant="caption" color="error.main" sx={{ fontSize: "0.7rem" }}>
                  Not delivered
                </Typography>
                {onRetry && (
                  <Typography
                    variant="caption"
                    color="primary"
                    onClick={() => onRetry(msg.id)}
                    sx={{ fontSize: "0.7rem", cursor: "pointer", textDecoration: "underline" }}
                  >
                    Retry
                  </Typography>
                )}
              </>
            )}
            {anyProblem && (
              <Typography
                variant="caption"
                color="text.secondary"
                onClick={() => setDiagOpen(true)}
                sx={{ fontSize: "0.7rem", cursor: "pointer", textDecoration: "underline", ml: 0.5 }}
              >
                Details
              </Typography>
            )}
          </Box>
        );
      })()}
      {sendStatus && diagOpen && (
        <PublishDiagnosticModal
          open={diagOpen}
          onClose={() => setDiagOpen(false)}
          title="DM delivery results"
          entries={Object.entries(sendStatus.relays).map(([relay, status]) => ({
            relay,
            status,
            message: sendStatus.reasons[relay],
            latencyMs: sendStatus.latencies[relay],
          }))}
          onRetry={onRetry ? async (relay?: string) => {
            onRetry(msg.id, relay);
            return Object.entries(sendStatus.relays).map(([relay, status]) => ({
              relay,
              status,
              message: sendStatus.reasons[relay],
              latencyMs: sendStatus.latencies[relay],
            }));
          } : undefined}
        />
      )}
    </Box>
  );
};

export default React.memo(MessageBubble);
