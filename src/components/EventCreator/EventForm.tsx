import React, { useEffect, useRef, useState } from "react";
import { Container, Box, Card, Tabs, Tab, Button, Badge } from "@mui/material";
import EditNoteIcon from "@mui/icons-material/EditNote";
import PollIcon from "@mui/icons-material/Poll";
import DescriptionIcon from "@mui/icons-material/Description";
import NoteTemplateForm from "./NoteTemplateForm";
import PollTemplateForm from "./PollTemplateForm";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useDrafts } from "../../contexts/drafts-context";

const EventForm = () => {
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get("draftId");
  const initialTab = searchParams.get("type") === "poll" ? 1 : 0;
  const initialHashtag = searchParams.get("hashtag");

  const { drafts } = useDrafts();
  const navigate = useNavigate();

  const [tabIndex, setTabIndex] = useState(initialTab);
  const [eventContent, setEventContent] = useState(
    initialHashtag ? `#${initialHashtag} ` : ""
  );

  const draft = draftId ? drafts?.get(draftId) : undefined;
  // Drafts load from IndexedDB asynchronously, so hydrate the tab/content once
  // the target draft becomes available rather than at initial mount.
  const hydratedDraftIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!draft || hydratedDraftIdRef.current === draft.id) return;
    hydratedDraftIdRef.current = draft.id;
    if (draft.kind === "poll") {
      setTabIndex(1);
      setEventContent(draft.eventContent);
    } else if (draft.kind === "note") {
      setTabIndex(0);
      setEventContent(draft.eventContent);
    }
  }, [draft]);

  const pollDraft = draft?.kind === "poll" ? draft : undefined;
  const noteDraft = draft?.kind === "note" ? draft : undefined;
  const draftCount = drafts?.size ?? 0;

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Card elevation={2} sx={{ p: 3 }}>
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
          <Button
            size="small"
            color="inherit"
            startIcon={
              <Badge badgeContent={draftCount} color="primary" invisible={draftCount === 0}>
                <DescriptionIcon fontSize="small" />
              </Badge>
            }
            onClick={() => navigate("/drafts")}
          >
            Drafts
          </Button>
        </Box>
        <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
          <Tabs
            value={tabIndex}
            onChange={(_, newValue) => setTabIndex(newValue)}
            variant="fullWidth"
          >
            <Tab icon={<EditNoteIcon />} label="Note" iconPosition="start" />
            <Tab icon={<PollIcon />} label="Poll" iconPosition="start" />
          </Tabs>
        </Box>
        {tabIndex === 0 ? (
          <NoteTemplateForm
            eventContent={eventContent}
            setEventContent={setEventContent}
            initialDraft={noteDraft}
          />
        ) : (
          <PollTemplateForm
            eventContent={eventContent}
            setEventContent={setEventContent}
            initialDraft={pollDraft}
          />
        )}
      </Card>
    </Container>
  );
};

export default EventForm;
