// PollTimer.tsx
import React, { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Typography } from "@mui/material";

interface PollTimerProps {
  pollExpiration: string | undefined;
}

const calculateTimeRemaining = (pollExpiration: string) => {
  if (!pollExpiration) return null;
  const expirationDate = dayjs.unix(Number(pollExpiration));
  return expirationDate.diff(dayjs(), "milliseconds");
};

const PollTimer: React.FC<PollTimerProps> = ({ pollExpiration }) => {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!pollExpiration) return;

    const updateTimeRemaining = () => {
      const remaining = calculateTimeRemaining(pollExpiration);
      setTimeRemaining(remaining);
    };

    updateTimeRemaining(); // Initial call to set the time immediately

    const interval = setInterval(updateTimeRemaining, 1000); // Update every second

    return () => clearInterval(interval);
  }, [pollExpiration]);

  const isPollConcluded = timeRemaining !== null && timeRemaining <= 0;

  const renderExpirationMessage = () => {
    if (isPollConcluded) {
      return `Closed · ${dayjs.unix(Number(pollExpiration)).format("MMM D, HH:mm")}`;
    }

    if (timeRemaining !== null) {
      const isLessThan100Hours = timeRemaining < 100 * 60 * 60 * 1000;

      if (isLessThan100Hours) {
        const hoursLeft = Math.floor(timeRemaining / (1000 * 60 * 60));
        const minutesLeft = Math.floor(
          (timeRemaining % (1000 * 60 * 60)) / (1000 * 60)
        );
        const secondsLeft = Math.floor((timeRemaining % (1000 * 60)) / 1000);
        if (hoursLeft >= 1) return `${hoursLeft}h ${minutesLeft}m left`;
        return `${minutesLeft}m ${secondsLeft}s left`;
      } else {
        const daysLeft = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
        return `${daysLeft} days left`;
      }
    }

    return null;
  };

  return (
    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
      {renderExpirationMessage()}
    </Typography>
  );
};

export default PollTimer;
