import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  TextField,
  Popper,
  Paper,
  MenuList,
  MenuItem,
  Avatar,
  Typography,
  Box,
} from "@mui/material";
import { useAppContext } from "../../hooks/useAppContext";
import { nip19 } from "nostr-tools";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";

interface MentionTextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  minRows?: number;
  maxRows?: number;
  /** Called when the user pastes an image/video file into the textarea */
  onFilePaste?: (file: File, cursorPos: number) => void;
}

interface ProfileMatch {
  pubkey: string;
  displayName: string;
  picture: string;
  nip05?: string;
}

const MentionTextArea: React.FC<MentionTextAreaProps> = ({
  label,
  value,
  onChange,
  placeholder,
  required,
  minRows = 4,
  maxRows = 8,
  onFilePaste,
}) => {
  const { profiles } = useAppContext();
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState<number>(-1);
  const [matches, setMatches] = useState<ProfileMatch[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const open = mentionQuery !== null && matches.length > 0;

  // Search profiles when mentionQuery changes
  useEffect(() => {
    if (mentionQuery === null || !profiles) {
      setMatches([]);
      return;
    }

    const query = mentionQuery.toLowerCase();
    const results: ProfileMatch[] = [];

    profiles.forEach((profile, pubkey) => {
      if (results.length >= 8) return;

      const name = (profile.display_name || profile.name || "").toLowerCase();
      const nip05Val = (profile.nip05 || "").toLowerCase();

      if (
        query === "" ||
        name.includes(query) ||
        nip05Val.includes(query)
      ) {
        let displayName = profile.display_name || profile.name;
        if (!displayName) {
          try {
            displayName = nip19.npubEncode(pubkey).slice(0, 12);
          } catch {
            displayName = pubkey.slice(0, 12);
          }
        }
        results.push({
          pubkey,
          displayName,
          picture: profile.picture || DEFAULT_IMAGE_URL,
          nip05: profile.nip05,
        });
      }
    });

    setMatches(results);
    setSelectedIndex(0);
  }, [mentionQuery, profiles]);

  const insertMention = useCallback(
    (profile: ProfileMatch) => {
      const npub = nip19.npubEncode(profile.pubkey);
      const before = value.slice(0, mentionStart);
      const after = value.slice(inputRef.current?.selectionStart ?? value.length);
      const newValue = `${before}nostr:${npub} ${after}`;
      onChange(newValue);
      setMentionQuery(null);
      setMentionStart(-1);

      // Restore cursor position after React re-renders
      const cursorPos = before.length + `nostr:${npub} `.length;
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(cursorPos, cursorPos);
        inputRef.current?.focus();
      });
    },
    [value, mentionStart, onChange]
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart ?? newValue.length;
    onChange(newValue);

    // Check for @ trigger
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex >= 0) {
      // Make sure @ is at start or preceded by whitespace
      const charBefore = atIndex > 0 ? textBeforeCursor[atIndex - 1] : " ";
      if (/\s/.test(charBefore) || atIndex === 0) {
        const query = textBeforeCursor.slice(atIndex + 1);
        // Only trigger if query doesn't contain spaces (still typing the mention)
        if (!/\s/.test(query)) {
          setMentionQuery(query);
          setMentionStart(atIndex);
          return;
        }
      }
    }

    setMentionQuery(null);
    setMentionStart(-1);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (!onFilePaste) return;
    const file = Array.from(e.clipboardData.files).find(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    if (file) {
      e.preventDefault();
      const cursorPos = inputRef.current?.selectionStart ?? value.length;
      onFilePaste(file, cursorPos);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertMention(matches[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMentionQuery(null);
      setMentionStart(-1);
    }
  };

  return (
    <Box ref={anchorRef}>
      <TextField
        inputRef={inputRef}
        label={label}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        required={required}
        multiline
        minRows={minRows}
        maxRows={maxRows}
        fullWidth
        placeholder={placeholder}
      />
      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement="bottom-start"
        style={{ zIndex: 1301 }}
      >
        <Paper elevation={4} sx={{ maxHeight: 300, overflow: "auto", width: anchorRef.current?.clientWidth }}>
          <MenuList dense>
            {matches.map((profile, index) => (
              <MenuItem
                key={profile.pubkey}
                selected={index === selectedIndex}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur
                  insertMention(profile);
                }}
              >
                <Avatar
                  src={profile.picture}
                  sx={{ width: 28, height: 28, mr: 1.5 }}
                />
                <Box sx={{ overflow: "hidden" }}>
                  <Typography variant="body2" noWrap>
                    {profile.displayName}
                  </Typography>
                  {profile.nip05 && (
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {profile.nip05}
                    </Typography>
                  )}
                </Box>
              </MenuItem>
            ))}
          </MenuList>
        </Paper>
      </Popper>
    </Box>
  );
};

export default MentionTextArea;

/**
 * Extracts hex pubkeys from nostr:npub1... mentions in content.
 * Returns an array of ["p", hex_pubkey] tags.
 */
export function extractMentionTags(content: string): string[][] {
  const mentionRegex = /nostr:npub1[a-z0-9]+/g;
  const found = content.match(mentionRegex);
  if (!found) return [];

  const tags: string[][] = [];
  const seen = new Set<string>();

  for (const m of found) {
    const bech32 = m.replace("nostr:", "");
    try {
      const { data } = nip19.decode(bech32);
      const hex = data as string;
      if (!seen.has(hex)) {
        seen.add(hex);
        tags.push(["p", hex]);
      }
    } catch {
      // skip invalid npubs
    }
  }

  return tags;
}
