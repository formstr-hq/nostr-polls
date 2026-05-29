import { nip44, generateSecretKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// A ViewKey is a 32-byte symmetric key used directly as a NIP-44 conversation key.
// Per-post (M1): generated fresh on publish, embedded in the share URL fragment,
// never stored on the network or in localStorage.
export type ViewKey = Uint8Array;

export function generateViewKey(): ViewKey {
  return generateSecretKey();
}

export function viewKeyToHex(key: ViewKey): string {
  return bytesToHex(key);
}

export function viewKeyFromHex(hex: string): ViewKey {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) throw new Error("ViewKey must be 32 bytes");
  return bytes;
}

export function encryptPrivateNote(plaintext: string, key: ViewKey): string {
  return nip44.encrypt(plaintext, key);
}

export function decryptPrivateNote(ciphertext: string, key: ViewKey): string {
  return nip44.decrypt(ciphertext, key);
}
