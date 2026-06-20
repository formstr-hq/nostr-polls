import { useNavigate, useParams } from "react-router-dom";
import { Filter } from "nostr-tools/lib/types/filter";
import { Event } from "nostr-tools/lib/types/core";
import { useRelays } from "../../hooks/useRelays";
import { useEffect, useRef, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import { Analytics } from "./Analytics";
import { dataLayer } from "@formstr/local-relay";
import { useNotification } from "../../contexts/notification-context";
import { NOTIFICATION_MESSAGES } from "../../constants/notifications";

export const PollResults = () => {
  let { eventId } = useParams();
  const [pollEvent, setPollEvent] = useState<Event | undefined>();
  const [respones, setResponses] = useState<Event[] | undefined>();
  const [eoseReceived, setEoseReceived] = useState(false);
  const { showNotification } = useNotification();
  const { relays } = useRelays();
  const startedRef = useRef(false);
  let navigate = useNavigate();

  const getUniqueLatestEvents = (events: Event[]) => {
    const eventMap = new Map<string, any>();
    events.forEach((event) => {
      if (
        !eventMap.has(event.pubkey) ||
        event.created_at > eventMap.get(event.pubkey).created_at
      ) {
        eventMap.set(event.pubkey, event);
      }
    });
    return Array.from(eventMap.values());
  };

  const handleResultEvent = (event: Event) => {
    if (event.kind === 1068) {
      setPollEvent(event);
    }
    if (event.kind === 1070 || event.kind === 1018) {
      setResponses((prevResponses) => [...(prevResponses || []), event]);
    }
  };

  useEffect(() => {
    if (startedRef.current || !relays?.length) return;
    startedRef.current = true;

    if (!eventId) {
      showNotification(NOTIFICATION_MESSAGES.INVALID_URL, "error");
      navigate("/");
      return;
    }

    const resultFilter: Filter = { "#e": [eventId!], kinds: [1070, 1018] };
    const pollFilter: Filter = { ids: [eventId!] };

    // NIP-88 poll events carry ["relay", ...] tags for where responses live, but
    // relay selection is the worker's job now — it routes these filters and warms
    // from the relevant relays. The app just declares interest in the responses.
    const closer = dataLayer.observe([resultFilter, pollFilter], {
      onEvent: handleResultEvent,
      onEose: () => setEoseReceived(true),
    });

    // Fallback: mark EOSE after 6s in case relays don't send one
    const fallback = setTimeout(() => setEoseReceived(true), 6000);

    return () => {
      closer.unobserve();
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relays]);

  // Waiting for relays to be ready
  if (!relays?.length) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  // Poll event loaded (with or without EOSE): show Analytics with loading skeleton
  if (pollEvent) {
    return (
      <Analytics
        pollEvent={pollEvent}
        responses={getUniqueLatestEvents(respones || [])}
        loading={!eoseReceived}
      />
    );
  }

  // No poll event yet and EOSE not received: show a minimal loading state
  if (!eoseReceived) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return <Typography sx={{ p: 2 }}>Poll not found.</Typography>;
};
