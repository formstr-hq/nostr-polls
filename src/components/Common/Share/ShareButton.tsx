import React, { useState } from "react";
import { Tooltip } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { Event, nip19 } from "nostr-tools";
import { useUserContext } from "../../../hooks/useUserContext";
import { useNotification } from "../../../contexts/notification-context";
import { useDMContext } from "../../../hooks/useDMContext";
import ContactSearchDialog from "../../Messages/ContactSearchDialog";
import { authorWriteRelayHints } from "../../../nostr/relayHints";

interface ShareButtonProps {
  event: Event;
}

const ShareButton: React.FC<ShareButtonProps> = ({ event }) => {
  const { user } = useUserContext();
  const { showNotification } = useNotification();
  const { sendMessage } = useDMContext();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleClick = () => {
    if (!user) {
      showNotification("Log in to share posts via DM", "warning");
      return;
    }
    setDialogOpen(true);
  };

  const handleSelect = async (pubkeys: string[], message?: string) => {
    // Build a nostr: URI for the event so TextWithImages will render it. Include
    // the author's write-relay hints so the recipient — who likely doesn't follow
    // the author or subscribe to those relays — can resolve the note via the
    // worker's gossip pool (see PrepareNote). Empty when uncached; still valid.
    const relays = await authorWriteRelayHints(event.pubkey);
    const neventId = nip19.neventEncode({
      id: event.id,
      kind: event.kind,
      author: event.pubkey,
      relays,
    });
    const neventUri = `nostr:${neventId}`;
    const content = message ? `${message}\n\n${neventUri}` : neventUri;

    const results = await Promise.allSettled(
      pubkeys.map((pk) => sendMessage(pk, content))
    );
    const failed = results.filter((r) => r.status === "rejected").length;

    if (failed === 0) {
      showNotification(`Sent to ${pubkeys.length} ${pubkeys.length === 1 ? "person" : "people"}!`, "success");
    } else if (failed < pubkeys.length) {
      showNotification(`Sent, but ${failed} failed`, "warning");
    } else {
      showNotification("Failed to send DMs", "error");
      throw new Error("All sends failed");
    }
  };

  return (
    <>
      <div style={{ marginLeft: 20, marginTop: -5 }}>
        <Tooltip title="Share via DM" onClick={handleClick}>
          <span
            style={{
              cursor: "pointer",
              display: "flex",
              flexDirection: "row",
              padding: 2,
            }}
          >
            <SendIcon sx={{ fontSize: 20, transform: "rotate(-45deg)" }} />
          </span>
        </Tooltip>
      </div>
      {dialogOpen && (
        <ContactSearchDialog
          open
          onClose={() => setDialogOpen(false)}
          onSelect={handleSelect}
          title="Share with..."
          showMessageStep
        />
      )}
    </>
  );
};

export default ShareButton;
