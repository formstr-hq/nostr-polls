import { useTheme } from "@mui/material";
import { Event } from "nostr-tools";
import { Notes } from "../../../../components/Notes";
import RepeatIcon from "@mui/icons-material/Repeat";
import OverlappingAvatars from "../../../Common/OverlappingAvatars";

interface RepostsCardProps {
  note: Event;
  reposts: Event[];
}

const RepostsCard: React.FC<RepostsCardProps> = ({ note, reposts }) => {
  const theme = useTheme();

  // Filter reposts that belong to this note by checking tags for 'e' with note.id
  const matchingReposts = reposts.filter((r) => {
    const taggedNoteId = r.tags.find((tag) => tag[0] === "e")?.[1];
    return taggedNoteId === note.id;
  });

  // Dedupe by reposter so each person counts once
  const reposterIds = Array.from(new Set(matchingReposts.map((r) => r.pubkey)));

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      {reposterIds.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
            color: theme.palette.primary.main,
          }}
        >
          <RepeatIcon fontSize="small" />
          <OverlappingAvatars ids={reposterIds} />
        </div>
      )}
      <Notes event={note} />
    </div>
  );
};

export default RepostsCard;
