import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PrepareNote } from "../../Notes/PrepareNote";
import { nip19 } from "nostr-tools";
import { isImageUrl } from "../../../utils/common";
import { useAppContext } from "../../../hooks/useAppContext";
import { DEFAULT_IMAGE_URL } from "../../../utils/constants";
import { Box, Button, IconButton, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import BoltIcon from "@mui/icons-material/Bolt";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { TranslationPopover } from "./../TranslationPopover";
import TranslateIcon from "@mui/icons-material/Translate";
import { isEmbeddableYouTubeUrl } from "../Utils";
import { YouTubePlayer } from "../Youtube";
import { InlineVideo } from "./InlineVideo";
import { Link } from "react-router-dom";
import { aiService } from "../../../services/ai-service";
import { useTranslationBatch } from "../../../contexts/translation-batch-context";
import {
  getCachedTranslation,
  setCachedTranslation,
} from "../../../utils/translation-cache";
import { LinkPreviewCard } from "./LinkPreviewCard";

interface TextWithImagesProps {
  content: string;
  tags?: string[][];
}

const urlRegex = /((http|https):\/\/[^\s]+)/g;
const hashtagRegex = /#(\w+)/g;
const isVideoUrl = (url: string) =>
  /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/.test(url);

// ---- Parsers ----

// Stateful lightbox wrapper — must be a proper component (not an inline call)
// so that useState is always called at a stable component boundary.
const ImageWithLightbox: React.FC<{ src: string; index: number }> = ({ src, index }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <img
        src={src}
        alt={`img-${index}`}
        onClick={() => setOpen(true)}
        style={{
          display: "block",
          width: "100%",
          height: "220px",
          objectFit: "cover",
          marginBottom: "0.5rem",
          cursor: "pointer",
          borderRadius: "6px",
        }}
      />
      {open && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1400,
            background: "rgba(0,0,0,0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <img
            src={src}
            alt={`img-${index}-full`}
            style={{
              maxWidth: "92vw",
              maxHeight: "88vh",
              objectFit: "contain",
              borderRadius: "8px",
            }}
          />
        </div>,
        document.body
      )}
    </>
  );
};

// ImageParser itself has no hooks — safe to call as a plain function inside render loops.
const ImageParser = ({ part, index }: { part: string; index: number }) => {
  return isImageUrl(part) ? <ImageWithLightbox src={part} index={index} /> : null;
};

const URLParser = ({ part, index, color }: { part: string; index: number; color: string }) => {
  const url = part.match(urlRegex)?.[0];
  return url ? (
    <a
      href={url}
      key={index}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color }}
    >
      {part}
    </a>
  ) : null;
};

const HashtagParser = ({ part, index, color }: { part: string; index: number; color: string }) => {
  return hashtagRegex.test(part) ? (
    <a
      key={index}
      href={`/feeds/topics/${part.replace("#", "")}`}
      style={{ color, textDecoration: "underline" }}
    >
      {part}
    </a>
  ) : null;
};

function decodeBolt11Amount(invoice: string): number | null {
  const lower = invoice.toLowerCase();
  const match = lower.match(/^ln(?:bc|tb|ts)(\d+)([munp]?)1/);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  const multiplier = match[2] || "";

  const satMultipliers: Record<string, number> = {
    "": 1e8,
    m: 1e5,
    u: 100,
    n: 0.1,
    p: 0.0001,
  };

  return num * (satMultipliers[multiplier] ?? 1e8);
}

const LightningInvoiceParser = ({
  part,
  index,
}: {
  part: string;
  index: number;
}) => {
  const lower = part.toLowerCase();
  const isBolt11 = lower.startsWith("lnbc") || lower.startsWith("lntb");
  const isLnurl = lower.startsWith("lnurl");
  if (!isBolt11 && !isLnurl) return null;

  const sats = isBolt11 ? decodeBolt11Amount(part) : null;
  const amountText =
    sats !== null
      ? sats >= 1
        ? `${Math.round(sats).toLocaleString()} sats`
        : `${Math.round(sats * 1000)} msats`
      : isLnurl
        ? "LNURL"
        : "Any amount";

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText(part);
  };

  return (
    <Box
      key={index}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        border: "1px solid #FAD13F",
        borderRadius: 1,
        px: 1.5,
        py: 0.5,
        my: 0.5,
      }}
    >
      <BoltIcon sx={{ color: "#FAD13F", fontSize: 18 }} />
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {amountText}
      </Typography>
      <IconButton size="small" onClick={handleCopy} title="Copy invoice">
        <ContentCopyIcon sx={{ fontSize: 14 }} />
      </IconButton>
      <Button
        size="small"
        variant="contained"
        component="a"
        href={`lightning:${part}`}
        sx={{
          minWidth: 0,
          px: 1.5,
          py: 0.25,
          fontSize: "0.75rem",
          textTransform: "none",
        }}
      >
        Pay
      </Button>
    </Box>
  );
};

const NIP19_BARE_PREFIXES = ["npub1", "note1", "nevent1", "nprofile1", "naddr1"];

const NostrParser = ({
  part,
  index,
  profiles,
  fetchUserProfileThrottled,
}: {
  part: string;
  index: number;
  profiles: Map<string, any> | undefined;
  fetchUserProfileThrottled: (pubkey: string) => void;
}) => {
  const isNostrUri = part.startsWith("nostr:");
  const isBareNip19 = NIP19_BARE_PREFIXES.some((p) => part.startsWith(p));
  if (!isNostrUri && !isBareNip19) return null;

  try {
    const raw = isNostrUri ? part.replace("nostr:", "") : part;
    // Strip trailing non-bech32 characters (e.g. 's possessive, punctuation)
    const bech32Match = raw.match(/^([a-zA-Z0-9]+)(.*)/);
    if (!bech32Match) return null;
    const encoded = bech32Match[1];
    const suffix = bech32Match[2]; // e.g. "'s", ".", ",", etc.

    const { type, data } = nip19.decode(encoded);
    if (type === "nevent") {
      return (
        <React.Fragment key={index}>
          <div style={{ marginTop: "0.5rem", zoom: 0.85 }}>
            <PrepareNote neventId={encoded} />
          </div>
          {suffix}
        </React.Fragment>
      );
    }
    if (type === "note") {
      const neventId = nip19.neventEncode({
        id: data,
        kind: 1,
      });
      return (
        <React.Fragment key={index}>
          <div style={{ marginTop: "0.5rem", zoom: 0.85 }}>
            <PrepareNote neventId={neventId} />
          </div>
          {suffix}
        </React.Fragment>
      );
    }

    if (type === "nprofile" || type === "npub") {
      const pubkey = type === "nprofile" ? data.pubkey : data;
      if (!profiles?.has(pubkey)) {
        fetchUserProfileThrottled(pubkey);
      }

      const profile = profiles?.get(pubkey);
      const name =
        profile?.name ||
        profile?.username ||
        profile?.nip05 ||
        pubkey.slice(0, 8) + "...";

      return (
        <React.Fragment key={index}>
          <Link
            to={`/profile/${encoded}`}
            style={{
              color: "#FAD13F",
              textDecoration: "underline",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
          >
            <img
              src={profile?.picture || DEFAULT_IMAGE_URL}
              width={18}
              height={18}
              style={{ borderRadius: "50%" }}
              alt=""
            />
            {name}
          </Link>
          {suffix}
        </React.Fragment>
      );
    }
  } catch (err) {
    console.warn("Nostr URI parsing failed:", err);
    return null;
  }
  return null;
};

const CustomEmojiParser = ({
  part,
  index,
  emojiMap,
}: {
  part: string;
  index: number;
  emojiMap: Map<string, string>;
}) => {
  if (emojiMap.size === 0) return null;

  const emojiRegex = /:([a-zA-Z0-9_]+):/g;
  const matches = Array.from(part.matchAll(emojiRegex));
  if (matches.length === 0) return null;

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;

  matches.forEach((match, i) => {
    const shortcode = match[1];
    const url = emojiMap.get(shortcode);

    if (url) {
      if (match.index! > lastIndex) {
        elements.push(part.slice(lastIndex, match.index));
      }
      elements.push(
        <img
          key={`${index}-emoji-${i}`}
          src={url}
          alt={`:${shortcode}:`}
          title={`:${shortcode}:`}
          style={{
            height: "1.2em",
            width: "auto",
            verticalAlign: "middle",
            display: "inline",
          }}
        />,
      );
      lastIndex = match.index! + match[0].length;
    }
  });

  if (elements.length === 0) return null;

  if (lastIndex < part.length) {
    elements.push(part.slice(lastIndex));
  }

  return <React.Fragment key={index}>{elements}</React.Fragment>;
};

const PlainTextRenderer = ({ part }: { part: string; key?: string }) => {
  return <React.Fragment>{part}</React.Fragment>;
};

// ---- Main Component ----

export const TextWithImages: React.FC<TextWithImagesProps> = ({
  content,
  tags,
}) => {
  const theme = useTheme();
  const emojiMap = useMemo(() => {
    const map = new Map<string, string>();
    if (tags) {
      for (const tag of tags) {
        if (tag[0] === "emoji" && tag[1] && tag[2]) {
          map.set(tag[1], tag[2]);
        }
      }
    }
    return map;
  }, [tags]);
  const [displayedText, setDisplayedText] = useState<string>(content ?? "");
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [shouldShowTranslate, setShouldShowTranslate] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const translateButtonRef = useRef<HTMLButtonElement | null>(null);

  const { aiSettings, fetchUserProfileThrottled, profiles } = useAppContext();
  const { detectLanguage } = useTranslationBatch();
  const browserLang = navigator.language.slice(0, 2).toLowerCase();

  // Language detection is synchronous (Unicode heuristic, no nRPC).
  // Only show translate button when AI is configured AND the post is
  // clearly written in a non-browser-language script.
  useEffect(() => {
    setDisplayedText(content ?? "");
    if (!aiSettings.model) {
      setShouldShowTranslate(false);
      return;
    }
    const lang = detectLanguage(content);
    setShouldShowTranslate(lang !== null && lang !== browserLang);
  }, [content, aiSettings.model, browserLang, detectLanguage]);

  const handleTranslate = async () => {
    setIsTranslating(true);
    try {
      // Check cache first
      const cached = getCachedTranslation(content, browserLang);
      if (cached) {
        setTranslatedText(cached);
        setIsTranslating(false);
        return;
      }

      // Use batched translateText method (detects language + translates in one call)
      const result = await aiService.translateText({
        model: aiSettings.model || "llama3",
        text: content,
        targetLang: browserLang,
      });

      if (result.success && result.data) {
        const translation = result.data.translation || "⚠️ Translation failed.";
        setTranslatedText(translation);

        // Cache the translation
        if (translation && !translation.startsWith("⚠️")) {
          setCachedTranslation(content, browserLang, translation);
        }
      } else {
        setTranslatedText(result.error || "⚠️ Translation failed.");
      }
    } catch (err) {
      console.error("Translation failed:", err);
      setTranslatedText("⚠️ Translation failed.");
    } finally {
      setIsTranslating(false);
    }
  };

  const renderContent = (text: string) => {
    if (!text) return null;
    const lines = text.split(/\n/);
    return lines.map((line, lineIndex) => {
      const parts = line.split(/(\s+)/);
      const previewUrls: string[] = [];

      const renderedParts = parts.map((part, index) => {
        const key = `${lineIndex}-${index}`;

        // YouTube and video use hooks internally — render as proper JSX components
        if (isEmbeddableYouTubeUrl(part)) {
          return <YouTubePlayer key={key} url={part} />;
        }
        if (isVideoUrl(part)) {
          return <InlineVideo key={key} src={part} />;
        }

        const parserResult =
          ImageParser({ part, index }) ||
          URLParser({ part, index, color: theme.palette.primary.main }) ||
          HashtagParser({ part, index, color: theme.palette.primary.main }) ||
          NostrParser({
            part,
            index,
            profiles,
            fetchUserProfileThrottled,
          }) ||
          LightningInvoiceParser({ part, index }) ||
          CustomEmojiParser({ part, index, emojiMap });

        // Collect plain URLs that aren't already embedded as media
        const urlMatch = part.match(urlRegex)?.[0];
        if (
          urlMatch &&
          !isImageUrl(urlMatch) &&
          !isVideoUrl(urlMatch) &&
          !isEmbeddableYouTubeUrl(urlMatch) &&
          !previewUrls.includes(urlMatch)
        ) {
          previewUrls.push(urlMatch);
        }

        return parserResult ?? <PlainTextRenderer part={part} key={key} />;
      });

      return (
        <div key={lineIndex} style={{ wordBreak: "break-word" }}>
          {renderedParts}
          {previewUrls.map((url) => (
            <LinkPreviewCard key={url} url={url} />
          ))}
          <br />
        </div>
      );
    });
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        minWidth: 0,
      }}
    >
      <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {renderContent(displayedText)}
      </div>
      {shouldShowTranslate && (
        <div>
          <Tooltip title="Translate">
            <span>
              <IconButton
                ref={translateButtonRef}
                onClick={handleTranslate}
                disabled={isTranslating}
                size="small"
                color="primary"
              >
                <TranslateIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </div>
      )}
      <TranslationPopover
        translatedText={translatedText}
        buttonRef={translateButtonRef.current}
        open={!!translatedText}
        onClose={() => setTranslatedText(null)}
      />
    </div>
  );
};
