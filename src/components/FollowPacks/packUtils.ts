import { Event, nip19 } from "nostr-tools";

export const KIND_FOLLOW_PACK = 39089;

export function getPackMeta(event: Event) {
  const identifier = event.tags.find((t) => t[0] === "d")?.[1] || "";
  const title =
    event.tags.find((t) => t[0] === "title")?.[1] || identifier || "Unnamed Pack";
  const description =
    event.tags.find((t) => t[0] === "description")?.[1] || event.content || "";
  const image = event.tags.find((t) => t[0] === "image")?.[1];
  const members = event.tags.filter((t) => t[0] === "p").map((t) => t[1]);
  return { identifier, title, description, image, members };
}

export function packNaddr(event: Event): string {
  return nip19.naddrEncode({
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: event.tags.find((t) => t[0] === "d")?.[1] || "",
  });
}

/** Accepts npub / nprofile / hex (with or without `nostr:`) and returns a hex pubkey. */
export function parsePubkey(input: string): string | null {
  const raw = input.trim().replace(/^nostr:/, "");
  if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase();
  try {
    const d = nip19.decode(raw);
    if (d.type === "npub") return d.data;
    if (d.type === "nprofile") return d.data.pubkey;
  } catch {
    // not a nip19 string
  }
  return null;
}
