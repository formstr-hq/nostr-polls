// Shared navigation config for the Color Block shell (block header, nav dock,
// desktop sidebar, Explore hub).

/** Feeds that live behind the Explore hub on mobile. */
export const EXPLORE_FEEDS = [
  "topics",
  "articles",
  "music",
  "movies",
  "follow-packs",
  "games",
  "profiles",
];

const FEED_TITLES: Record<string, string> = {
  home: "Home",
  polls: "Polls",
  notes: "Notes",
  topics: "Topics",
  articles: "Articles",
  music: "Music",
  movies: "Movies",
  "follow-packs": "Packs",
  bookmarks: "Saved",
  games: "Games",
  explore: "Explore",
  profiles: "People",
};

export interface RouteInfo {
  title: string;
  /** Top-level destinations show the account avatar; detail pages a back button. */
  topLevel: boolean;
  /** Poll contexts paint the block with the poll color (multi-color palettes). */
  poll: boolean;
  /** Pages that own the whole screen (composer, chat, games) hide the nav dock. */
  hideDock: boolean;
}

export function routeInfo(pathname: string): RouteInfo {
  const parts = pathname.split("/").filter(Boolean);
  const [root, sub, detail] = parts;
  if (!root) return { title: "Home", topLevel: true, poll: false, hideDock: false };
  if (root === "feeds") {
    const feed = sub || "polls";
    const isDetail = !!detail;
    if (feed === "follow-packs" && (detail === "new" || parts[3] === "edit")) {
      return { title: detail === "new" ? "New pack" : "Edit pack", topLevel: false, poll: false, hideDock: true };
    }
    return {
      title: FEED_TITLES[feed] ?? "Pollerama",
      topLevel: !isDetail || feed === "topics",
      poll: feed === "polls",
      hideDock: feed === "games" && isDetail,
    };
  }
  switch (root) {
    case "create":
      return { title: "New post", topLevel: false, poll: false, hideDock: true };
    case "respond":
    case "result":
      return { title: "Poll", topLevel: false, poll: true, hideDock: false };
    case "note":
      return { title: "Post", topLevel: false, poll: false, hideDock: false };
    case "p":
      return { title: "Private note", topLevel: false, poll: false, hideDock: false };
    case "profile":
      return { title: "Profile", topLevel: false, poll: false, hideDock: false };
    case "settings":
      return { title: "Settings", topLevel: false, poll: false, hideDock: false };
    case "drafts":
      return { title: "Drafts", topLevel: false, poll: false, hideDock: false };
    case "notifications":
      return { title: "Notifications", topLevel: true, poll: false, hideDock: false };
    case "messages":
      if (sub === "new") return { title: "New message", topLevel: false, poll: false, hideDock: false };
      if (sub) return { title: "Chat", topLevel: false, poll: false, hideDock: true };
      return { title: "Messages", topLevel: true, poll: false, hideDock: false };
    case "ratings":
      return { title: "Ratings", topLevel: false, poll: false, hideDock: false };
    default:
      return { title: "Pollerama", topLevel: true, poll: false, hideDock: false };
  }
}

/** Which nav-dock destination a path belongs to. */
export function dockKey(pathname: string): string | null {
  const [root, sub] = pathname.split("/").filter(Boolean);
  if (root !== "feeds") return null;
  const feed = sub || "polls";
  if (feed === "explore" || EXPLORE_FEEDS.includes(feed)) return "explore";
  if (feed === "bookmarks") return "saved";
  return feed;
}

/** Poll contexts paint the block with the poll color (multi-color palettes). */
export function isPollLocation(pathname: string, search = ""): boolean {
  if (/^\/(feeds\/polls|respond|result)(\/|$)/.test(pathname)) return true;
  return pathname === "/create" && new URLSearchParams(search).get("type") === "poll";
}

// ── Section colors ──────────────────────────────────────────────────────────
// With a multi-color palette every part of the app owns one of its six colors,
// so moving around the app moves through the palette. Indices 0–2 keep their
// roles (0 home/notes-writing, 1 polls, 2 highlights); 3–5 are extra hues.
const FEED_SECTION: Record<string, number> = {
  home: 0,
  polls: 1,
  notes: 3,
  explore: 4,
  topics: 5,
  articles: 2,
  music: 4,
  movies: 5,
  "follow-packs": 3,
  bookmarks: 2,
  games: 5,
  profiles: 3,
};

/** Palette index of the section a location belongs to. */
export function sectionIndex(pathname: string, search = ""): number {
  const [root, sub] = pathname.split("/").filter(Boolean);
  switch (root) {
    case "feeds":
      return FEED_SECTION[sub || "polls"] ?? 0;
    case "create":
      return new URLSearchParams(search).get("type") === "poll" ? 1 : 0;
    case "respond":
    case "result":
      return 1;
    case "note":
    case "p":
      return 3;
    case "profile":
      return 5;
    case "settings":
      return 4;
    case "notifications":
      return 2;
    case "messages":
      return 3;
    case "ratings":
      return 5;
    default:
      return 0;
  }
}

/** Palette index for each nav-dock destination (matches the sections above). */
export const DOCK_SECTION: Record<string, number> = {
  home: 0,
  polls: 1,
  notes: 3,
  explore: 4,
  saved: 2,
};

/** Palette index for each Explore tile. */
export const EXPLORE_SECTION: Record<string, number> = {
  topics: 5,
  articles: 2,
  music: 4,
  movies: 5,
  "follow-packs": 3,
  games: 1,
};
