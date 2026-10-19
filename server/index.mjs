// pollerama-web — a small gateway in front of the Pollerama SPA.
//
// Serves the build from ./build and, for share routes, injects per-event Open
// Graph / Twitter tags into index.html before returning it. Humans get the
// same SPA; the app is unchanged.
//
// Events are resolved directly from relays by ./resolve.mjs.

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePreview } from "./resolve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const config = {
  port: Number(process.env.PORT || 8080),
  staticDir: path.resolve(process.env.STATIC_DIR || path.join(here, "..", "build")),
  siteUrl: (process.env.SITE_URL || "http://localhost:8080").replace(/\/$/, ""),
  defaultImage: (process.env.DEFAULT_OG_IMAGE || "").trim(),
  siteName: process.env.SITE_NAME || "Pollerama",
  appTitle: process.env.APP_TITLE || "Pollerama",
  defaultDescription: process.env.DEFAULT_DESCRIPTION || "Polls On Nostr!",
};

const MIME = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Routes that get a preview. The captured value is a bech32 identifier
// (nevent / note / naddr) that the resolver understands.
const PREVIEW_ROUTES = [
  /^\/note\/([^/]+)\/?$/,
  /^\/feeds\/articles\/([^/]+)\/?$/,
  /^\/result\/([^/]+)\/?$/,
  /^\/respond\/([^/]+)\/?$/,
];

// Private (NIP-44) notes: never preview, never index.
const PRIVATE_ROUTES = [/^\/p\/([^/]+)\/?$/];

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]
  );

const truncate = (value, max) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, "").trimEnd()}…`;
};

const absoluteImage = (value) =>
  typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined;

let indexHtml = "";
let defaultImage = null;

const loadIndex = async () => {
  indexHtml = await readFile(path.join(config.staticDir, "index.html"), "utf8");
};

const loadAssets = async () => {
  try {
    defaultImage = await readFile(path.join(here, "assets", "og-default.png"));
  } catch {
    defaultImage = null;
    console.warn("og-default.png missing; image-less previews will have no image");
  }
};

const defaultImageUrl = () =>
  absoluteImage(config.defaultImage) || `${config.siteUrl}/og-default.png`;

const matchRoute = (routes, pathname) => {
  for (const route of routes) {
    const match = pathname.match(route);
    if (match) return decodeURIComponent(match[1]);
  }
  return undefined;
};

const fetchPreview = async (identifier) =>
  resolvePreview(identifier).catch(() => null);

const describe = (preview) => {
  const fallback = {
    title: config.appTitle,
    description: config.defaultDescription,
    image: defaultImageUrl(),
  };
  if (!preview) return fallback;

  const image = absoluteImage(preview.image) || defaultImageUrl();

  if (preview.kind === 1068 && preview.poll) {
    const options = (preview.poll.options || [])
      .map((option) => option.label)
      .filter(Boolean)
      .join(" · ");
    return {
      title: truncate(preview.poll.question || preview.title || "Poll", 100),
      description: options || "Vote on this poll on Pollerama",
      image,
    };
  }

  if (preview.kind === 30023) {
    return {
      title: truncate(preview.title || "Article", 100),
      description:
        truncate(preview.summary || preview.content, 200) ||
        config.defaultDescription,
      image,
    };
  }

  // Short text notes (kind 1) and anything else.
  const content = truncate(preview.content, 200);
  return {
    title: truncate(preview.title || content || "Note on Pollerama", 100),
    description: content || config.defaultDescription,
    image,
  };
};

const metaTags = ({ title, description, url, image, noindex }) => {
  const tags = [
    `<meta name="description" content="${escapeHtml(description)}"/>`,
    `<meta property="og:site_name" content="${escapeHtml(config.siteName)}"/>`,
    `<meta property="og:type" content="article"/>`,
    `<meta property="og:title" content="${escapeHtml(title)}"/>`,
    `<meta property="og:description" content="${escapeHtml(description)}"/>`,
    `<meta property="og:url" content="${escapeHtml(url)}"/>`,
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}"/>`,
    `<meta name="twitter:title" content="${escapeHtml(title)}"/>`,
    `<meta name="twitter:description" content="${escapeHtml(description)}"/>`,
    `<link rel="canonical" href="${escapeHtml(url)}"/>`,
  ];
  if (image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(image)}"/>`);
    tags.push(`<meta property="og:image:width" content="1200"/>`);
    tags.push(`<meta property="og:image:height" content="630"/>`);
    tags.push(`<meta property="og:image:alt" content="${escapeHtml(title)}"/>`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(image)}"/>`);
    tags.push(`<meta name="twitter:image:alt" content="${escapeHtml(title)}"/>`);
  }
  if (noindex) tags.push(`<meta name="robots" content="noindex,nofollow"/>`);
  return tags.join("");
};

const renderHtml = ({ title, description, url, image, noindex }) => {
  const tags = metaTags({ title, description, url, image, noindex });
  return indexHtml
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/i, "")
    .replace(/<\/head>/i, `${tags}</head>`);
};

const sendHtml = (req, res, html, cacheControl, extraHeaders = {}) => {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    ...extraHeaders,
  });
  res.end(req.method === "HEAD" ? undefined : html);
};

const serveStatic = async (req, res, pathname) => {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  const filePath = path.resolve(config.staticDir, `.${decoded}`);
  const withinRoot =
    filePath === config.staticDir ||
    filePath.startsWith(config.staticDir + path.sep);
  if (!withinRoot) return false;

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;

    const ext = path.extname(filePath).toLowerCase();
    const immutable = decoded.startsWith("/static/");
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": info.size,
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      createReadStream(filePath).pipe(res);
    }
    return true;
  } catch {
    return false;
  }
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", config.siteUrl);
  const { pathname } = url;

  if (pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" });
    res.end();
    return;
  }

  if (pathname === "/og-default.png") {
    if (!defaultImage) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": defaultImage.length,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : defaultImage);
    return;
  }

  if (matchRoute(PRIVATE_ROUTES, pathname)) {
    sendHtml(
      req,
      res,
      renderHtml({
        title: config.appTitle,
        description: config.defaultDescription,
        url: `${config.siteUrl}${pathname}`,
        image: defaultImageUrl(),
        noindex: true,
      }),
      "public, max-age=0, must-revalidate"
    );
    return;
  }

  const identifier = matchRoute(PREVIEW_ROUTES, pathname);
  if (identifier) {
    const preview = await fetchPreview(identifier);
    const hit = preview !== null;
    const { title, description, image } = describe(preview);
    sendHtml(
      req,
      res,
      renderHtml({
        title,
        description,
        image,
        url: `${config.siteUrl}${pathname}`,
      }),
      // Only cache real previews. A miss must not be cached, or an upstream
      // proxy could keep serving the generic head after the event resolves.
      hit
        ? "public, max-age=0, s-maxage=300, stale-while-revalidate=86400"
        : "no-store",
      { "x-preview": hit ? "hit" : "miss" }
    );
    return;
  }

  if (pathname !== "/" && (await serveStatic(req, res, pathname))) return;

  // Unknown paths with an extension are missing assets, not app routes.
  if (path.extname(pathname)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  sendHtml(req, res, indexHtml, "public, max-age=0, must-revalidate");
});

await loadAssets();
await loadIndex();
server.listen(config.port, () => {
  console.log(
    `pollerama-web on :${config.port} | static=${config.staticDir}`
  );
});
