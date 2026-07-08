import React, { useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Stack,
  Typography,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Container,
} from "@mui/material";
import PollIcon from "@mui/icons-material/Poll";
import EditNoteIcon from "@mui/icons-material/EditNote";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { nip19 } from "nostr-tools";
import { useNavigate } from "react-router-dom";
import { useDrafts } from "../../contexts/drafts-context";
import { LocalDraft, draftPreviewText } from "../EventCreator/draftModel";
import { calculateTimeAgo } from "../../utils/common";
import { NOSTR_EVENT_KINDS } from "../../constants/nostr";

const kindMeta: Record<LocalDraft["kind"], { icon: React.ReactNode; label: string }> = {
  poll: { icon: <PollIcon fontSize="small" />, label: "Poll" },
  note: { icon: <EditNoteIcon fontSize="small" />, label: "Note" },
  comment: { icon: <ForumOutlinedIcon fontSize="small" />, label: "Comment" },
};

const DraftCard: React.FC<{
  draft: LocalDraft;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ draft, onEdit, onDelete }) => {
  const meta = kindMeta[draft.kind];
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Chip size="small" icon={meta.icon as any} label={meta.label} />
          {draft.kind === "poll" && (
            <Typography variant="caption" color="text.secondary">
              {draft.options.length} option{draft.options.length !== 1 ? "s" : ""}
            </Typography>
          )}
          {draft.kind === "note" && draft.audienceKind === "private" && (
            <Chip size="small" variant="outlined" label="Private" />
          )}
          {draft.kind === "comment" && (
            <Typography variant="caption" color="text.secondary">
              Replying to {draft.parentKind === NOSTR_EVENT_KINDS.POLL ? "a poll" : "a note"}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.secondary">
            {calculateTimeAgo(Math.floor(draft.updated_at / 1000))}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: 1.5 }}>
          {draftPreviewText(draft)}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<EditIcon fontSize="small" />} onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="small"
            color="error"
            startIcon={<DeleteIcon fontSize="small" />}
            onClick={onDelete}
          >
            Delete
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

const DraftsList: React.FC = () => {
  const { drafts, deleteDraft } = useDrafts();
  const navigate = useNavigate();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const items = drafts ? Array.from(drafts.values()) : [];

  const handleEdit = (draft: LocalDraft) => {
    if (draft.kind === "poll") {
      navigate(`/create?type=poll&draftId=${draft.id}`);
    } else if (draft.kind === "note") {
      navigate(`/create?type=note&draftId=${draft.id}`);
    } else {
      const nevent = nip19.neventEncode({ id: draft.parentEventId });
      if (draft.parentKind === NOSTR_EVENT_KINDS.POLL) {
        navigate(`/respond/${nevent}`);
      } else {
        navigate(`/note/${nevent}`);
      }
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h5">Drafts</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        On device drafts
      </Typography>
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No drafts yet — save one while composing a poll, note, or comment.
        </Typography>
      ) : (
        <Stack spacing={2}>
          {items.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onEdit={() => handleEdit(draft)}
              onDelete={() => setPendingDeleteId(draft.id)}
            />
          ))}
        </Stack>
      )}

      <Dialog open={!!pendingDeleteId} onClose={() => setPendingDeleteId(null)}>
        <DialogTitle>Delete draft?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">This can't be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDeleteId(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (pendingDeleteId) deleteDraft(pendingDeleteId);
              setPendingDeleteId(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default DraftsList;
