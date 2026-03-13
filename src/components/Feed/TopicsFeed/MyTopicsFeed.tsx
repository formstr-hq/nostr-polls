import {
  Box,
  Chip,
  Typography,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  Checkbox,
  DialogActions,
  Button,
  CircularProgress,
  IconButton,
} from "@mui/material";
import ShieldIcon from "@mui/icons-material/Shield";
import SearchIcon from "@mui/icons-material/Search";
import { useEffect, useState } from "react";
import { useListContext } from "../../../hooks/useListContext";
import { useMyTopicsFeed } from "../../../hooks/useMyTopicsFeed";
import { Notes } from "../../../components/Notes";
import OverlappingAvatars from "../../../components/Common/OverlappingAvatars";
import { useUserContext } from "../../../hooks/useUserContext";
import TopicModeratorsDialog from "../../../components/Moderator/TopicModeratorsDialog";
import UnifiedFeed from "../UnifiedFeed";

interface MyTopicsFeedProps {
  onNavigateToDiscover?: () => void;
  onSearchClick?: () => void;
}

const MyTopicsFeed = ({ onNavigateToDiscover, onSearchClick }: MyTopicsFeedProps) => {
  const { myTopics } = useListContext();
  const {
    notes,
    toggleShowAnyway,
    publishModeration,
    publishUnmoderation,
    loading,
    moderatorsByTopic,
    selectedModsByTopic,
    setSelectedModeratorsForTopic,
    pendingCount,
    mergeNewNotes,
  } = useMyTopicsFeed(myTopics || new Set());
  const { user, requestLogin } = useUserContext();

  const [dialog, setDialog] = useState<{
    note: any;
    type: "off-topic" | "remove-user";
    topics: string[];
  } | null>(null);
  const [moderatorDialogOpen, setModeratorDialogOpen] = useState(false);

  if (!user) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          mt: 4,
          gap: 2,
        }}
      >
        <Typography variant="body1" color="text.secondary">
          Login to see notes from your interests
        </Typography>
        <Button variant="contained" onClick={requestLogin}>
          Login
        </Button>
      </Box>
    );
  }

  if (!myTopics || myTopics.size === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          mt: 4,
          gap: 2,
        }}
      >
        <Typography variant="body1" color="text.secondary">
          You haven't added any interests yet
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Discover topics in the "Recently Rated" tab and add them to your interests
        </Typography>
        {onNavigateToDiscover && (
          <Button variant="contained" onClick={onNavigateToDiscover}>
            Browse Topics
          </Button>
        )}
      </Box>
    );
  }

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          py: 6,
          height: "100%",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  const hasModerators = moderatorsByTopic.size > 0;

  return (
    <>
      <UnifiedFeed
        data={notes}
        newItemCount={pendingCount}
        onShowNewItems={mergeNewNotes}
        newItemLabel="notes"
        headerContent={
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1, py: 0.5 }}>
            {hasModerators ? (
              <Box sx={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={() => setModeratorDialogOpen(true)}>
                <IconButton size="small" title="Manage moderators">
                  <ShieldIcon fontSize="small" />
                </IconButton>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                  Moderators
                </Typography>
              </Box>
            ) : <Box />}
            {onSearchClick && (
              <IconButton size="small" onClick={onSearchClick} aria-label="Search topics">
                <SearchIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        }
        itemContent={(_, item) => {
          const { event, topics, hidden, moderators, moderatedTopics, myOffTopicTopics, myBlockedUserTopics } = item;

          return (
            <Box sx={{ mb: 2 }}>
              {/* Topic indicator */}
              <Box sx={{ mb: 1, display: "flex", gap: 1, flexWrap: "wrap" }}>
                {topics.map((t) => (
                  <Chip
                    key={t}
                    label={`#${t}`}
                    size="small"
                    color={moderatedTopics.has(t) ? "warning" : "default"}
                  />
                ))}
              </Box>

              <Notes
                event={event}
                hidden={hidden}
                showReason={
                  hidden ? (
                    <Box>
                      {moderators.size > 0 && (
                        <>
                          <Typography variant="body2">Moderated by:</Typography>
                          <OverlappingAvatars
                            ids={Array.from(moderators)}
                            maxAvatars={4}
                          />
                        </>
                      )}
                      <Button
                        size="small"
                        variant="text"
                        sx={{ mt: 1 }}
                        onClick={() => toggleShowAnyway(event.id)}
                      >
                        Show anyway
                      </Button>
                    </Box>
                  ) : null
                }
                extras={
                  <>
                    {myOffTopicTopics.length > 0 ? (
                      <MenuItem
                        onClick={() =>
                          publishUnmoderation("off-topic", event, myOffTopicTopics)
                        }
                      >
                        Unmark off-topic
                      </MenuItem>
                    ) : (
                      <MenuItem
                        onClick={() =>
                          setDialog({
                            note: event,
                            type: "off-topic",
                            topics,
                          })
                        }
                      >
                        Mark off-topic
                      </MenuItem>
                    )}

                    {myBlockedUserTopics.length > 0 ? (
                      <MenuItem
                        onClick={() =>
                          publishUnmoderation("remove-user", event, myBlockedUserTopics)
                        }
                      >
                        Unblock user from topic
                      </MenuItem>
                    ) : (
                      <MenuItem
                        onClick={() =>
                          setDialog({
                            note: event,
                            type: "remove-user",
                            topics,
                          })
                        }
                      >
                        Remove user from topic
                      </MenuItem>
                    )}

                    {hidden ? (
                      <MenuItem onClick={() => toggleShowAnyway(event.id)}>
                        Show anyway
                      </MenuItem>
                    ) : moderators.size > 0 ? (
                      <MenuItem onClick={() => toggleShowAnyway(event.id)}>
                        Hide again
                      </MenuItem>
                    ) : null}
                  </>
                }
              />
            </Box>
          );
        }}
      />

      {dialog && (
        <ModerationDialog
          open
          note={dialog.note}
          topics={dialog.topics}
          type={dialog.type}
          onClose={() => setDialog(null)}
          onSubmit={async (topics) => {
            await publishModeration(dialog.type, dialog.note, topics);
            setDialog(null);
          }}
        />
      )}
      <TopicModeratorsDialog
        open={moderatorDialogOpen}
        onClose={() => setModeratorDialogOpen(false)}
        moderatorsByTopic={moderatorsByTopic}
        selectedModsByTopic={selectedModsByTopic}
        onApply={setSelectedModeratorsForTopic}
      />
    </>
  );
};

const ModerationDialog = ({
  open,
  note,
  topics,
  type,
  onClose,
  onSubmit,
}: {
  open: boolean;
  note: Event;
  topics: string[];
  type: "off-topic" | "remove-user";
  onClose: () => void;
  onSubmit: (topics: string[]) => void;
}) => {
  const [selected, setSelected] = useState<string[]>(topics);

  useEffect(() => {
    setSelected(topics);
  }, [topics]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth>
      <DialogTitle>
        {type === "off-topic"
          ? "Mark note off-topic"
          : "Remove user from topic"}
      </DialogTitle>

      <DialogContent>
        {topics.map((t) => (
          <Box key={t} display="flex" alignItems="center">
            <Checkbox
              checked={selected.includes(t)}
              onChange={() =>
                setSelected((prev) =>
                  prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                )
              }
            />
            <Typography>#{t}</Typography>
          </Box>
        ))}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          disabled={selected.length === 0}
          onClick={() => onSubmit(selected)}
        >
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MyTopicsFeed;
