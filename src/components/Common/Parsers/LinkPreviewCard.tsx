import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";

interface LinkPreviewData {
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
}

const MEMORY_CACHE = new Map<string, LinkPreviewData | null>();
const CORS_PROXY = "https://corsproxy.io/?url=";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedPreview(url: string): LinkPreviewData | null | undefined {
  if (MEMORY_CACHE.has(url)) return MEMORY_CACHE.get(url);
  try {
    const raw = localStorage.getItem(`link_preview:${url}`);
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL_MS) {
        MEMORY_CACHE.set(url, data);
        return data;
      }
    }
  } catch {}
  return undefined;
}

function setCachedPreview(url: string, data: LinkPreviewData | null) {
  MEMORY_CACHE.set(url, data);
  try {
    localStorage.setItem(
      `link_preview:${url}`,
      JSON.stringify({ data, ts: Date.now() })
    );
  } catch {}
}

async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  const cached = getCachedPreview(url);
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const proxyUrl = `${CORS_PROXY}${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { signal: controller.signal });
    if (!res.ok) {
      setCachedPreview(url, null);
      return null;
    }

    const html = await res.text();
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(html, "text/html");

    const getMeta = (...names: string[]): string => {
      for (const name of names) {
        const el =
          doc.querySelector(`meta[property="${name}"]`) ||
          doc.querySelector(`meta[name="${name}"]`);
        const val = el?.getAttribute("content")?.trim();
        if (val) return val;
      }
      return "";
    };

    const title =
      getMeta("og:title", "twitter:title") || doc.title.trim() || "";
    const description = getMeta(
      "og:description",
      "twitter:description",
      "description"
    );
    const image = getMeta("og:image", "twitter:image");
    const siteName = getMeta("og:site_name");

    let favicon = "";
    try {
      favicon = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
    } catch {}

    const data: LinkPreviewData = {
      title,
      description,
      image,
      siteName,
      favicon,
    };
    setCachedPreview(url, data);
    return data;
  } catch {
    setCachedPreview(url, null);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface LinkPreviewCardProps {
  url: string;
}

export const LinkPreviewCard: React.FC<LinkPreviewCardProps> = ({ url }) => {
  const [preview, setPreview] = useState<LinkPreviewData | null | "loading">(
    "loading"
  );

  useEffect(() => {
    let cancelled = false;
    fetchLinkPreview(url).then((data) => {
      if (!cancelled) setPreview(data);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (preview === "loading") return null;
  if (!preview) return null;
  if (!preview.title && !preview.description && !preview.image) return null;

  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {}

  return (
    <Box
      component="a"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      sx={{
        display: "block",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
        my: 1,
        textDecoration: "none",
        color: "inherit",
        cursor: "pointer",
        "&:hover": { opacity: 0.85 },
        maxWidth: "100%",
      }}
    >
      {preview.image && (
        <Box
          component="img"
          src={preview.image}
          alt=""
          sx={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }}
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <Box sx={{ p: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
          {preview.favicon && (
            <Box
              component="img"
              src={preview.favicon}
              alt=""
              sx={{ width: 16, height: 16, flexShrink: 0 }}
              onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          <Typography variant="caption" color="text.disabled">
            {preview.siteName || hostname}
          </Typography>
        </Box>
        {preview.title && (
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, mb: 0.25, lineHeight: 1.3 }}
          >
            {preview.title}
          </Typography>
        )}
        {preview.description && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {preview.description}
          </Typography>
        )}
      </Box>
    </Box>
  );
};
