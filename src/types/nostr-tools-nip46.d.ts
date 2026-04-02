// Declaration shim so TypeScript (moduleResolution: "node") can resolve the
// nostr-tools/nip46 subpath export that is defined in the package's exports field.
declare module "nostr-tools/nip46" {
  export * from "nostr-tools/lib/types/nip46";
}
