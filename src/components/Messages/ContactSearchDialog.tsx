import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Typography,
  InputAdornment,
  IconButton,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  AvatarGroup,
  DialogActions,
} from "@mui/material";
import { Virtuoso } from "react-virtuoso";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SendIcon from "@mui/icons-material/Send";
import { nip19 } from "nostr-tools";
import { useAppContext } from "../../hooks/useAppContext";
import { useUserContext } from "../../hooks/useUserContext";
import { useDMContext } from "../../hooks/useDMContext";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";

interface Contact {
  pubkey: string;
  name: string;
  nip05: string;
  picture: string;
}

interface ContactRowProps {
  contact: Contact;
  selected: boolean;
  onToggle: (contact: Contact) => void;
}

const ContactRow = React.memo<ContactRowProps>(({ contact, selected, onToggle }) => (
  <ListItem
    onClick={() => onToggle(contact)}
    sx={{
      cursor: "pointer",
      borderRadius: 1.5,
      mb: 0.5,
      "&:hover": { backgroundColor: "action.hover" },
    }}
  >
    <Checkbox
      checked={selected}
      size="small"
      sx={{ mr: 0.5, p: 0.5 }}
      tabIndex={-1}
      disableRipple
    />
    <ListItemAvatar>
      <Avatar src={contact.picture} sx={{ width: 36, height: 36 }} />
    </ListItemAvatar>
    <ListItemText
      primary={
        <Typography variant="body2" fontWeight={500}>
          {contact.name || contact.pubkey.slice(0, 12) + "..."}
        </Typography>
      }
      secondary={contact.nip05 || undefined}
    />
  </ListItem>
));

interface ContactSearchDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (pubkeys: string[], message?: string) => Promise<void>;
  title?: string;
  showMessageStep?: boolean;
}

const ContactSearchDialog: React.FC<ContactSearchDialogProps> = ({
  open,
  onClose,
  onSelect,
  title = "Send to...",
  showMessageStep = false,
}) => {
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { user } = useUserContext();
  const { conversations } = useDMContext();
  const [search, setSearch] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<Contact[]>([]);
  const [message, setMessage] = useState("");
  const [step, setStep] = useState<"pick" | "compose">("pick");
  const [sending, setSending] = useState(false);

  const followPubkeys = useMemo(() => {
    if (!user?.follows) return [];
    return user.follows.filter((pubkey) => pubkey !== user.pubkey);
  }, [user]);

  // Fetch profiles not already in the shared map, once when dialog opens
  useEffect(() => {
    if (!open) return;
    followPubkeys.forEach((pubkey) => {
      if (!profiles?.get(pubkey)) {
        fetchUserProfileThrottled(pubkey);
      }
    });
    // profiles intentionally omitted — we only want to run on open, not on every profile load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, followPubkeys, fetchUserProfileThrottled]);

  const contacts = useMemo(() => {
    return followPubkeys.map((pubkey) => {
      const profile = profiles?.get(pubkey);
      return {
        pubkey,
        name: profile?.display_name || profile?.name || "",
        nip05: profile?.nip05 || "",
        picture: profile?.picture || DEFAULT_IMAGE_URL,
      };
    });
  }, [followPubkeys, profiles]);

  // Try to decode the search input as an npub or hex pubkey
  const npubContact = useMemo((): Contact | null => {
    const trimmed = search.trim();
    if (!trimmed) return null;
    let pubkey: string | null = null;
    if (trimmed.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(trimmed);
        if (decoded.type === "npub") pubkey = decoded.data;
      } catch {
        return null;
      }
    } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      pubkey = trimmed.toLowerCase();
    }
    if (!pubkey) return null;
    // Don't show if already in follow list
    if (followPubkeys.includes(pubkey)) return null;
    const profile = profiles?.get(pubkey);
    return {
      pubkey,
      name: profile?.display_name || profile?.name || "",
      nip05: profile?.nip05 || "",
      picture: profile?.picture || DEFAULT_IMAGE_URL,
    };
  }, [search, followPubkeys, profiles]);

  // Fetch profile for npub contact
  useEffect(() => {
    if (npubContact && !profiles?.get(npubContact.pubkey)) {
      fetchUserProfileThrottled(npubContact.pubkey);
    }
  }, [npubContact, profiles, fetchUserProfileThrottled]);

  // Rank contacts by DM conversation message count
  const frequentPubkeys = useMemo(() => {
    if (!user) return new Map<string, number>();
    const counts = new Map<string, number>();
    Array.from(conversations.values()).forEach((conv) => {
      const other = conv.participants.find((p) => p !== user.pubkey);
      if (other) {
        counts.set(other, conv.messages.length);
      }
    });
    return counts;
  }, [conversations, user]);

  const frequentContacts = useMemo(() => {
    return contacts
      .filter((c) => (frequentPubkeys.get(c.pubkey) || 0) > 0)
      .sort((a, b) => (frequentPubkeys.get(b.pubkey) || 0) - (frequentPubkeys.get(a.pubkey) || 0))
      .slice(0, 8);
  }, [contacts, frequentPubkeys]);

  const filtered = useMemo(() => {
    let list = contacts;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.nip05.toLowerCase().includes(q) ||
          c.pubkey.startsWith(q)
      );
    }
    // Sort frequent contacts to the top
    const sorted = list.slice().sort((a, b) => {
      const aFreq = frequentPubkeys.get(a.pubkey) || 0;
      const bFreq = frequentPubkeys.get(b.pubkey) || 0;
      return bFreq - aFreq;
    });
    // Prepend npub contact if resolved and not already in list
    if (npubContact && !sorted.some((c) => c.pubkey === npubContact.pubkey)) {
      return [npubContact, ...sorted];
    }
    return sorted;
  }, [contacts, search, frequentPubkeys, npubContact]);

  const selectedSet = useMemo(
    () => new Set(selectedContacts.map((c) => c.pubkey)),
    [selectedContacts]
  );

  const toggleContact = useCallback((contact: Contact) => {
    setSelectedContacts((prev) =>
      prev.some((c) => c.pubkey === contact.pubkey)
        ? prev.filter((c) => c.pubkey !== contact.pubkey)
        : [...prev, contact]
    );
  }, []);

  const handleNext = () => {
    if (showMessageStep) {
      setStep("compose");
    } else {
      handleSend();
    }
  };

  const handleSend = async () => {
    if (selectedContacts.length === 0) return;
    setSending(true);
    try {
      const trimmed = message.trim();
      await onSelect(
        selectedContacts.map((c) => c.pubkey),
        trimmed || undefined
      );
      resetAndClose();
    } catch {
      setSending(false);
    }
  };

  const handleBack = () => {
    setStep("pick");
    setMessage("");
  };

  const resetAndClose = () => {
    setSearch("");
    setMessage("");
    setSelectedContacts([]);
    setStep("pick");
    setSending(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={sending ? undefined : resetAndClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{
        sx: { maxHeight: "70vh" },
        onWheel: (e: React.WheelEvent) => e.stopPropagation(),
        onTouchMove: (e: React.TouchEvent) => e.stopPropagation(),
      }}
    >
      {step === "compose" ? (
        <>
          <DialogTitle
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              pb: 1,
            }}
          >
            <IconButton
              onClick={handleBack}
              size="small"
              sx={{ mr: 1 }}
              disabled={sending}
            >
              <ArrowBackIcon />
            </IconButton>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                flex: 1,
                gap: 1,
                overflow: "hidden",
              }}
            >
              <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 28, height: 28, fontSize: 12 } }}>
                {selectedContacts.map((c) => (
                  <Avatar key={c.pubkey} src={c.picture} />
                ))}
              </AvatarGroup>
              <Typography variant="body2" fontWeight={500} noWrap>
                {selectedContacts.length === 1
                  ? selectedContacts[0].name || selectedContacts[0].pubkey.slice(0, 12) + "..."
                  : `${selectedContacts.length} people`}
              </Typography>
            </Box>
            <IconButton onClick={resetAndClose} size="small" disabled={sending}>
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent sx={{ px: 2, pt: 0 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Add a message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              autoFocus
              multiline
              maxRows={4}
              disabled={sending}
              sx={{ mb: 2 }}
            />
            <Button
              fullWidth
              variant="contained"
              onClick={handleSend}
              disabled={sending}
              endIcon={
                sending ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <SendIcon />
                )
              }
            >
              {sending ? "Sending..." : "Send"}
            </Button>
          </DialogContent>
        </>
      ) : (
        <>
          <DialogTitle
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              pb: 1,
            }}
          >
            {title}
            <IconButton onClick={resetAndClose} size="small">
              <CloseIcon />
            </IconButton>
          </DialogTitle>
          <DialogContent sx={{ px: 2, pt: 0 }}>
            {!search.trim() && frequentContacts.length > 0 && (
              <Box sx={{ mb: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                  Frequent
                </Typography>
                <Box sx={{ display: "flex", gap: 1.5, overflowX: "auto", pb: 0.5 }}>
                  {frequentContacts.map((c) => (
                    <Box
                      key={c.pubkey}
                      onClick={() => toggleContact(c)}
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        cursor: "pointer",
                        minWidth: 56,
                        position: "relative",
                      }}
                    >
                      <Box sx={{ position: "relative" }}>
                        <Avatar src={c.picture} sx={{ width: 40, height: 40 }} />
                        {selectedSet.has(c.pubkey) && (
                          <Box
                            sx={{
                              position: "absolute",
                              bottom: -2,
                              right: -2,
                              width: 16,
                              height: 16,
                              borderRadius: "50%",
                              bgcolor: "primary.main",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "primary.contrastText",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            ✓
                          </Box>
                        )}
                      </Box>
                      <Typography
                        variant="caption"
                        noWrap
                        sx={{ maxWidth: 56, textAlign: "center", mt: 0.25 }}
                      >
                        {c.name || c.pubkey.slice(0, 6)}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            <TextField
              fullWidth
              size="small"
              placeholder="Search by name, NIP-05, or npub..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              sx={{ mb: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />

            {filtered.length === 0 ? (
              <Box textAlign="center" py={3}>
                <Typography variant="body2" color="text.secondary">
                  {contacts.length === 0 && !search.trim()
                    ? "No contacts found. Follow people to see them here."
                    : "No matches. Try pasting an npub."}
                </Typography>
              </Box>
            ) : (
              <Virtuoso
                style={{ height: Math.min(filtered.length * 56, 350) }}
                data={filtered}
                itemContent={(_, contact) => (
                  <ContactRow
                    contact={contact}
                    selected={selectedSet.has(contact.pubkey)}
                    onToggle={toggleContact}
                  />
                )}
              />
            )}

          </DialogContent>
          {selectedContacts.length > 0 && (
            <DialogActions sx={{ px: 2, pb: 2 }}>
              <Button
                fullWidth
                variant="contained"
                onClick={handleNext}
              >
                {showMessageStep
                  ? `Next (${selectedContacts.length})`
                  : `Send (${selectedContacts.length})`}
              </Button>
            </DialogActions>
          )}
        </>
      )}
    </Dialog>
  );
};

export default ContactSearchDialog;
