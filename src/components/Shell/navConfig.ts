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
