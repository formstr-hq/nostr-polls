import { createContext, useContext } from "react";

// Tracks how deeply a note is embedded inside another note's content. A note
// rendered at the top of a page/feed is depth 0; a note referenced inside it is
// depth 1, and so on. Used to cap reference recursion so a chain of embeds
// doesn't render an unbounded (or circular) tree — past the cap we show a
// clickable "open in its own view" card instead.
export const NoteDepthContext = createContext<number>(0);

// Embeds deeper than this are not rendered inline; we link out instead.
export const MAX_NOTE_DEPTH = 2;

export const useNoteDepth = () => useContext(NoteDepthContext);
