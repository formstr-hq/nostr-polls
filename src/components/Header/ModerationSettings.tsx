import {
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Slider,
  Switch,
  Typography,
} from "@mui/material";
import { useReports } from "../../hooks/useReports";
import { useModeration, useModerationVersion } from "../../contexts/moderation-context";
import { contentPolicy, WotScope, MAX_FILTER_AUTHORS } from "../../utils/contentPolicy";
import { nip19 } from "nostr-tools";

export function ModerationSettings() {
  const { wotReportThreshold, setWotReportThreshold } = useReports();
  const { mutedPubkeys, unmutePubkey, isLoading, wotOnly, setWotOnly } = useModeration();
  // Re-render on any policy change (WoT size affects toggle helper text, mute
  // changes the list). useModerationVersion subscribes inside an effect; the
  // version value itself is not used, only its change-firing.
  useModerationVersion();

  const wotSize = contentPolicy.getWoTSize();

  const toggles: { scope: WotScope; label: string; description: string }[] = [
    {
      scope: "notifsForeground",
      label: "Notifications — in-app",
      description:
        "Only show notifications in the in-app list from people in your Web of Trust.",
    },
    {
      scope: "notifsBackground",
      label: "Notifications — background push",
      description:
        "Only push OS notifications (while the app is closed or backgrounded) from people in your Web of Trust.",
    },
    {
      scope: "comments",
      label: "Comments",
      description:
        "Only fetch and show comments from people in your Web of Trust.",
    },
    {
      scope: "likes",
      label: "Likes",
      description:
        "Only fetch and show likes/reactions from people in your Web of Trust.",
    },
  ];

  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom>
        Content Filtering
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Automatically hide posts and profiles that have been reported by people
        in your Web of Trust. Set to 0 to disable.
      </Typography>

      <Box sx={{ px: 1, mt: 3 }}>
        <Typography gutterBottom>
          Hide after{" "}
          <strong>
            {wotReportThreshold === 0
              ? "disabled (show everything)"
              : `${wotReportThreshold} report${wotReportThreshold === 1 ? "" : "s"}`}
          </strong>{" "}
          from your WoT
        </Typography>
        <Slider
          value={wotReportThreshold}
          onChange={(_, val) => setWotReportThreshold(val as number)}
          min={0}
          max={10}
          step={1}
          marks
          valueLabelDisplay="auto"
          sx={{ maxWidth: 400 }}
        />
        <Typography variant="caption" color="text.secondary">
          Content reported by {wotReportThreshold || "any number of"} or more
          people you follow (or their follows) will be hidden. You can always
          choose to reveal hidden items individually.
        </Typography>
      </Box>

      <Divider sx={{ my: 4 }} />

      {/* ── WoT-only per-surface toggles ─────────────────────────────── */}
      <Typography variant="subtitle1" gutterBottom>
        Web of Trust only
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        When enabled, content outside your Web of Trust (people you follow and
        their follows) is not even fetched for that surface — filtered on the
        wire where possible, at ingest otherwise. Muted users are always
        filtered, regardless of these switches.
        {wotSize > MAX_FILTER_AUTHORS &&
          " Your Web of Trust is large, so notifications are filtered on arrival rather than at fetch time."}
        {wotSize === 0 &&
          " Still computing your Web of Trust — while it's empty these switches have no effect (nothing is filtered)."}
      </Typography>

      <Box sx={{ mt: 2 }}>
        {toggles.map(({ scope, label, description }) => (
          <Box key={scope} sx={{ mb: 2, maxWidth: 480 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={wotOnly[scope]}
                  onChange={(e) => setWotOnly(scope, e.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography variant="body1">{label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {description}
                  </Typography>
                </Box>
              }
              sx={{ alignItems: "flex-start", m: 0 }}
            />
          </Box>
        ))}
      </Box>

      <Divider sx={{ my: 4 }} />

      {/* ── Muted users ──────────────────────────────────────────────── */}
      <Typography variant="subtitle1" gutterBottom>
        Muted users
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Muted users never trigger notifications and are hidden from comments
        and likes. Your mute list is private — it is stored encrypted and only
        readable by you. Available on this device{mutedPubkeys.size > 0 ? ` (${mutedPubkeys.size})` : ""}.
      </Typography>

      {isLoading ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading mute list…
          </Typography>
        </Box>
      ) : mutedPubkeys.size === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Nobody is muted. Use the ⋯ menu on any note, comment, or poll to mute
          its author.
        </Typography>
      ) : (
        <List dense sx={{ maxWidth: 480 }}>
          {Array.from(mutedPubkeys).map((pk) => (
            <ListItem
              key={pk}
              secondaryAction={
                <Button size="small" onClick={() => unmutePubkey(pk)}>
                  Unmute
                </Button>
              }
            >
              <ListItemText
                primary={shortNpub(pk)}
                secondary={pk.slice(0, 16) + "…"}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}

function shortNpub(pk: string): string {
  try {
    return nip19.npubEncode(pk).slice(0, 16) + "…";
  } catch {
    return pk.slice(0, 12) + "…";
  }
}