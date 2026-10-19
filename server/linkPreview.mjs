// Fetches Open Graph metadata for arbitrary URLs on behalf of the web app.
//
// Browsers can't read cross-origin HTML, so the SPA asks this endpoint instead
// of a third-party CORS proxy. Because it fetches user-supplied URLs, every
// connection (including each redirect hop) is checked against private address
// ranges at DNS-lookup time, so it can't be used to reach internal services.

import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const TIMEOUT_MS = Number(process.env.LINK_PREVIEW_TIMEOUT_MS || 6000);
// Some sites (YouTube) put their meta tags ~800KB into the page.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const CACHE_TTL_MS = Number(process.env.LINK_PREVIEW_CACHE_MS || 6 * 3600 * 1000);
const CACHE_MAX = Number(process.env.LINK_PREVIEW_CACHE_MAX || 5000);
const USER_AGENT =
  "Mozilla/5.0 (compatible; PolleramaBot/1.0; +https://pollerama.fun)";

const cache = new Map();
const inFlight = new Map();

const blockedV4 = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blockedV4.addSubnet(addr, prefix, "ipv4");
}

const blockedV6 = new net.BlockList();
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  blockedV6.addSubnet(addr, prefix, "ipv6");
}

export const isPrivateAddress = (address) => {
  if (net.isIPv4(address)) return blockedV4.check(address, "ipv4");
  if (net.isIPv6(address)) {
    // IPv4-mapped (::ffff:a.b.c.d) — judge by the embedded v4 address.
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blockedV4.check(mapped[1], "ipv4");
    return blockedV6.check(address, "ipv6");
  }
  return true;
};

// Used as the socket's DNS lookup, so the address that is checked is the
// address that is connected to (no rebinding window).
const safeLookup = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const allowed = addresses.filter((a) => !isPrivateAddress(a.address));
    if (allowed.length === 0) {
      return callback(new Error(`blocked address for ${hostname}`));
    }
    if (options.all) return callback(null, allowed);
    callback(null, allowed[0].address, allowed[0].family);
  });
};

const parseTarget = (raw) => {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  // Literal IPs never go through lookup, so check them here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateAddress(host)) return null;
  return url;
};

const requestOnce = (url) =>
  new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-language": "en;q=0.9,*;q=0.5",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ redirect: res.headers.location });
          return;
        }
        const type = String(res.headers["content-type"] || "");
        if (status < 200 || status >= 300 || !/html/i.test(type)) {
          res.resume();
          resolve({ html: null });
          return;
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          chunks.push(chunk);
          // The head is all we need; stop once it's complete.
          if (size >= MAX_BYTES || chunk.includes("</head>")) res.destroy();
        });
        const finish = () =>
          resolve({ html: Buffer.concat(chunks).toString("utf8") });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", () => finish());
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });

const fetchHtml = async (startUrl) => {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const result = await requestOnce(url);
    if (result.redirect === undefined) return { html: result.html, url };
    const next = parseTarget(new URL(result.redirect, url).toString());
    if (!next) return { html: null, url };
    url = next;
  }
  return { html: null, url };
};

const decodeEntities = (value) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const safeCodePoint = (code) => {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
};

const attr = (tag, name) => {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
  );
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "") : "";
};

const clean = (value, max) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

export const parseMeta = (html, pageUrl) => {
  const head = html.split(/<\/head>/i)[0];
  const meta = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") || attr(tag, "name")).toLowerCase();
    const content = attr(tag, "content").trim();
    if (key && content && !(key in meta)) meta[key] = content;
  }
  const pick = (...keys) => keys.map((key) => meta[key]).find(Boolean) || "";

  const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = pick("og:title", "twitter:title") ||
    (titleTag ? decodeEntities(titleTag[1]) : "");

  let image = pick("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src");
  if (image) {
    try {
      image = new URL(image, pageUrl).toString();
      if (!/^https?:/i.test(image)) image = "";
    } catch {
      image = "";
    }
  }

  return {
    title: clean(title, 300),
    description: clean(pick("og:description", "twitter:description", "description"), 500),
    image,
    siteName: clean(pick("og:site_name", "application-name"), 100),
  };
};

const remember = (key, value) => {
  cache.delete(key);
  cache.set(key, { value, at: Date.now() });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
};

// Resolves to preview data, or null when the URL has nothing usable.
// Throws "invalid url" for URLs that will never be fetched.
export const getLinkPreview = async (raw) => {
  const target = parseTarget(raw);
  if (!target) throw new Error("invalid url");
  const key = target.toString();

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  if (inFlight.has(key)) return inFlight.get(key);
  const job = (async () => {
    try {
      const { html, url } = await fetchHtml(target);
      const data = html ? parseMeta(html, url) : null;
      const value =
        data && (data.title || data.description || data.image) ? data : null;
      remember(key, value);
      return value;
    } catch {
      // Network errors aren't cached, so a transient failure gets retried.
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
};
