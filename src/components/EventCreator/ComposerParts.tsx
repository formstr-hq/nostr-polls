import { useSectionColorAt } from "../Shell/useSectionColor";
import React from "react";
import { Avatar, Box, ButtonBase, CircularProgress, IconButton, Tooltip, Typography } from "@mui/material";
import CloudDoneIcon from "@mui/icons-material/CloudDoneRounded";
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
 * The composer's floating dock: an ink capsule of tools and the Post button in
 * the block (or poll) color. Sticky, so it works on the /create page and inside
 * dialogs (quote post) alike.
 */
export const ComposerDock: React.FC<{
  tools: React.ReactNode;
  submitLabel: React.ReactNode;
  submitting?: boolean;
  disabled?: boolean;
  poll?: boolean;
  /**
   * Float at the bottom of the scrollport (the /create page). Set false inside
   * a dialog/quote composer: there the dock should sit under the editor in
   * normal flow so the keyboard/Post button can't cover the text being typed.
   */
  sticky?: boolean;
}> = ({ tools, submitLabel, submitting, disabled, poll, sticky = true }) => {
  // Post wears the note or poll palette color.
  const post = useSectionColorAt(poll ? 1 : 0);
  return (
  <Box
    sx={{
      position: sticky ? "sticky" : "relative",
      bottom: sticky
        ? { xs: "calc(12px + env(safe-area-inset-bottom))", md: 12 }
        : undefined,
      zIndex: 5,
      display: "flex",
      alignItems: "center",
      gap: 1.25,
      mt: 1,
    }}
  >
    <Box
      sx={{
        flex: 1,
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
        // Solid when disabled: the dock floats over content, so no translucency.
        "&.Mui-disabled": { bgcolor: "cb.ink", color: "rgba(255,255,255,0.4)" },
      }}
    >
      {submitting && <CircularProgress size={18} sx={{ color: "inherit" }} />}
      {submitLabel}
    </ButtonBase>
  </Box>
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
