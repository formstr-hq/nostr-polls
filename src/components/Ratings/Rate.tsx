import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Button,
  TextField,
  Rating as MuiRating,
  Alert,
} from "@mui/material";
import { useRating } from "../../hooks/useRating";

interface Props {
  entityId: string;
  entityType?: string; // 'event', 'profile', etc.
}

const Rate: React.FC<Props> = ({ entityId, entityType = "event" }) => {
  const ratingKey = `${entityType}:${entityId}`;
  const { averageRating, totalRatings, submitRating, getUserRating } =
    useRating(ratingKey);
  const [ratingValue, setRatingValue] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [showContentInput, setShowContentInput] = useState(false);
  const [error, setError] = useState("");
  const userRating = getUserRating(ratingKey);

  useEffect(() => {
    if (userRating) {
      setRatingValue(userRating * 5);
    }
  }, [userRating]);

  const handleSubmit = () => {
    if (ratingValue === null) {
      setError("Please give a rating before submitting a review.");
      return;
    }
    setError("");
    submitRating(ratingValue, 5, entityType, content);
    setShowContentInput(false);
  };

  const handleRatingChange = (
    _: React.SyntheticEvent,
    newValue: number | null
  ) => {
    if (newValue != null) {
      setRatingValue(newValue);
      setError("");
      //If Review is being added we should not submit rating on rating change
      if (!showContentInput) submitRating(newValue, 5, entityType);
    }
  };

  const handleAddReviewClick = () => {
    setShowContentInput(true);
  };
  return (
    <Box
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <MuiRating
          name={`rating-${entityId}`}
          value={
            ratingValue ? ratingValue : averageRating ? averageRating * 5 : null
          }
          max={5}
          precision={0.1}
          onChange={(e, newValue) => {
            e.stopPropagation();
            handleRatingChange(e, newValue);
          }}
        />

        {totalRatings ? (
          <Typography variant="caption" color="text.secondary">
            Rated: {(averageRating! * 5).toFixed(2)} from {totalRatings} rating
            {totalRatings !== 1 ? "s" : ""}
          </Typography>
        ) : null}
      </Box>

      {!showContentInput && (
        <Button
          variant="text"
          sx={{ mt: 1 }}
          onClick={(e) => {
            e.stopPropagation();
            handleAddReviewClick();
          }}
        >
          Add review to your rating?
        </Button>
      )}

      {showContentInput && (
        <>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Your Review"
            onClick={(e) => {
              e.stopPropagation();
            }}
            value={content}
            onChange={(e) => {
              e.stopPropagation();
              setContent(e.target.value);
            }}
            sx={{ mt: 2 }}
          />
          <Button
            variant="contained"
            sx={{ mt: 1 }}
            onClick={(e) => {
              e.stopPropagation();
              handleSubmit();
            }}
          >
            Submit Review
          </Button>
        </>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
};

export default Rate;
