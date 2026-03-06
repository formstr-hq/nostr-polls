import { EventTemplate } from "nostr-tools";

export const DEFAULT_BLOSSOM_SERVER = "https://blossom.primal.net";
export const BLOSSOM_SERVER_KEY = "pollerama:blossom-server";

export function getBlossomServer(): string {
  return localStorage.getItem(BLOSSOM_SERVER_KEY) || DEFAULT_BLOSSOM_SERVER;
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Upload a file to a Blossom server (BUD-01).
 *
 * @param file     - The file to upload
 * @param server   - Blossom server base URL (e.g. "https://blossom.primal.net")
 * @param signer   - Signs the kind-24242 auth event
 * @returns        - The public URL of the uploaded blob
 */
export async function uploadToBlossom(
  file: File,
  server: string,
  signer: (template: EventTemplate) => Promise<any>
): Promise<string> {
  const hash = await sha256Hex(file);
  const expiration = Math.floor(Date.now() / 1000) + 5 * 60; // 5 min

  const authEvent = await signer({
    kind: 24242,
    content: "Upload blob",
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["t", "upload"],
      ["x", hash],
      ["size", String(file.size)],
      ["expiration", String(expiration)],
    ],
  });

  const authToken = btoa(JSON.stringify(authEvent));
  const endpoint = server.replace(/\/$/, "") + "/upload";

  const res = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Nostr ${authToken}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Blossom upload failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  if (!data.url) throw new Error("Blossom server returned no URL");
  return data.url as string;
}
