import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/CloseRounded";
import AddIcon from "@mui/icons-material/AddRounded";
import SearchIcon from "@mui/icons-material/SearchRounded";
import PhotoCameraIcon from "@mui/icons-material/PhotoCameraRounded";
import DeleteIcon from "@mui/icons-material/DeleteOutlineRounded";
import { Event, nip19 } from "nostr-tools";
import { useListContext } from "../../hooks/useListContext";
import { useUserContext } from "../../hooks/useUserContext";
import { useAppContext } from "../../hooks/useAppContext";
import { useNotification } from "../../contexts/notification-context";
import { useHeaderAction } from "../../contexts/HeaderActionContext";
import { collectOnce } from "../../dataLayer/collect";
import { uploadToBlossom, getBlossomServer } from "../../services/blossomService";
import { signEvent } from "../../nostr";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { slabSx } from "../Common/SlabContext";
import { useDockClearance } from "../Shell/NavDock";
import { getPackMeta, KIND_FOLLOW_PACK, packNaddr, parsePubkey } from "./packUtils";
import { DeletePackDialog } from "./DeletePackDialog";

const sectionLabelSx = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "text.secondary",
  mb: 1,
} as const;

/**
 * Create or edit one of the user's follow packs (kind 39089).
 *   /feeds/follow-packs/new[?add=<npub>]  — new pack, optionally seeded with a person
 *   /feeds/follow-packs/:naddr/edit       — edit an existing pack the user owns
 * Save lives in the block header, like Post in the composer.
 */
const FollowPackEditor: React.FC = () => {
  const { naddr } = useParams<{ naddr?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, requestLogin } = useUserContext();
  const { lists, publishFollowPack, getFollowRecommendations, wotLastComputed } = useListContext();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { showNotification } = useNotification();
  const dockClearance = useDockClearance();

  const editing = !!naddr;
  const [base, setBase] = useState<Event | null>(null);
  const [loadingBase, setLoadingBase] = useState(editing);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Seed a new pack with ?add=<npub> (from "Add to pack" on a profile).
  useEffect(() => {
    if (editing) return;
    const add = new URLSearchParams(location.search).get("add");
    const pk = add ? parsePubkey(add) : null;
    if (pk) setMembers([pk]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the pack being edited: from the user's own lists first, else the store.
  useEffect(() => {
    if (!naddr) return;
    let decoded;
    try {
      decoded = nip19.decode(naddr);
    } catch {
      setLoadingBase(false);
      return;
    }
    if (decoded.type !== "naddr") {
      setLoadingBase(false);
      return;
    }
    const { pubkey, identifier } = decoded.data;
    const apply = (e: Event) => {
      const meta = getPackMeta(e);
      setBase(e);
      setTitle(meta.title);
      setDescription(meta.description);
      setImage(meta.image || "");
      setMembers(meta.members);
      setLoadingBase(false);
    };
    const cached = lists?.get(`${KIND_FOLLOW_PACK}:${pubkey}:${identifier}`);
    if (cached) return apply(cached);
    collectOnce([{ kinds: [KIND_FOLLOW_PACK], authors: [pubkey], "#d": [identifier], limit: 1 }]).then(
      (evts) => {
        const newest = evts.sort((a, b) => b.created_at - a.created_at)[0];
        if (newest) apply(newest);
        else setLoadingBase(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naddr]);

  // Profiles for the people shown (members + suggestions).
  const suggestions = useMemo(
    () => getFollowRecommendations(12).map((r) => r.pubkey),
    // Recompute once the web-of-trust worker has produced recommendations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.pubkey, wotLastComputed],
  );
  useEffect(() => {
    [...members, ...suggestions].forEach((pk) => {
      if (!profiles?.get(pk)) fetchUserProfileThrottled(pk);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, suggestions]);

  const nameOf = (pk: string) => {
    const p = profiles?.get(pk);
    return p?.display_name || p?.name || nip19.npubEncode(pk).slice(0, 12) + "…";
  };

  // Candidates to add: pasted key, else people you follow + suggestions matching the query.
  const pasted = parsePubkey(query);
  const candidates = useMemo(() => {
    const inPack = new Set(members);
    const q = query.trim().toLowerCase();
    const pool = q ? Array.from(new Set([...(user?.follows ?? []), ...suggestions])) : suggestions;
    return pool
      .filter((pk) => pk !== user?.pubkey && !inPack.has(pk))
      .filter((pk) => {
        if (!q) return true;
        const p = profiles?.get(pk);
        return [p?.display_name, p?.name, p?.nip05].some((v) => v?.toLowerCase().includes(q));
      })
      .slice(0, 8);
  }, [query, members, suggestions, user?.follows, user?.pubkey, profiles]);

  const addMember = (pk: string) => {
    setMembers((prev) => (prev.includes(pk) ? prev : [...prev, pk]));
    setQuery("");
  };
  const removeMember = (pk: string) => setMembers((prev) => prev.filter((m) => m !== pk));

  const handleUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      showNotification("Please pick an image under 5MB.", "error");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadToBlossom(file, getBlossomServer(), (t) => signEvent(t, user?.privateKey));
      setImage(url);
    } catch (e) {
      console.error("Cover upload failed:", e);
      showNotification("Couldn't upload the image.", "error");
    } finally {
      setUploading(false);
    }
  };

  const canSave = !!user && title.trim().length > 0 && members.length > 0 && !uploading;

  const save = async () => {
    if (!user) return requestLogin();
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const signed = await publishFollowPack({
        identifier: base ? getPackMeta(base).identifier : undefined,
        title,
        description,
        image,
        members,
        base: base ?? undefined,
      });
      showNotification(editing ? "Pack updated" : "Pack created", "success");
      navigate(`/feeds/follow-packs/${packNaddr(signed)}`, { replace: true });
    } catch (e) {
      console.error("Failed to publish pack:", e);
      showNotification("Couldn't save the pack. Try again.", "error");
      setSaving(false);
    }
  };

  const action = useMemo(
    () => ({
      label: editing ? "Save" : "Create",
      onClick: save,
      disabled: !canSave,
      submitting: saving,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing, canSave, saving, title, description, image, members, base],
  );
  useHeaderAction(action);

  if (!user) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" gap={2} py={8}>
        <Typography color="text.secondary">Log in to make follow packs.</Typography>
        <Button variant="contained" onClick={requestLogin}>Log in</Button>
      </Box>
    );
  }

  if (loadingBase) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (editing && (!base || base.pubkey !== user.pubkey)) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" gap={2} py={8}>
        <Typography color="text.secondary">
          {base ? "You can only edit packs you made." : "Pack not found."}
        </Typography>
        <Button onClick={() => navigate(-1)}>Go back</Button>
      </Box>
    );
  }

  const personRow = (pk: string, trailing: React.ReactNode, onClick?: () => void) => (
    <Box
      key={pk}
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 1,
        cursor: onClick ? "pointer" : "default",
        "& + &": { borderTop: "1px solid", borderColor: "divider" },
      }}
    >
      <Avatar src={profiles?.get(pk)?.picture || DEFAULT_IMAGE_URL} sx={{ width: 36, height: 36 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap fontWeight={700} fontSize={14.5}>
          {nameOf(pk)}
        </Typography>
        {profiles?.get(pk)?.nip05 && (
          <Typography noWrap variant="caption" color="text.secondary" component="div">
            {profiles.get(pk)!.nip05}
          </Typography>
        )}
      </Box>
      {trailing}
    </Box>
  );

  return (
    <Box sx={{ height: "100%", overflowY: "auto", ...dockClearance }}>
      <Box sx={{ maxWidth: 640, mx: "auto", pb: 3 }}>
        {/* Cover + name + description */}
        <Box sx={{ ...slabSx(false), p: 2 }}>
          <Box
            sx={{
              position: "relative",
              height: 140,
              borderRadius: "18px",
              bgcolor: "cb.inner",
              backgroundImage: image ? `url("${image}")` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              mb: 2,
            }}
          >
            <Button
              variant="contained"
              size="small"
              startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <PhotoCameraIcon />}
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {image ? "Change cover" : "Add cover"}
            </Button>
            {image && !uploading && (
              <IconButton
                size="small"
                aria-label="Remove cover"
                onClick={() => setImage("")}
                sx={{ position: "absolute", top: 8, right: 8, bgcolor: "cb.slab", "&:hover": { bgcolor: "cb.slab" } }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
          </Box>
          <TextField
            fullWidth
            label="Pack name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            inputProps={{ maxLength: 80 }}
            sx={{ mb: 2 }}
            autoFocus={!editing}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="What's this pack about? (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            inputProps={{ maxLength: 500 }}
          />
        </Box>

        {/* Add people */}
        <Box sx={{ ...slabSx(false), p: 2 }}>
          <Typography sx={sectionLabelSx}>Add people</Typography>
          <TextField
            fullWidth
            size="small"
            placeholder="Search people you follow, or paste an npub"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pasted) {
                e.preventDefault();
                addMember(pasted);
              }
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
          <Box sx={{ mt: 1 }}>
            {pasted && !members.includes(pasted)
              ? personRow(
                  pasted,
                  <IconButton aria-label="Add" onClick={() => addMember(pasted)}>
                    <AddIcon />
                  </IconButton>,
                  () => addMember(pasted),
                )
              : candidates.map((pk) =>
                  personRow(
                    pk,
                    <IconButton aria-label={`Add ${nameOf(pk)}`}>
                      <AddIcon />
                    </IconButton>,
                    () => addMember(pk),
                  ),
                )}
            {!pasted && candidates.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1.5 }}>
                {query ? "No matches among people you follow. Paste their npub instead." : "Search for people to add."}
              </Typography>
            )}
            {!query && candidates.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                Suggested from your network
              </Typography>
            )}
          </Box>
        </Box>

        {/* Members */}
        <Box sx={{ ...slabSx(false), p: 2 }}>
          <Typography sx={sectionLabelSx}>
            In this pack · {members.length}
          </Typography>
          {members.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              No one yet. Add at least one person.
            </Typography>
          ) : (
            members.map((pk) =>
              personRow(
                pk,
                <IconButton aria-label={`Remove ${nameOf(pk)}`} onClick={() => removeMember(pk)}>
                  <CloseIcon />
                </IconButton>,
              ),
            )
          )}
        </Box>

        {editing && base && (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
            <Button color="error" startIcon={<DeleteIcon />} onClick={() => setDeleteOpen(true)}>
              Delete pack
            </Button>
          </Box>
        )}
      </Box>
      {base && (
        <DeletePackDialog
          open={deleteOpen}
          pack={base}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => navigate("/feeds/follow-packs", { replace: true })}
        />
      )}
    </Box>
  );
};

export default FollowPackEditor;
