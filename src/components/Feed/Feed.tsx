import { Event } from "nostr-tools/lib/types/core";
import React, { useEffect, useState } from "react";
import PollResponseForm from "../PollResponse/PollResponseForm";
import { makeStyles } from "@mui/styles";
import { Notes } from "../Notes";
import ReplayIcon from "@mui/icons-material/Replay";
import Typography from "@mui/material/Typography";
import OverlappingAvatars from "../Common/OverlappingAvatars";

const useStyles = makeStyles((theme) => ({
  root: {
    margin: "20px auto",
    width: "100%",
    maxWidth: "min(600px, 100%)",
  },
  repostText: {
    fontSize: "0.75rem",
    color: "#4caf50",
    marginLeft: "10px",
    marginRight: 10,
    display: "flex",
    flexDirection: "row",
  },
}));

interface FeedProps {
  events: Event[]; // original events (polls, notes)
  reposts?: Map<string, Event[]>; // kind: 16 reposts
  userResponses: Map<string, Event>;
}

export const Feed: React.FC<FeedProps> = ({
  events,
  reposts,
  userResponses,
}) => {
  const classes = useStyles();
  const [mergedEvents, setMergedEvents] = useState<
    { event: Event; repostedBy?: Array<string>; timestamp: number }[]
  >([]);

  useEffect(() => {
    const eventMap: { [id: string]: Event } = {};
    events.forEach((e) => {
      eventMap[e.id] = e;
    });

    const merged: { event: Event; repostedBy?: string[]; timestamp: number }[] =
      [];

    // Original events
    events.forEach((e) => {
      const repostsForEvent = reposts?.get(e.id);
      (repostsForEvent || []).sort(
        (a: Event, b: Event) => b.created_at - a.created_at
      );

      merged.push({
        event: e,
        timestamp: Math.max(
          repostsForEvent?.[0]?.created_at || 0,
          e.created_at
        ),
        repostedBy: repostsForEvent?.map((e) => e.pubkey) || [],
      });
    });

    // Sort newest first
    merged.sort((a, b) => b.timestamp - a.timestamp);
    setMergedEvents(merged);
  }, [events, reposts]);

  return (
    <div>
      {mergedEvents.map(({ event, repostedBy }) => {
        const key = `${event.id}-${repostedBy || "original"}`;
        return (
          <div className={classes.root} key={key}>
            {repostedBy?.length !== 0 ? (
              <div className={classes.repostText}>
                <ReplayIcon />
                <Typography style={{ marginRight: 10 }}>
                  {" "}
                  Reposted by
                </Typography>
                <OverlappingAvatars ids={repostedBy || []} />
              </div>
            ) : null}
            {event.kind === 1 ? (
              <Notes event={event} />
            ) : event.kind === 1068 ? (
              <PollResponseForm
                pollEvent={event}
                userResponse={userResponses.get(event.id)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
