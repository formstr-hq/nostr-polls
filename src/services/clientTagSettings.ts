import { EventTemplate } from "nostr-tools";

export const CLIENT_TAG_ENABLED_KEY = "pollerama:client-tag-enabled";
export const CLIENT_TAG_NAME_KEY = "pollerama:client-tag-name";

export const DEFAULT_CLIENT_TAG_NAME = "Pollerama";

// Preseeded client-tag names. "Pollerama" is now just the first preset rather
// than a dedicated setting; the rest are for fun. Users can also type their own.
export const CLIENT_TAG_PRESETS = [
  "Pollerama",
  "The best client in the world",
  "Nostr's finest",
  "Powered by vibes",
  "Definitely not a bot",
  "Sent from my zap",
];

export const isClientTagEnabled = (): boolean => {
  try {
    return localStorage.getItem(CLIENT_TAG_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
};

export const setClientTagEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(CLIENT_TAG_ENABLED_KEY, enabled ? "true" : "false");
  } catch {}
};

export const getClientTagName = (): string => {
  try {
    const stored = localStorage.getItem(CLIENT_TAG_NAME_KEY);
    return stored && stored.trim() ? stored : DEFAULT_CLIENT_TAG_NAME;
  } catch {
    return DEFAULT_CLIENT_TAG_NAME;
  }
};

export const setClientTagName = (name: string): void => {
  try {
    localStorage.setItem(CLIENT_TAG_NAME_KEY, name);
  } catch {}
};

export const withClientTag = <T extends EventTemplate>(event: T): T => {
  if (!isClientTagEnabled()) return event;
  const name = getClientTagName().trim();
  if (!name) return event;
  const tags = event.tags ?? [];
  if (tags.some((t) => t[0] === "client")) return event;
  return { ...event, tags: [...tags, ["client", name]] };
};
