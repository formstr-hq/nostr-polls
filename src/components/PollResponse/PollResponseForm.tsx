// PollResponseForm.tsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  FormControl,
  MenuItem,
  Menu,
  CardActions,
  CardHeader,
  Avatar,
  Typography,
  Alert,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import { Event } from "nostr-tools/lib/types/core";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { openProfileTab, signEvent } from "../../nostr";
import { useRelays } from "../../hooks/useRelays";
import { useListContext } from "../../hooks/useListContext";
import { calculateTimeAgo } from "../../utils/common";
import { FetchResults } from "./FetchResults";
import { SingleChoiceOptions } from "./SingleChoiceOptions";
import { MultipleChoiceOptions } from "./MultipleChoiceOptions";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { useAppContext } from "../../hooks/useAppContext";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { TextWithImages } from "../Common/Parsers/TextWithImages";
import { Filters } from "./Filter";
import { useUserContext } from "../../hooks/useUserContext";
import { ProofofWorkModal } from "./ProofofWorkModal";
import { getAppBaseUrl } from "../../utils/platform";
import { bytesToHex } from "@noble/hashes/utils";
import dayjs from "dayjs";
import { useMiningWorker } from "../../hooks/useMiningWorker";
import PollTimer from "./PollTimer";
import { FeedbackMenu } from "../FeedbackMenu";
import { useNotification } from "../../contexts/notification-context";
import { NOTIFICATION_MESSAGES } from "../../constants/notifications";
import { pool } from "../../singletons";

interface PollResponseFormProps {
  pollEvent: Event;
  userResponse?: Event;
}

const PollResponseForm: React.FC<PollResponseFormProps> = ({
  pollEvent,
  userResponse,
}) => {
  const [responses, setResponses] = useState<string[]>(
    userResponse?.tags.filter((t) => t[0] === "response")?.map((t) => t[1]) ||
      []
  );
  const [showResults, setShowResults] = useState<boolean>(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [filterPubkeys, setFilterPubkeys] = useState<string[]>([]);
  const [showPoWModal, setShowPoWModal] = useState<boolean>(false);
  const [showContactListWarning, setShowContactListWarning] = useState(false);
  const [pendingFollowKey, setPendingFollowKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const { showNotification } = useNotification();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const { user, setUser, requestLogin } = useUserContext();
  const { relays } = useRelays();
  const { fetchLatestContactList } = useListContext();
  const difficulty = Number(
    pollEvent.tags.filter((t) => t[0] === "PoW")?.[0]?.[1]
  );
  const pollExpiration = pollEvent.tags.filter(
    (t) => t[0] === "endsAt"
  )?.[0]?.[1];
  const now = dayjs();
  const { minePow, cancelMining, progress } = useMiningWorker(difficulty);
  const pollType =
    pollEvent.tags.find((t) => t[0] === "polltype")?.[1] || "singlechoice";

  const updateContactList = async (
    contactEvent: Event | null,
    pubkeyToAdd: string
  ) => {
    const existingTags = contactEvent?.tags || [];
    const pTags = existingTags.filter(([t]) => t === "p").map(([, pk]) => pk);
    if (pTags.includes(pubkeyToAdd)) return;
    const updatedTags = [...existingTags, ["p", pubkeyToAdd]];
    const newEvent = {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags: updatedTags,
      content: contactEvent?.content || "",
    };
    const signed = await signEvent(newEvent);
    pool.publish(relays, signed);
    setUser({ pubkey: signed.pubkey, ...user, follows: [...pTags, pubkeyToAdd] });
  };

  const addToContacts = async () => {
    if (!user) {
      requestLogin();
      return;
    }
    const pubkeyToAdd = pollEvent.pubkey;
    const contactEvent = await fetchLatestContactList();
    if (!contactEvent) {
      setPendingFollowKey(pubkeyToAdd);
      setShowContactListWarning(true);
      return;
    }
    await updateContactList(contactEvent, pubkeyToAdd);
  };

  const displaySubmit = () => {
    if (showResults) return false;
    if (pollExpiration && Number(pollExpiration) * 1000 < now.valueOf())
      return false;
    return true;
  };

  useEffect(() => {
    if (userResponse && responses.length === 0) {
      setResponses(
        userResponse.tags
          .filter((t) => t[0] === "response")
          ?.map((t) => t[1]) || []
      );
    }
    if (!profiles?.has(pollEvent.pubkey)) {
      fetchUserProfileThrottled(pollEvent.pubkey);
    }
  }, [pollEvent, profiles, fetchUserProfileThrottled, userResponse, responses]);

  const handleResponseChange = (optionValue: string) => {
    if (error) {
      setError("");
    }

    if (pollType === "singlechoice") {
      setResponses([optionValue]);
    } else if (pollType === "multiplechoice") {
      setResponses((prevResponses) =>
        prevResponses.includes(optionValue)
          ? prevResponses.filter((val) => val !== optionValue)
          : [...prevResponses, optionValue]
      );
    }
  };

  const handleSubmitResponse = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (responses.length === 0) {
      setError("Please select at least one option before submitting.");
      return;
    }

    let responseUser = user;
    if (!user) {
      showNotification(NOTIFICATION_MESSAGES.ANONYMOUS_LOGIN, "success");
      let secret = generateSecretKey();
      let pubkey = getPublicKey(secret);
      responseUser = { pubkey: pubkey, privateKey: bytesToHex(secret) };
      setUser(responseUser);
    }

    const responseEvent = {
      kind: 1018,
      content: "",
      tags: [
        ["e", pollEvent.id],
        ...responses.map((response) => ["response", response]),
      ],
      created_at: Math.floor(Date.now() / 1000),
      pubkey: responseUser!.pubkey,
    };
    let useEvent = responseEvent;
    if (difficulty) {
      setShowPoWModal(true);
      let minedEvent = await minePow(responseEvent).catch((e) => {
        setShowPoWModal(false);
        return;
      });
      if (!minedEvent) return;
      useEvent = minedEvent;
    }

    setShowPoWModal(false);
    const signedResponse = await signEvent(useEvent, responseUser!.privateKey);
    let eventRelays = pollEvent.tags
      .filter((t) => t[0] === "relay")
      .map((t) => t[1]);
    let publishRelays = eventRelays.length === 0 ? relays : eventRelays;
    pool.publish(publishRelays, signedResponse!);
    setShowResults(true);
  };

  const toggleResults = () => {
    setShowResults(!showResults);
  };

  const handleCopyNevent = async () => {
    const nevent = nip19.neventEncode({ id: pollEvent.id });
    try {
      await navigator.clipboard.writeText(nevent);
      showNotification(NOTIFICATION_MESSAGES.NEVENT_COPIED, "success");
    } catch (error) {
      console.error("Failed to copy nevent:", error);
      showNotification(NOTIFICATION_MESSAGES.COPY_FAILED, "error");
    }
    setAnchorEl(null);
    setIsDetailsOpen(false);
  };

  const handleCopyNpub = async () => {
    const npub = nip19.npubEncode(pollEvent.pubkey);
    try {
      await navigator.clipboard.writeText(npub);
      showNotification(NOTIFICATION_MESSAGES.NPUB_COPIED, "success");
    } catch (error) {
      console.error("Failed to copy npub:", error);
      showNotification(NOTIFICATION_MESSAGES.COPY_FAILED, "error");
    }
    setAnchorEl(null);
    setIsDetailsOpen(false);
  };

  const copyRawEvent = async () => {
    const rawEvent = JSON.stringify(pollEvent, null, 2);
    try {
      await navigator.clipboard.writeText(rawEvent);
      showNotification(NOTIFICATION_MESSAGES.EVENT_COPIED, "success");
    } catch (error) {
      console.error("Failed to copy event:", error);
      showNotification(NOTIFICATION_MESSAGES.EVENT_COPY_FAILED, "error");
    }
  };

  const copyPollUrl = async () => {
    const nevent = nip19.neventEncode({
      id: pollEvent.id,
      relays: pollEvent.tags.filter((t) => t[0] === "relay").map((t) => t[1]),
      kind: pollEvent.kind,
    });
    try {
      await navigator.clipboard.writeText(
        `${getAppBaseUrl()}/respond/${nevent}`
      );
      showNotification(NOTIFICATION_MESSAGES.POLL_URL_COPIED, "success");
    } catch (error) {
      console.error("Failed to copy event:", error);
      showNotification(NOTIFICATION_MESSAGES.POLL_URL_COPY_FAILED, "error");
    }
  };

  const label =
    pollEvent.tags.find((t) => t[0] === "label")?.[1] || pollEvent.content;
  const options = pollEvent.tags.filter((t) => t[0] === "option");
  return (
    <div>
      <Card variant="elevation" className="poll-response-form" sx={{ m: 1 }}>
        <form onSubmit={handleSubmitResponse}>
          <Card variant="outlined">
            <CardHeader
              avatar={
                <Avatar
                  src={profiles?.get(pollEvent.pubkey)?.picture || DEFAULT_IMAGE_URL}
                  onClick={() => openProfileTab(nip19.npubEncode(pollEvent.pubkey), navigate)}
                  sx={{ cursor: "pointer" }}
                />
              }
              title={
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography>
                    {profiles?.get(pollEvent.pubkey)?.name ||
                      profiles?.get(pollEvent.pubkey)?.username ||
                      profiles?.get(pollEvent.pubkey)?.nip05 ||
                      (() => {
                        const npub = nip19.npubEncode(pollEvent.pubkey);
                        return npub.slice(0, 6) + "…" + npub.slice(-4);
                      })()}
                  </Typography>
                  {user && !user.follows?.includes(pollEvent.pubkey) ? (
                    <Button onClick={addToContacts}>Follow</Button>
                  ) : null}
                </div>
              }
              subheader={calculateTimeAgo(pollEvent.created_at)}
              action={
                <IconButton
                  onClick={(e) => {
                    setIsDetailsOpen(!isDetailsOpen);
                    setAnchorEl(e.currentTarget);
                  }}
                >
                  <MoreVertIcon />
                </IconButton>
              }
              sx={{ m: 0, pl: 2, pt: 1 }}
            />
            <Menu
              open={isDetailsOpen}
              anchorEl={anchorEl}
              onClose={() => {
                setAnchorEl(null);
                setIsDetailsOpen(false);
              }}
            >
              <MenuItem onClick={handleCopyNevent}>Copy Event Id</MenuItem>
              <MenuItem onClick={copyPollUrl}>Copy URL</MenuItem>
              <MenuItem onClick={handleCopyNpub}>Copy Author npub</MenuItem>
              <MenuItem onClick={copyRawEvent}>Copy Raw Event</MenuItem>
            </Menu>
            <CardContent style={{ display: "flex", flexDirection: "column" }}>
              <Typography variant="body1" sx={{ mb: 1 }}>
                <TextWithImages content={label} tags={pollEvent.tags} />
              </Typography>
              <div style={{ display: "flex", flexDirection: "column", marginBottom: 8 }}>
                {difficulty > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    required difficulty: {difficulty} bits
                  </Typography>
                )}
                <PollTimer pollExpiration={pollExpiration} />
              </div>
              <FormControl component="fieldset">
                {!showResults ? (
                  pollType === "singlechoice" ? (
                    <SingleChoiceOptions
                      options={options as [string, string, string][]}
                      handleResponseChange={handleResponseChange}
                      response={responses}
                      tags={pollEvent.tags}
                    />
                  ) : pollType === "multiplechoice" ? (
                    <MultipleChoiceOptions
                      options={options as [string, string, string][]}
                      handleResponseChange={handleResponseChange}
                      response={responses}
                      tags={pollEvent.tags}
                    />
                  ) : null
                ) : (
                  <FetchResults
                    pollEvent={pollEvent}
                    filterPubkeys={filterPubkeys}
                    difficulty={difficulty}
                  />
                )}
              </FormControl>
              {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {error}
                </Alert>
              )}
              <CardActions>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "space-between",
                    width: "100%",
                  }}
                >
                  {displaySubmit() ? (
                    <Button type="submit" variant="contained" color="primary">
                      Submit Response
                    </Button>
                  ) : (
                    <div></div>
                  )}
                  <div style={{ display: "flex", flexDirection: "row" }}>
                    {showResults ? (
                      <Filters
                        onChange={(pubkeys: string[]) => {
                          setFilterPubkeys(pubkeys);
                        }}
                      />
                    ) : null}
                    <Button
                      onClick={toggleResults}
                      color="secondary"
                      variant="contained"
                    >
                      {showResults ? "hide results" : "results"}
                    </Button>
                  </div>
                </div>
              </CardActions>
            </CardContent>
          </Card>
        </form>
        <FeedbackMenu event={pollEvent} />
      </Card>
      <ProofofWorkModal
        show={showPoWModal}
        progress={progress}
        targetDifficulty={difficulty}
        onCancel={() => {
          cancelMining();
          setShowPoWModal(false);
        }}
      />
      <Dialog open={showContactListWarning} onClose={() => setShowContactListWarning(false)}>
        <DialogTitle>Warning</DialogTitle>
        <DialogContent>
          <Typography>
            We couldn't find your existing contact list. If you continue, your
            follow list will only contain this person.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowContactListWarning(false)}>Cancel</Button>
          <Button
            onClick={() => {
              if (pendingFollowKey) updateContactList(null, pendingFollowKey);
              setShowContactListWarning(false);
              setPendingFollowKey(null);
            }}
            color="primary"
            variant="contained"
          >
            Continue Anyway
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default PollResponseForm;
