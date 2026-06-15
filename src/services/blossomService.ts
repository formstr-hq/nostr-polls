import { EventTemplate } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const DEFAULT_BLOSSOM_SERVERS = [
  "https://blossom.primal.net",
  "https://nostr.build"
];
export const BLOSSOM_SERVER_KEY = "pollerama:blossom-server";

export function getBlossomServer(): string[] {
  const custom = localStorage.getItem(BLOSSOM_SERVER_KEY);
  if (custom) return [custom, ...DEFAULT_BLOSSOM_SERVERS.filter(s => s !== custom)];
  return DEFAULT_BLOSSOM_SERVERS;
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  if (crypto?.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return bytesToHex(sha256(new Uint8Array(buffer)));
}

/**
 * Upload a file to a Blossom server (BUD-01).
 *
 * @param file     - The file to upload
 * @param servers  - Array of Blossom server base URLs
 * @param signer   - Signs the kind-24242 auth event
 * @returns        - The public URL of the uploaded blob
 */
export async function uploadToBlossom(
  file: File,
  servers: string | string[],
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
  const serverList = Array.isArray(servers) ? servers : [servers];
  let lastError: Error | null = null;

  for (const server of serverList) {
    const endpoint = server.replace(/\/$/, "") + "/upload";

    try {
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
        throw new Error(`Blossom upload failed on ${server} (${res.status}): ${body}`);
      }

      const data = await res.json();
      if (!data.url) throw new Error(`Blossom server ${server} returned no URL`);
      return data.url as string;
    } catch (err) {
      console.warn(`Failed to upload to Blossom server: ${server}`, err);
      lastError = err instanceof Error ? err : new Error(String(err));
      // Continue to next server
    }
  }

  throw lastError || new Error("All Blossom upload attempts failed.");
}
