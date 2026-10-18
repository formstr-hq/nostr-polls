import React, { useEffect, useRef, useState } from "react";
import { Box, Chip } from "@mui/material";
import DescriptionIcon from "@mui/icons-material/DescriptionRounded";
import { useSubNav } from "../../contexts/SubNavContext";
import NoteTemplateForm from "./NoteTemplateForm";
import PollTemplateForm from "./PollTemplateForm";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useDrafts } from "../../contexts/drafts-context";

const EventForm = () => {
  const [searchParams, setSearchParams] = useSearchParams();
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

  // Note / Poll live as pills in the block header (SubNavContext), like sub-feeds.
  // The tab is mirrored to ?type= so the header can paint itself in the poll color.
  const { setItems, clearItems } = useSubNav();
  useEffect(() => {
    const select = (index: number) => {
      setTabIndex(index);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (index === 1) next.set("type", "poll");
          else next.delete("type");
          return next;
        },
        { replace: true }
      );
    };
    setItems([
      { key: "note", label: "Note", active: tabIndex === 0, onClick: () => select(0) },
      { key: "poll", label: "Poll", active: tabIndex === 1, onClick: () => select(1) },
    ]);
  }, [tabIndex, setItems, setSearchParams]);
  useEffect(() => () => clearItems(), [clearItems]);

  return (
    <Box sx={{ maxWidth: 760, mx: "auto", px: { xs: 1.25, sm: 2 }, pt: 1.5, pb: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
        <Chip
          icon={<DescriptionIcon />}
          label={draftCount > 0 ? `Drafts · ${draftCount}` : "Drafts"}
          onClick={() => navigate("/drafts")}
          sx={{ bgcolor: "cb.slab", fontWeight: 700 }}
        />
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
    </Box>
  );
};

export default EventForm;
