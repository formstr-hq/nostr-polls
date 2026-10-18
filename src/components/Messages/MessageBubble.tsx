import React, { useRef, useState } from "react";
import { Box, Typography, Paper, Chip, CircularProgress, Tooltip } from "@mui/material";
import ReplyIcon from "@mui/icons-material/Reply";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import TimerOffIcon from "@mui/icons-material/TimerOff";
import { useTheme } from "@mui/material/styles";
import { MsgSendStatus, RelayStatus } from "./ChatView";
import dayjs from "dayjs";
import { DMMessage } from "../../contexts/dm-context";
import { TextWithImages } from "../Common/Parsers/TextWithImages";
import { PublishDiagnosticModal } from "../Common/PublishDiagnosticModal";

const SWIPE_THRESHOLD = 64;

interface GroupedReaction {
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
  onRetry?: (relay?: string) => void;
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
  const [diagOpen, setDiagOpen] = useState(false);

  // Sent bubbles are the block color (Color Block); text flips for contrast.
  const cb = theme.palette.cb;
  const onBlockIsDark = cb.onBlock !== "#ffffff";
  const sent = {
    bg:          cb.block,
    text:        cb.onBlock,
    link:        cb.onBlock,
    subtext:     onBlockIsDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.7)",
    quoteBorder: onBlockIsDark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.55)",
    quoteBg:     onBlockIsDark ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.14)",
    quoteName:   cb.onBlock,
    quoteText:   onBlockIsDark ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.8)",
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
            py: 1.1,
            borderRadius: "22px",
            [isMine ? "borderBottomRightRadius" : "borderBottomLeftRadius"]: "6px",
            overflow: "hidden",
            backgroundColor: isMine ? sent.bg : "cb.slab",
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
                    onClick={() => onRetry()}
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
            onRetry(relay);
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

export default MessageBubble;
