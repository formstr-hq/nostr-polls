import { Option } from "../../interfaces";

// Drafts are LOCAL only — stored on the device (IndexedDB), never on a relay —
// for any unpublished composition: a poll, a plain note, or a comment/reply.
// A draft is deleted the moment the thing it represents is actually published;
// unlike playlists, there's no "local copy that's also public" state to keep.

interface BaseDraft {
  id: string;
  created_at: number;
  updated_at: number;
}

export interface PollDraft extends BaseDraft {
  kind: "poll";
  eventContent: string;
  options: Option[];
  pollType: string;
  poW: number | null;
  expiration: number | null;
}

export interface NoteDraft extends BaseDraft {
  kind: "note";
  eventContent: string;
  audienceKind: "public" | "private";
  expiresInSeconds: number | null;
}

export interface CommentDraft extends BaseDraft {
  kind: "comment";
  content: string;
  parentEventId: string; // the note/poll/article/comment being replied to
  parentKind: number; // routes the drafts list back to the right page
  parentPreview?: string; // short text snippet of the parent, for display
  addressableRef?: string; // NIP-22 root "A" ref, if this thread uses one
  rootKind?: number; // NIP-22 root "K", if this thread uses one
}

export type LocalDraft = PollDraft | NoteDraft | CommentDraft;

export const newDraftId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Short preview text for a draft's content, used in the drafts list and as a
// fallback title when a poll/note question hasn't been written yet.
export const draftPreviewText = (draft: LocalDraft): string => {
  const content = draft.kind === "comment" ? draft.content : draft.eventContent;
  const trimmed = content.trim();
  if (!trimmed) {
    return draft.kind === "poll"
      ? "Untitled poll"
      : draft.kind === "note"
      ? "Untitled note"
      : "Untitled comment";
  }
  return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed;
};
