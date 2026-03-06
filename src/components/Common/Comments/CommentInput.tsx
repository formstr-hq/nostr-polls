import React, { useState } from "react";
import { Button } from "@mui/material";
import MentionTextArea from "../../EventCreator/MentionTextArea";

interface CommentInputProps {
  onSubmit: (content: string) => void;
  initialContent?: string;
}

const CommentInput: React.FC<CommentInputProps> = ({
  onSubmit,
  initialContent = "",
}) => {
  const [newComment, setNewComment] = useState<string>(initialContent);

  const handleSubmit = () => {
    if (newComment.trim()) {
      onSubmit(newComment);
      setNewComment("");
    }
  };

  return (
    <div>
      <MentionTextArea
        label="Add a comment"
        value={newComment}
        onChange={setNewComment}
        minRows={2}
        maxRows={6}
      />
      <Button
        onClick={handleSubmit}
        variant="contained"
        color="secondary"
        style={{ marginTop: 8 }}
      >
        Submit Comment
      </Button>
    </div>
  );
};

export default CommentInput;
