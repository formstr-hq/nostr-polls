import { useSectionColorAt } from "../Shell/useSectionColor";
import React from "react";
import { Avatar, Box, ButtonBase, CircularProgress, IconButton, Tooltip, Typography, useTheme } from "@mui/material";
import { readableOn } from "../../styles/theme";
import CloudDoneIcon from "@mui/icons-material/CloudDoneRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { useUserContext } from "../../hooks/useUserContext";
import { useAppContext } from "../../hooks/useAppContext";
import { calculateTimeAgo } from "../../utils/common";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";

// Shared Color Block pieces for the note and poll composers (see designs/composer).

/** A content slab inside the composer. */
export const ComposerSlab: React.FC<{ children: React.ReactNode; sx?: object }> = ({ children, sx }) => (
  <Box sx={{ bgcolor: "cb.slab", borderRadius: "26px", p: { xs: 1.75, sm: 2.25 }, ...sx }}>{children}</Box>
);

/** Author line with the draft autosave status. */
export const WhoLine: React.FC<{
  autosaveStatus?: string;
  savedAt?: number;
}> = ({ autosaveStatus, savedAt }) => {
  const { user } = useUserContext();
  const { profiles } = useAppContext();
  const profile = user?.pubkey ? profiles?.get(user.pubkey) : undefined;
  const name = profile?.name || profile?.display_name || "You";
  const saving = autosaveStatus === "pending" || autosaveStatus === "saving";
  const saved = autosaveStatus === "saved" && savedAt;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1 }}>
      <Avatar src={profile?.picture || DEFAULT_IMAGE_URL} sx={{ width: 36, height: 36 }} />
      <Typography sx={{ fontWeight: 700, fontSize: 15 }}>{name}</Typography>
      {(saving || saved) && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
          aria-live="polite"
        >
          <span aria-hidden>·</span>
          {saving ? (
            "Saving draft…"
          ) : (
            <>
              <CloudDoneIcon sx={{ fontSize: 15 }} />
              Draft saved {calculateTimeAgo(Math.floor((savedAt as number) / 1000))}
            </>
          )}
        </Typography>
      )}
    </Box>
  );
};

/** One tool button in the dock. */
export const DockTool: React.FC<{
  title: string;
  onClick?: () => void;
  active?: boolean;
  warn?: boolean;
  disabled?: boolean;
  busy?: boolean;
  children: React.ReactNode;
}> = ({ title, onClick, active, warn, disabled, busy, children }) => (
  <Tooltip title={title}>
    <span>
      <IconButton
        aria-label={title}
        aria-pressed={active}
        onClick={onClick}
        disabled={disabled || busy}
        sx={{
          width: 42,
          height: 42,
          color: warn ? "warning.light" : active ? "#111" : "rgba(255,255,255,0.85)",
          bgcolor: active ? "cb.accent" : warn ? "rgba(255,255,255,0.12)" : "transparent",
          "&:hover": { bgcolor: active ? "cb.accent" : "rgba(255,255,255,0.1)" },
          "&.Mui-disabled": { color: "rgba(255,255,255,0.35)" },
        }}
      >
        {busy ? <CircularProgress size={18} sx={{ color: "inherit" }} /> : children}
      </IconButton>
    </span>
  </Tooltip>
);

/**
 * The composer's dock: an ink capsule of tools plus optional actions (the
 * preview toggle, and the Post button inside dialogs). It sits in normal flow,
 * below the scrolling fields on the /create page — never on top of them.
 */
export const ComposerDock: React.FC<{
  tools: React.ReactNode;
  /**
   * Submit button inside the dock. Omitted on the /create page, where Post
   * lives in the header; the quote dialog still renders it here.
   */
  submitLabel?: React.ReactNode;
  submitting?: boolean;
  disabled?: boolean;
  poll?: boolean;
  /** A standalone round action shown beside the capsule (the preview toggle). */
  trailing?: React.ReactNode;
}> = ({ tools, submitLabel, submitting, disabled, poll, trailing }) => {
  // Post wears the note or poll palette color.
  const post = useSectionColorAt(poll ? 1 : 0);
  return (
  <Box
    sx={{
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 1.25,
      mt: 1,
    }}
  >
    <Box
      sx={{
        flex: "0 1 auto",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        p: 0.5,
        borderRadius: "24px",
        bgcolor: "cb.ink",
        overflowX: "auto",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
        boxShadow: (t) =>
          t.palette.mode === "dark" ? "0 0 0 1px rgba(255,255,255,0.09)" : "0 14px 30px -12px rgba(0,0,0,0.5)",
      }}
    >
      {tools}
    </Box>
    {(trailing || submitLabel) && (
      <Box sx={{ flex: "none", display: "flex", alignItems: "center", gap: 1.25 }}>
        {trailing}
        {submitLabel && (
          <ButtonBase
            type="submit"
            disabled={submitting || disabled}
            sx={{
              flex: "none",
              height: 52,
              px: 2.75,
              gap: 1,
              borderRadius: "20px",
              fontFamily: "inherit",
              fontWeight: 800,
              fontSize: 16,
              background: post.fill,
              color: post.on,
              boxShadow: "0 14px 28px -12px rgba(0,0,0,0.5)",
              "&.Mui-disabled": { bgcolor: "cb.ink", color: "rgba(255,255,255,0.4)" },
            }}
          >
            {submitting && <CircularProgress size={18} sx={{ color: "inherit" }} />}
            {submitLabel}
          </ButtonBase>
        )}
      </Box>
    )}
  </Box>
);
};

/**
 * Mode banner shown while previewing. Preview replaces the editor area (it does
 * not collapse in below the buttons), so this banner is the way back to editing.
 */
export const PreviewBanner: React.FC<{ poll?: boolean; onEdit: () => void }> = ({ poll, onEdit }) => {
  const theme = useTheme();
  const section = useSectionColorAt(poll ? 1 : 0);
  // The block color as readable text on the page (not the vivid block fill).
  const accent = readableOn(section.color, theme.palette.mode);
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.5,
        py: 1.25,
        borderRadius: "18px",
        bgcolor: "cb.slab",
      }}
    >
      <VisibilityRoundedIcon sx={{ fontSize: 20, color: accent, flex: "none" }} />
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, lineHeight: 1.3 }}>
        Preview — how it appears in feeds
      </Typography>
      <ButtonBase
        onClick={onEdit}
        sx={{
          flex: "none",
          px: 1.5,
          py: 0.75,
          borderRadius: "12px",
          fontFamily: "inherit",
          fontWeight: 800,
          fontSize: 13.5,
          color: accent,
        }}
      >
        Edit
      </ButtonBase>
    </Box>
  );
};

/**
 * Standalone round button beside the tool capsule (the preview toggle in the
 * composer designs). Same ink treatment as the capsule, so it reads as part of
 * the dock without being another tool inside it.
 */
export const DockRoundTool: React.FC<{
  title: string;
  onClick?: () => void;
  active?: boolean;
  /** Use the poll palette for the active tint (poll composer). */
  poll?: boolean;
  children: React.ReactNode;
}> = ({ title, onClick, active, poll, children }) => {
  const accent = useSectionColorAt(poll ? 1 : 0).accent;
  return (
  <Tooltip title={title}>
    <IconButton
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      sx={{
        flex: "none",
        width: 52,
        height: 52,
        borderRadius: "50%",
        bgcolor: active ? accent : "cb.ink",
        color: active ? "#111" : "rgba(255,255,255,0.85)",
        "&:hover": { bgcolor: active ? accent : "cb.ink" },
        boxShadow: (t) =>
          t.palette.mode === "dark" ? "0 0 0 1px rgba(255,255,255,0.09)" : "0 14px 30px -12px rgba(0,0,0,0.5)",
      }}
    >
      {children}
    </IconButton>
  </Tooltip>
  );
};

/** Insert `text` at the textarea's cursor, keeping focus and caret after it. */
export function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  current: string,
  text: string,
  set: (v: string) => void
) {
  const pos = el?.selectionStart ?? current.length;
  const end = el?.selectionEnd ?? pos;
  set(current.slice(0, pos) + text + current.slice(end));
  const caret = pos + text.length;
  requestAnimationFrame(() => {
    if (el) {
      el.focus();
      el.setSelectionRange(caret, caret);
    }
  });
}

/** Section label used inside composer slabs. */
export const ComposerLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography
    sx={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "text.secondary", mb: 1 }}
  >
    {children}
  </Typography>
);
