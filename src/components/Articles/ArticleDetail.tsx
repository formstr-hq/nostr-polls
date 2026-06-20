import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Event, nip19 } from "nostr-tools";
import ReactMarkdown from "react-markdown";
import { dataLayer } from "@formstr/local-relay";
import { useAppContext } from "../../hooks/useAppContext";
import { openProfileTab } from "../../nostr";
import { DEFAULT_IMAGE_URL } from "../../utils/constants";
import { calculateTimeAgo } from "../../utils/common";
import { FeedbackMenu } from "../FeedbackMenu";

const ArticleDetail: React.FC = () => {
  const { naddr } = useParams<{ naddr: string }>();
  const navigate = useNavigate();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const [article, setArticle] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!naddr) return;
    let decoded: ReturnType<typeof nip19.decode>;
    try {
      decoded = nip19.decode(naddr);
    } catch {
      setLoading(false);
      return;
    }
    if (decoded.type !== "naddr") { setLoading(false); return; }

    const { kind, pubkey, identifier } = decoded.data;
    const handle = dataLayer.observe(
      [{ kinds: [kind], authors: [pubkey], "#d": [identifier], limit: 1 }],
      {
        onEvent: (e) => {
          setArticle(e);
          setLoading(false);
          if (!profiles?.get(e.pubkey)) fetchUserProfileThrottled(e.pubkey);
        },
        // No onEose: local EOSE precedes the worker's upstream fetch, so the
        // event arrives via onEvent. The timeout below closes the interest.
      }
    );
    setTimeout(() => { setLoading(false); handle.unobserve(); }, 5000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naddr]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (!article) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" py={8} gap={2}>
        <Typography color="text.secondary">Article not found.</Typography>
        <Button onClick={() => navigate(-1)}>Go back</Button>
      </Box>
    );
  }

  const title = article.tags.find((t) => t[0] === "title")?.[1] || "Untitled Article";
  const image = article.tags.find((t) => t[0] === "image")?.[1];
  const publishedAt = article.tags.find((t) => t[0] === "published_at")?.[1];
  const identifier = article.tags.find((t) => t[0] === "d")?.[1] || "";
  const displayTime = publishedAt
    ? calculateTimeAgo(parseInt(publishedAt, 10))
    : calculateTimeAgo(article.created_at);

  const authorProfile = profiles?.get(article.pubkey);
  const authorName =
    authorProfile?.display_name ||
    authorProfile?.name ||
    (() => { const n = nip19.npubEncode(article.pubkey); return n.slice(0, 8) + "…"; })();

  const naddrEncoded = nip19.naddrEncode({ kind: 30023, pubkey: article.pubkey, identifier });

  return (
    <Box sx={{ height: "100%", overflowY: "auto" }}>
      {/* Top bar */}
      <Box sx={{ display: "flex", alignItems: "center", px: 1, pt: 1, gap: 1 }}>
        <IconButton size="small" onClick={() => navigate(-1)}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Box sx={{ flex: 1 }} />
        <IconButton
          size="small"
          component="a"
          href={`https://njump.me/${naddrEncoded}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open on njump.me"
          sx={{ color: "text.secondary" }}
        >
          <OpenInNewIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Cover image */}
      {image && (
        <Box
          component="img"
          src={image}
          alt={title}
          sx={{ width: "100%", height: 220, objectFit: "cover", display: "block" }}
        />
      )}

      {/* Article header */}
      <Box sx={{ px: 2.5, pt: 2, pb: 1, maxWidth: 720, mx: "auto" }}>
        <Typography variant="h4" fontWeight={700} sx={{ lineHeight: 1.25, mb: 1.5 }}>
          {title}
        </Typography>

        {/* Author row */}
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 0.75, cursor: "pointer", mb: 2, "&:hover .author-name": { textDecoration: "underline" } }}
          onClick={() => openProfileTab(nip19.npubEncode(article.pubkey), navigate)}
        >
          <Avatar src={authorProfile?.picture || DEFAULT_IMAGE_URL} sx={{ width: 28, height: 28 }} />
          <Typography className="author-name" variant="body2" fontWeight={500}>
            {authorName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            · {displayTime}
          </Typography>
        </Box>

        <Divider sx={{ mb: 2.5 }} />

        {/* Markdown content */}
        <Box
          sx={{
            "& h1": { fontSize: "1.75rem", fontWeight: 700, mt: 2.5, mb: 1, lineHeight: 1.3 },
            "& h2": { fontSize: "1.4rem",  fontWeight: 700, mt: 2.5, mb: 1, lineHeight: 1.3 },
            "& h3": { fontSize: "1.15rem", fontWeight: 600, mt: 2,   mb: 0.75 },
            "& h4, & h5, & h6": { fontWeight: 600, mt: 1.5, mb: 0.5 },
            "& p":  { mt: 0, mb: 1.5, lineHeight: 1.75 },
            "& ul, & ol": { pl: 3, mb: 1.5 },
            "& li": { mb: 0.5, lineHeight: 1.7 },
            "& blockquote": {
              borderLeft: "3px solid",
              borderColor: "primary.main",
              pl: 2,
              ml: 0,
              my: 1.5,
              color: "text.secondary",
              fontStyle: "italic",
            },
            "& code": {
              fontFamily: "monospace",
              fontSize: "0.88em",
              bgcolor: "action.hover",
              px: 0.5,
              borderRadius: 0.5,
            },
            "& pre": {
              bgcolor: "action.hover",
              borderRadius: 1,
              p: 1.5,
              overflowX: "auto",
              mb: 1.5,
              "& code": { bgcolor: "transparent", px: 0 },
            },
            "& img": { maxWidth: "100%", borderRadius: 1, my: 1 },
            "& a": { color: "primary.main" },
            "& hr": { my: 2.5, borderColor: "divider" },
          }}
        >
          <ReactMarkdown>{article.content}</ReactMarkdown>
        </Box>

        <Box sx={{ mt: 3 }}>
          <FeedbackMenu
            event={article}
            addressableRef={`30023:${article.pubkey}:${identifier}`}
            rootKind={30023}
          />
        </Box>
      </Box>
    </Box>
  );
};

export default ArticleDetail;
