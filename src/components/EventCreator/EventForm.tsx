import React, { useState } from "react";
import { Container, Box, Card, Tabs, Tab } from "@mui/material";
import EditNoteIcon from "@mui/icons-material/EditNote";
import PollIcon from "@mui/icons-material/Poll";
import NoteTemplateForm from "./NoteTemplateForm";
import PollTemplateForm from "./PollTemplateForm";
import { useSearchParams } from "react-router-dom";

const EventForm = () => {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("type") === "poll" ? 1 : 0;
  const initialHashtag = searchParams.get("hashtag");

  const [tabIndex, setTabIndex] = useState(initialTab);
  const [eventContent, setEventContent] = useState(
    initialHashtag ? `#${initialHashtag} ` : ""
  );

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Card elevation={2} sx={{ p: 3 }}>
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
          <NoteTemplateForm eventContent={eventContent} setEventContent={setEventContent} />
        ) : (
          <PollTemplateForm eventContent={eventContent} setEventContent={setEventContent} />
        )}
      </Card>
    </Container>
  );
};

export default EventForm;
