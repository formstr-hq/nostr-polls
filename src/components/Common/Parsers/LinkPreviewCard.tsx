import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { CapacitorHttp } from "@capacitor/core";
import { isNative } from "../../../utils/platform";

interface LinkPreviewData {
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
}

// In-memory, session-scoped: previews are enrichment (the link still works
// without one), so they don't pay for localStorage quota. Capped LRU so a
// long browsing session can't grow unbounded.
const MEMORY_CACHE = new Map<string, LinkPreviewData | null>();
const MEMORY_CACHE_MAX = 500;

function getCachedPreview(url: string): LinkPreviewData | null | undefined {
  if (!MEMORY_CACHE.has(url)) return undefined;
  const data = MEMORY_CACHE.get(url);
  if (data === undefined) return undefined;
  // Refresh recency for LRU.
  MEMORY_CACHE.delete(url);
  MEMORY_CACHE.set(url, data);
  return data;
}

function setCachedPreview(url: string, data: LinkPreviewData | null) {
  if (MEMORY_CACHE.has(url)) MEMORY_CACHE.delete(url);
  MEMORY_CACHE.set(url, data);
  while (MEMORY_CACHE.size > MEMORY_CACHE_MAX) {
    const oldest = MEMORY_CACHE.keys().next().value;
    if (oldest === undefined) break;
    MEMORY_CACHE.delete(oldest);
  }
}

const FETCH_TIMEOUT_MS = 8000;

// Web: the pollerama-web gateway fetches the page server-side (browsers can't
// read cross-origin HTML). Override with REACT_APP_LINK_PREVIEW_ENDPOINT when
// the SPA is served from somewhere else (e.g. `npm start`).
const LINK_PREVIEW_ENDPOINT =
  process.env.REACT_APP_LINK_PREVIEW_ENDPOINT || "/api/link-preview";

function faviconFor(url: string): string {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
  } catch {
    return "";
  }
}

function hasContent(data: LinkPreviewData | null): data is LinkPreviewData {
  return !!data && !!(data.title || data.description || data.image);
}

// Native: CapacitorHttp makes the request outside the WebView, so CORS doesn't
// apply and the page can be parsed directly — no server round trip.
async function fetchNative(url: string): Promise<LinkPreviewData | null> {
  const res = await CapacitorHttp.get({
    url,
    headers: { Accept: "text/html,application/xhtml+xml" },
    responseType: "text",
    connectTimeout: FETCH_TIMEOUT_MS,
    readTimeout: FETCH_TIMEOUT_MS,
  });
  if (res.status < 200 || res.status >= 300 || typeof res.data !== "string") {
    return null;
  }
  const doc = new DOMParser().parseFromString(res.data, "text/html");
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
  let image = getMeta("og:image", "twitter:image");
  if (image) {
    try {
      image = new URL(image, res.url || url).toString();
    } catch {
      image = "";
    }
  }
  return {
    title: getMeta("og:title", "twitter:title") || doc.title.trim(),
    description: getMeta("og:description", "twitter:description", "description"),
    image,
    siteName: getMeta("og:site_name"),
    favicon: faviconFor(url),
  };
}

async function fetchViaGateway(url: string): Promise<LinkPreviewData | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${LINK_PREVIEW_ENDPOINT}?url=${encodeURIComponent(url)}`,
      { signal: controller.signal }
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== "object") return null;
    return {
      title: String(json.title || ""),
      description: String(json.description || ""),
      image: String(json.image || ""),
      siteName: String(json.siteName || ""),
      favicon: faviconFor(url),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  const cached = getCachedPreview(url);
  if (cached !== undefined) return cached;

  try {
    const data = isNative ? await fetchNative(url) : await fetchViaGateway(url);
    const value = hasContent(data) ? data : null;
    setCachedPreview(url, value);
    return value;
  } catch {
    setCachedPreview(url, null);
    return null;
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
        <Box sx={{ position: "relative", overflow: "hidden" }}>
          <Box
            component="img"
            src={preview.image}
            alt=""
            sx={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }}
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </Box>
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
