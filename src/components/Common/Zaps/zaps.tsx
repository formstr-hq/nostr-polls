import React, { useEffect, useRef, useState } from "react";
import { Tooltip, Typography } from "@mui/material";
import { useAppContext } from "../../../hooks/useAppContext";
import { Event } from "nostr-tools/lib/types/core";
import { defaultRelays, signEvent } from "../../../nostr";
import { useRelays } from "../../../hooks/useRelays";
import { FlashOn } from "@mui/icons-material";
import { nip57 } from "nostr-tools";
import { useUserContext } from "../../../hooks/useUserContext";
import { styled } from "@mui/system";
import { getColorsWithTheme } from "../../../styles/theme";
import { useNotification } from "../../../contexts/notification-context";
import { NOTIFICATION_MESSAGES } from "../../../constants/notifications";
import { nostrRuntime } from "../../../singletons";
import ZapModal from "./ZapModal";
import ZapDetailsModal from "./ZapDetailsModal";
import { useZaps } from "../../../contexts/ZapProvider";

interface ZapProps {
  pollEvent: Event;
}

const Wrapper = styled("div")(({ theme }) => ({
  ...getColorsWithTheme(theme, {
    color: "#000000",
  }),
}));

const LONG_PRESS_MS = 500;

const Zap: React.FC<ZapProps> = ({ pollEvent }) => {
  const { profiles, addEventToMap } = useAppContext();
  const { registerEventId, getZapInfos, getTotalSats, addZapEvent } = useZaps();
  const { user, requestLogin } = useUserContext();
  const [zapModalOpen, setZapModalOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [zapConfirmed, setZapConfirmed] = useState(false);
  const zapSubRef = useRef<{ unsubscribe: () => void } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const { showNotification } = useNotification();
  const { relays } = useRelays();

  const recipient = profiles?.get(pollEvent.pubkey);
  const zapInfos = getZapInfos(pollEvent.id);
  const totalSats = getTotalSats(pollEvent.id);
  const hasZapped = zapInfos.some((z) => z.senderPubkey === user?.pubkey);

  useEffect(() => {
    registerEventId(pollEvent.id);
  }, [pollEvent.id, registerEventId]);

  // ── Long press handlers ───────────────────────────────────────────────────

  const startLongPress = () => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setDetailsOpen(true);
    }, LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleClick = () => {
    if (didLongPress.current) return; // long press already handled
    if (!user) {
      requestLogin();
      return;
    }
    if (!recipient) {
      showNotification(NOTIFICATION_MESSAGES.RECIPIENT_PROFILE_ERROR, "error");
      return;
    }
    setZapModalOpen(true);
  };

  // ── Zap payment flow ─────────────────────────────────────────────────────

  const handleZap = async (amount: number): Promise<string | null> => {
    if (!recipient) {
      showNotification(NOTIFICATION_MESSAGES.RECIPIENT_PROFILE_ERROR, "error");
      return null;
    }

    try {
      const zapRequestEvent = nip57.makeZapRequest({
        event: pollEvent,
        amount: amount * 1000,
        comment: "",
        relays,
      });
      const signedZapRequest = await signEvent(zapRequestEvent, user!.privateKey);
      const serializedZapEvent = encodeURIComponent(JSON.stringify(signedZapRequest));
      const zapEndpoint = await nip57.getZapEndpoint(recipient.event);
      const zapRequestUrl = zapEndpoint + `?amount=${amount * 1000}&nostr=${serializedZapEvent}`;
      const paymentRequest = await fetch(zapRequestUrl);
      const request = await paymentRequest.json();

      // Subscribe for the zap receipt so we can detect confirmation
      const since = Math.floor(Date.now() / 1000);
      zapSubRef.current?.unsubscribe();
      const handle = nostrRuntime.subscribe(
        defaultRelays,
        [{ kinds: [9735], "#e": [pollEvent.id], since }],
        {
          onEvent: (event) => {
            addEventToMap(event);
            addZapEvent(event);
            setZapConfirmed(true);
            zapSubRef.current?.unsubscribe();
            zapSubRef.current = null;
          },
        }
      );
      zapSubRef.current = handle;

      return request.pr;
    } catch (error) {
      console.error("Failed to create zap invoice:", error);
      showNotification("Failed to create invoice", "error");
      return null;
    }
  };

  const recipientName = recipient?.name || recipient?.display_name;

  const formatSats = (n: number): string => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
    return n.toString();
  };

  return (
    <Wrapper style={{ marginLeft: 20 }}>
      <Tooltip title={zapInfos.length > 0 ? "Tap to zap · Hold to see who zapped" : "Send a Zap"}>
        <span
          style={{ cursor: "pointer", display: "flex", flexDirection: "row", alignItems: "center" }}
          onMouseDown={startLongPress}
          onMouseUp={cancelLongPress}
          onMouseLeave={cancelLongPress}
          onTouchStart={startLongPress}
          onTouchEnd={cancelLongPress}
          onTouchCancel={cancelLongPress}
          onClick={handleClick}
        >
          {hasZapped ? (
            <FlashOn
              sx={(theme) => ({
                color: theme.palette.primary.main,
                "& path": {
                  ...getColorsWithTheme(theme, { stroke: "#000000" }),
                  strokeWidth: 2,
                },
              })}
            />
          ) : (
            <FlashOn
              sx={(theme) => ({
                color: theme.palette.mode === "light" ? "white" : "black",
                "& path": {
                  stroke: theme.palette.mode === "light" ? "black" : "white",
                  strokeWidth: 2,
                },
              })}
            />
          )}
          {totalSats > 0 && (
            <Typography sx={{ ml: 0.25 }}>{formatSats(totalSats)}</Typography>
          )}
        </span>
      </Tooltip>

      <ZapModal
        open={zapModalOpen}
        onClose={() => {
          zapSubRef.current?.unsubscribe();
          zapSubRef.current = null;
          setZapConfirmed(false);
          setZapModalOpen(false);
        }}
        onZap={handleZap}
        recipientName={recipientName}
        zapConfirmed={zapConfirmed}
      />

      <ZapDetailsModal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        zapInfos={zapInfos}
        totalSats={totalSats}
      />
    </Wrapper>
  );
};

export default Zap;
