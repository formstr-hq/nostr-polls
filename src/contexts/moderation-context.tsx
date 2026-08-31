import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { Event, EventTemplate } from "nostr-tools";
import { dataLayer } from "@formstr/local-relay";
import { collectOnce } from "../dataLayer/collect";
import { signerManager } from "../singletons/Signer/SignerManager";
import { useUserContext } from "../hooks/useUserContext";
import { contentPolicy, WotScope } from "../utils/contentPolicy";

/**
 * Moderation: the NIP-51 mute list (kind 10000) + per-surface WoT-only toggles.
 *
 * The mute list is private-only: muted pubkeys live NIP-44-encrypted in the
 * event's `.content` as `[["p", <pk>], …]`, addressed to self. No public
 * `p` tags are written (nothing about who is muted leaks to relays), but on
 * read we also honor public `p` tags in case another client wrote them.
 */

interface ModerationContextInterface {
  mutedPubkeys: Set<string>;
  isMuted: (pubkey: string | undefined) => boolean;
  mutePubkey: (pubkey: string) => Promise<void>;
  unmutePubkey: (pubkey: string) => Promise<void>;
  isLoading: boolean;
  wotOnly: Record<WotScope, boolean>;
  setWotOnly: (scope: WotScope, on: boolean) => void;
}

export const ModerationContext = createContext<ModerationContextInterface | null>(null);

// NIP-51: kind 10000 is the mute list (10005 is public chats — do not use).
export const MUTE_LIST_KIND = 10000;

/**
 * Runtime NIP-44 capability check. ActiveSigner declares the methods as
 * always-present, but remote signers (NIP-07 / NIP-55) may not implement
 * them — trust the runtime shape, not the type.
 */
const hasNip44 = (
  signer: unknown
): signer is {
  getPublicKey: () => Promise<string>;
  nip44Encrypt: (peer: string, plaintext: string) => Promise<string>;
  nip44Decrypt: (peer: string, ciphertext: string) => Promise<string>;
} => {
  const s = signer as Record<string, unknown> | null | undefined;
  return (
    !!s &&
    typeof s.nip44Encrypt === "function" &&
    typeof s.nip44Decrypt === "function"
  );
};

/**
 * Decrypt the private section of a mute-list event: NIP-44 ciphertext
 * addressed to self, plaintext is `[["p", <pk>], …]`. Returns [] on absent
 * content, missing NIP-44 capability, wrong key, or malformed plaintext.
 */
const decryptPrivateMutes = async (
  event: Event,
  signer: NonNullable<Awaited<ReturnType<typeof signerManager.getSigner>>>
): Promise<string[]> => {
  if (!event.content || !hasNip44(signer)) return [];
  try {
    const self = await signer.getPublicKey();
    const plaintext = await signer.nip44Decrypt(self, event.content);
    const tags = JSON.parse(plaintext) as string[][];
    return Array.isArray(tags)
      ? tags.filter((t) => Array.isArray(t) && t[0] === "p" && typeof t[1] === "string" && t[1]).map((t) => t[1])
      : [];
  } catch {
    // Other-client event with a different private scheme, or decrypt failure:
    // public tags below still apply.
    return [];
  }
};

const publicPTags = (event: Event): string[] =>
  event.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);

export function ModerationProvider({ children }: { children: ReactNode }) {
  const { user } = useUserContext();
  const [, forceRender] = useState(0);

  const [isLoading, setIsLoading] = useState(false);
  const [muted, setMuted] = useState<Set<string>>(new Set());

  // Hydrate the policy singleton on account switch (device-local mutes +
  // toggles available to stable consumers immediately), then re-render.
  useEffect(() => {
    if (user?.pubkey) {
      contentPolicy.hydrate(user.pubkey);
      forceRender((v) => v + 1);
    } else {
      contentPolicy.reset();
      forceRender((v) => v + 1);
    }
  }, [user?.pubkey]);

  // Mirror user.webOfTrust into the policy singleton whenever it recomputes so
  // stable consumers (notification gate, filter builders) see WoT updates.
  useEffect(() => {
    contentPolicy.setWoT(user?.webOfTrust);
    forceRender((v) => v + 1);
  }, [user?.webOfTrust]);

  // Subscribe to singleton mutations for re-rendering (toggles, mute changes).
  useEffect(() => contentPolicy.subscribe(() => forceRender((v) => v + 1)), []);

  // ── load the user's kind-10000 mute list ──────────────────────────────────
  useEffect(() => {
    setMuted(new Set(contentPolicy.getMuted()));
    if (!user?.pubkey) return;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const signer = await signerManager.getSigner();
        // NIP-44 capability guard: without it we can neither decrypt our own
        // private entries nor publish. Fall back to cache + public tags.
        if (!hasNip44(signer)) {
          console.warn("[moderation] signer lacks NIP-44 support; mute list is device-local only");
          return;
        }
        const events = await collectOnce([
          { kinds: [MUTE_LIST_KIND], authors: [user.pubkey], limit: 1 },
        ]);
        if (cancelled) return;
        const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
        if (!latest) return;

        // Private entries first (authoritative for us), public tags merged in
        // for interop with other clients that publish public mute lists.
        const priv = await decryptPrivateMutes(latest, signer);
        if (cancelled) return;
        const pubkeys = new Set(priv);
        for (const pk of publicPTags(latest)) pubkeys.add(pk);
        setMuted(pubkeys);
        // Persist the device-local copy so filtering is active at next launch
        // before relays answer (mirrors the bookmarks durable-copy pattern).
        contentPolicy.setMuted(Array.from(pubkeys));
      } catch (e) {
        console.warn("[moderation] mute list load failed:", e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.pubkey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── publish an updated private mute list ──────────────────────────────────
  const publishMuteList = useCallback(
    async (pubkeys: string[]) => {
      const signer = await signerManager.getSigner();
      if (!hasNip44(signer)) {
        throw new Error("Signer does not support NIP-44 — cannot sync mute list across devices. Mutes stay device-local.");
      }
      const self = await signer.getPublicKey();
      if (!pubkeys.length) {
        // List emptied: write an empty encrypted payload (keeps the mute list
        // singular over relays; nobody learns anything from an empty list).
        const empty = await signer.signEvent({
          kind: MUTE_LIST_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: await signer.nip44Encrypt(self, JSON.stringify([])),
        } as EventTemplate);
        dataLayer.addEvent(empty);
        await dataLayer.publishEvent(empty);
        contentPolicy.setMuted([]);
        setMuted(new Set());
        return;
      }
      const content = await signer.nip44Encrypt(
        self,
        JSON.stringify(pubkeys.map((pk) => ["p", pk]))
      );
      const template: EventTemplate = {
        kind: MUTE_LIST_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content,
      };
      const signed = await signer.signEvent(template);
      dataLayer.addEvent(signed);
      await dataLayer.publishEvent(signed);
      contentPolicy.setMuted(pubkeys);
      setMuted(new Set(pubkeys));
    },
    []
  );

  // Fetch the freshest kind-10000 from relays (falling back to our device
  // copy), decrypt its private section, and return the merged pubkey set.
  // Mirrors fetchLatestBookmarks (#237): never build on top of nothing.
  const fetchLatestMutes = useCallback(async (): Promise<string[] | null> => {
    try {
      const events = await collectOnce([
        { kinds: [MUTE_LIST_KIND], authors: [user?.pubkey ?? ""], limit: 1 },
      ]);
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (latest) {
        const signer = await signerManager.getSigner();
        if (hasNip44(signer)) {
          const priv = await decryptPrivateMutes(latest, signer);
          return Array.from(new Set([...priv, ...publicPTags(latest)]));
        }
        // No NIP-44: still usable if the list is public-only (other clients').
        const pub = publicPTags(latest);
        if (pub.length || !latest.content) return pub;
      }
    } catch {
      // fall through to device cache
    }
    return contentPolicy.getMuted();
  }, [user?.pubkey]);

  const mergeAndPublish = useCallback(
    async (fn: (current: string[]) => string[]) => {
      // Read-modify-write against the freshest relay copy so a mute made on
      // another device (or a racing publish of ours) is merged, not clobbered.
      // Optimistic UI runs first either way; a publish failure leaves the
      // device-local copy as the source of truth until relays agree.
      const latest = await fetchLatestMutes();
      const current = latest ?? contentPolicy.getMuted();
      const next = Array.from(new Set(fn(current)));
      const changed =
        next.length !== current.length || next.some((pk) => !current.includes(pk));
      if (!changed) return;
      setMuted(new Set(next));
      contentPolicy.setMuted(next);
      try {
        await publishMuteList(next);
      } catch (e) {
        console.warn("[moderation] mute list publish failed:", e);
      }
    },
    [fetchLatestMutes, publishMuteList]
  );

  const mutePubkey = useCallback(
    (pubkey: string) => mergeAndPublish((cur) => [...cur, pubkey]),
    [mergeAndPublish]
  );

  const unmutePubkey = useCallback(
    (pubkey: string) => mergeAndPublish((cur) => cur.filter((pk) => pk !== pubkey)),
    [mergeAndPublish]
  );

  return (
    <ModerationContext.Provider
      value={{
        mutedPubkeys: muted,
        isMuted: (pk) => contentPolicy.isMuted(pk),
        mutePubkey,
        unmutePubkey,
        isLoading,
        wotOnly: contentPolicy.getWotOnlyToggles(),
        setWotOnly: contentPolicy.setWotOnly,
      }}
    >
      {children}
    </ModerationContext.Provider>
  );
}

export const useModeration = () => {
  const ctx = useContext(ModerationContext);
  if (!ctx) throw new Error("useModeration must be used within ModerationProvider");
  return ctx;
};

/**
 * Re-render hook for consumers that read moderation state from the
 * contentPolicy singleton (not from context value objects that only change on
 * mute mutations). Bumps on every policy mutation: mutes, WoT updates, toggles.
 */
export function useModerationVersion(): number {
  const [version, setVersion] = useState(contentPolicy.version);
  useEffect(() => contentPolicy.subscribe(() => setVersion(contentPolicy.version)), []);
  return version;
}