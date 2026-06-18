import React, { useEffect, useRef, useState } from "react";
import { Tooltip, Typography } from "@mui/material";
import { useAppContext } from "../../../hooks/useAppContext";
import { Event } from "nostr-tools/lib/types/core";
import { defaultRelays, signEvent } from "../../../nostr";
import { useRelays } from "../../../hooks/useRelays";
import { FlashOn } from "@mui/icons-material";
import { nip57 } from "nostr-tools";
import { useUserContext } from "../../../hooks/useUserContext";
import { styled, keyframes } from "@mui/system";
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

// Pulsing glow shown while holding to ramp the zap amount.
const holdPulse = keyframes`
  0%   { filter: drop-shadow(0 0 1px #FAD13F); }
  50%  { filter: drop-shadow(0 0 6px #F7931A); }
  100% { filter: drop-shadow(0 0 1px #FAD13F); }
`;

// ── Hold-to-zap ramp tuning ──────────────────────────────────────────────────
// Below ACTIVATE_MS a press is treated as a plain tap (opens the modal at the
// default amount). Past it, sats ramp up exponentially every TICK_MS and the
// icon grows with the (log-scaled) amount.
const HOLD_ACTIVATE_MS = 180;
const HOLD_TICK_MS = 110;
const HOLD_BASE_SATS = 1;
const HOLD_GROWTH = 1.18;
// Once the ramp climbs past this, the zap modal opens automatically.
const HOLD_MAX_SATS = 100_000;
const HOLD_MAX_SCALE = 1.9;

const Zap: React.FC<ZapProps> = ({ pollEvent }) => {
  const { profiles, addEventToMap } = useAppContext();
  const { registerEventId, getZapInfos, getTotalSats, addZapEvent } = useZaps();
  const { user, requestLogin } = useUserContext();
  const [zapModalOpen, setZapModalOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [zapConfirmed, setZapConfirmed] = useState(false);
  // Amount the modal should open at — set by the hold-to-zap ramp.
  const [pendingAmount, setPendingAmount] = useState<number | undefined>(undefined);
  const zapSubRef = useRef<{ unsubscribe: () => void } | null>(null);
  const { showNotification } = useNotification();
  const { relays } = useRelays();

  // ── Hold-to-zap ramp state ────────────────────────────────────────────────
  const [holdSats, setHoldSats] = useState(0); // 0 ⇒ not ramping
  const [isHolding, setIsHolding] = useState(false);
  const holdSatsRef = useRef(0);
  const holdStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const didHold = useRef(false);
  // Touch devices synthesize a mouse/click after a touch; suppress the click
  // that trails a committed hold so the modal doesn't reopen at the default.
  const suppressClickRef = useRef(false);

  const recipient = profiles?.get(pollEvent.pubkey);
  const zapInfos = getZapInfos(pollEvent.id);
  const totalSats = getTotalSats(pollEvent.id);
  const hasZapped = zapInfos.some((z) => z.senderPubkey === user?.pubkey);

  useEffect(() => {
    registerEventId(pollEvent.id);
  }, [pollEvent.id, registerEventId]);

  // ── Hold-to-zap handlers ──────────────────────────────────────────────────
  // Press and hold the icon: after a short delay the amount ramps up while the
  // icon grows. Releasing opens the zap modal preset to that amount. A quick
  // tap (released before the ramp starts) just opens the modal at the default.

  const openZapModal = (amount?: number) => {
    if (!user) {
      requestLogin();
      return;
    }
    if (!recipient) {
      showNotification(NOTIFICATION_MESSAGES.RECIPIENT_PROFILE_ERROR, "error");
      return;
    }
    setPendingAmount(amount);
    setZapModalOpen(true);
  };

  const stopRamp = () => {
    if (holdStartTimer.current) {
      clearTimeout(holdStartTimer.current);
      holdStartTimer.current = null;
    }
    if (holdInterval.current) {
      clearInterval(holdInterval.current);
      holdInterval.current = null;
    }
    setIsHolding(false);
    setHoldSats(0);
    holdSatsRef.current = 0;
  };

  // Open the zap modal at the ramped amount and stop ramping. Suppresses the
  // synthetic click that trails a touch release so the modal doesn't reopen.
  const commitRamp = (amount: number) => {
    stopRamp();
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 500);
    openZapModal(amount);
  };

  const startHold = () => {
    // Ignore a re-entrant press (e.g. a synthetic mousedown trailing a touch).
    if (holdStartTimer.current || holdInterval.current) return;
    didHold.current = false;
    holdStartTimer.current = setTimeout(() => {
      didHold.current = true;
      setIsHolding(true);
      let sats = HOLD_BASE_SATS;
      holdSatsRef.current = sats;
      setHoldSats(sats);
      holdInterval.current = setInterval(() => {
        // Guarantee at least +1/tick so the exponential isn't stuck near 1 sat.
        const next = Math.max(sats + 1, Math.round(sats * HOLD_GROWTH));
        if (next > HOLD_MAX_SATS) {
          // Climbed past the ceiling → auto-open the modal at the max.
          commitRamp(HOLD_MAX_SATS);
          return;
        }
        sats = next;
        holdSatsRef.current = sats;
        setHoldSats(sats);
      }, HOLD_TICK_MS);
    }, HOLD_ACTIVATE_MS);
  };

  // Released over the button → commit the ramped amount (if we ramped).
  const endHold = () => {
    const ramped = didHold.current ? holdSatsRef.current : 0;
    if (ramped > 0) {
      commitRamp(ramped);
    } else {
      stopRamp();
    }
  };

  // Pointer left the button mid-hold → abort without zapping.
  const cancelHold = () => {
    stopRamp();
  };

  // Clean up timers if the component unmounts mid-hold.
  useEffect(() => () => stopRamp(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = () => {
    if (suppressClickRef.current || didHold.current) return; // hold already opened the modal
    openZapModal();
  };

  // Icon scale tracks the ramped amount on a log scale so it grows smoothly.
  const holdScale = isHolding
    ? 1 +
      (HOLD_MAX_SCALE - 1) *
        Math.min(
          1,
          Math.log(Math.max(holdSats, HOLD_BASE_SATS) / HOLD_BASE_SATS) /
            Math.log(HOLD_MAX_SATS / HOLD_BASE_SATS)
        )
    : 1;

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
      <span style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
        <Tooltip title="Tap to zap · Hold to charge up the amount">
          <span
            style={{ cursor: "pointer", display: "flex", alignItems: "center" }}
            onMouseDown={startHold}
            onMouseUp={endHold}
            onMouseLeave={cancelHold}
            onTouchStart={startHold}
            onTouchEnd={endHold}
            onTouchCancel={cancelHold}
            onClick={handleClick}
          >
            <FlashOn
              sx={(theme) => ({
                color: isHolding
                  ? "#F7931A"
                  : hasZapped
                  ? theme.palette.primary.main
                  : theme.palette.mode === "light"
                  ? "white"
                  : "black",
                transform: `scale(${holdScale})`,
                transformOrigin: "center",
                transition: isHolding
                  ? "transform 0.11s ease-out, color 0.11s ease-out"
                  : "transform 0.2s ease-out, color 0.2s ease-out",
                animation: isHolding ? `${holdPulse} 0.9s ease-in-out infinite` : "none",
                "& path": {
                  ...(hasZapped
                    ? getColorsWithTheme(theme, { stroke: "#000000" })
                    : { stroke: theme.palette.mode === "light" ? "black" : "white" }),
                  strokeWidth: 2,
                },
              })}
            />
            {isHolding && (
              <Typography
                sx={{ ml: 0.5, fontWeight: 700, color: "#F7931A", minWidth: 36 }}
              >
                {formatSats(holdSats)}
              </Typography>
            )}
          </span>
        </Tooltip>

        {!isHolding && totalSats > 0 && (
          <Tooltip title="See who zapped">
            <Typography
              sx={{ ml: 0.25, cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                setDetailsOpen(true);
              }}
            >
              {formatSats(totalSats)}
            </Typography>
          </Tooltip>
        )}
      </span>

      <ZapModal
        open={zapModalOpen}
        onClose={() => {
          zapSubRef.current?.unsubscribe();
          zapSubRef.current = null;
          setZapConfirmed(false);
          setZapModalOpen(false);
          setPendingAmount(undefined);
        }}
        onZap={handleZap}
        recipientName={recipientName}
        zapConfirmed={zapConfirmed}
        initialAmount={pendingAmount}
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
