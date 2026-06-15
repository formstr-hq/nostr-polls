import { EventTemplate } from "nostr-tools";

export const CLIENT_TAG_ENABLED_KEY = "pollerama:client-tag-enabled";
export const CLIENT_TAG_NAME = "Pollerama";

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

export const withClientTag = <T extends EventTemplate>(event: T): T => {
  if (!isClientTagEnabled()) return event;
  const tags = event.tags ?? [];
  if (tags.some((t) => t[0] === "client")) return event;
  return { ...event, tags: [...tags, ["client", CLIENT_TAG_NAME]] };
};
