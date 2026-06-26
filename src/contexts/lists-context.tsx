import {
  ReactNode,
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Event, EventTemplate, Filter } from "nostr-tools";
import { parseContacts, getATagFromEvent } from "../nostr";
import { useUserContext } from "../hooks/useUserContext";
import { useAppContext } from "../hooks/useAppContext";
import { User } from "./user-context";
import { dataLayer } from "@formstr/local-relay";
import { collectOnce } from "../dataLayer/collect";
import { useRelayRefresh } from "../dataLayer/hooks";
import { readCachedContacts, writeCachedContacts } from "../nostr/contactsCache";
import { signerManager } from "../singletons/Signer/SignerManager";
import {
  getWotCache,
  putWotCache,
  clearWotCacheTime,
  WotCacheRecord,
} from "../utils/wotCache";

// Legacy localStorage keys for the WoT cache. The cache now lives in IndexedDB
// (see ../utils/wotCache) because the serialized index + union can exceed the
// ~5MB localStorage quota; these are read once to migrate, then deleted.
const WOT_STORAGE_KEY_PREFIX = `pollerama:webOfTrust`;
const WOT_TTL = 5 * 24 * 60 * 60 * 1000; // 5 days in milliseconds

// The web-of-trust "network index" maps every reachable pubkey to the subset of
// the user's own follows that follow them. It powers the "followed by … you
// follow" row on profiles, the per-pubkey trust score, and follow suggestions.
// Persisted in a compact, index-referenced form (each source referenced by
// integer) to keep the cached blob small even on large follow graphs. The
// compact form is produced in `src/utils/wot-worker.ts`; only the inverse
// (rebuilding the in-memory Map) is needed on the main thread.
type SerializedNetworkIndex = { follows: string[]; edges: Record<string, number[]> };

// A follow recommendation: a 2nd-degree pubkey the user doesn't follow yet, with
// its trust score (how many of the user's follows follow them). Computed in the
// worker at commit and cached alongside the union/index.
export type WotRecommendation = { pubkey: string; score: number };

function deserializeNetworkIndex(json: string): Map<string, Set<string>> {
  const parsed = JSON.parse(json) as SerializedNetworkIndex;
  const map = new Map<string, Set<string>>();
  for (const target in parsed.edges) {
    const sources = parsed.edges[target]
      .map((i) => parsed.follows[i])
      .filter((pk): pk is string => Boolean(pk));
    map.set(target, new Set(sources));
  }
  return map;
}

// Read a pre-IndexedDB WoT cache out of localStorage (if any) and delete those
// keys to reclaim quota. Returns the migrated record, or null if there was
// nothing usable. Always removes the legacy keys — freeing the (often multi-MB)
// space is the whole point, even when the contents are stale or unparseable.
function migrateLegacyWotCache(pubkey: string): WotCacheRecord | null {
  const unionKey = `${WOT_STORAGE_KEY_PREFIX}${pubkey}`;
  const timeKey = `${unionKey}_time`;
  const indexKey = `${unionKey}_index`;
  const recsKey = `${unionKey}_recs`;

  let record: WotCacheRecord | null = null;
  try {
    const rawUnion = localStorage.getItem(unionKey);
    const rawTime = localStorage.getItem(timeKey);
    if (rawUnion && rawTime) {
      const union = JSON.parse(rawUnion);
      let recommendations: WotRecommendation[] = [];
      try {
        const rawRecs = localStorage.getItem(recsKey);
        recommendations = rawRecs ? JSON.parse(rawRecs) : [];
      } catch {
        recommendations = [];
      }
      if (Array.isArray(union)) {
        record = {
          pubkey,
          union,
          serializedIndex: localStorage.getItem(indexKey) ?? "",
          recommendations,
          time: Number(rawTime) || 0,
        };
      }
    }
  } catch {
    record = null;
  }

  try {
    localStorage.removeItem(unionKey);
    localStorage.removeItem(timeKey);
    localStorage.removeItem(indexKey);
    localStorage.removeItem(recsKey);
  } catch {
    // best-effort cleanup
  }

  return record;
}

interface ListContextInterface {
  lists: Map<string, Event> | undefined;
  selectedList: string | undefined;
  handleListSelected: (id: string | null) => void;
  fetchLatestContactList(): Promise<Event | null>;
  unfollowContact(pubkeyToRemove: string): Promise<void>;
  myTopics: Set<string> | undefined;
  addTopicToMyTopics: (topic: string) => Promise<void>;
  removeTopicFromMyTopics: (topic: string) => Promise<void>;
  bookmarkedPackKeys: Set<string>;
  bookmarkFollowPack: (packEvent: Event) => Promise<void>;
  unbookmarkFollowPack: (packEvent: Event) => Promise<void>;
  fetchAndHydratePacks: (adrefs: string[]) => void;
  // Which of the user's own follows follow `pubkey` (the "followed by" set).
  getNetworkFollowers: (pubkey: string) => string[];
  // Trust score for a pubkey: how many of the user's follows follow them (0 if
  // not in the network). Synchronous read off the in-memory network index.
  getTrustScore: (pubkey: string) => number;
  // Returns the given pubkeys sorted by descending trust score (stable for ties).
  // For ranking small batches — feed authors, search hits, reply/zap lists.
  rankByTrust: (pubkeys: string[]) => string[];
  // Top follow suggestions (2nd-degree pubkeys, strongest trust first), already
  // filtered against the user's current follows. Precomputed by the worker.
  getFollowRecommendations: (limit?: number) => WotRecommendation[];
  // Web-of-trust computation status, surfaced in the Network settings panel.
  isFetchingWoT: boolean;
  wotProfileCount: number;
  wotLastComputed: number | null; // ms epoch of the last successful compute
  recomputeWebOfTrust: () => void; // force a fresh fetch, bypassing the cache
}

export const ListContext = createContext<ListContextInterface | null>(null);

export function ListProvider({ children }: { children: ReactNode }) {
  const [lists, setLists] = useState<Map<string, Event> | undefined>();
  const [selectedList, setSelectedList] = useState<string | undefined>();
  const [bookmarkedPackKeys, setBookmarkedPackKeys] = useState<Set<string>>(new Set());
  const [bookmarks10003, setBookmarks10003] = useState<Event | null>(null);
  const [myTopics, setMyTopics] = useState<Set<string> | undefined>();
  const [myTopicsEvent, setMyTopicsEvent] = useState<
    Event | null | undefined
  >();
  const { user, setUser, requestLogin } = useUserContext();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  // Bumps once the worker hydrates its store (or restarts). The contact list
  // (kind 3) is fetched via a standing observe that EOSEs before hydration and,
  // because bulkLoad suppresses emits, never receives the hydrated list — leaving
  // `follows` empty so following/network feeds (home, notes) show nothing while
  // author-less feeds (polls, DMs, notifications) keep working. Re-running the
  // fetch effect on this signal re-observes against the populated store.
  const relayRefresh = useRelayRefresh();
  const wotInFlightRef = useRef(false);
  const wotAttemptedRef = useRef(false);
  // Dedicated worker that does the heavy kind-3 aggregation + serialization off
  // the UI thread. Lazily spawned per fetch and terminated on commit/teardown.
  const wotWorkerRef = useRef<Worker | null>(null);
  // Standing interest in the user's own contact list (kind 3). Kept open so the
  // worker's upstream fetch can stream it in after the local EOSE.
  const contactHandleRef = useRef<{ unobserve: () => void } | null>(null);
  // pubkey -> set of the user's follows who follow them. Lives in a ref (large,
  // mutated incrementally); `wotIndexVersion` bumps to notify consumers.
  const networkIndexRef = useRef<Map<string, Set<string>>>(new Map());
  const [wotIndexVersion, setWotIndexVersion] = useState(0);
  // WoT computation status, surfaced (non-blocking) in the Network settings
  // panel. The aggregation itself runs in a worker, so we no longer block the UI.
  const [isFetchingWoT, setIsFetchingWoT] = useState(false);
  const [wotProfileCount, setWotProfileCount] = useState(0);
  const [wotLastComputed, setWotLastComputed] = useState<number | null>(null);
  // Cached follow suggestions (worker-computed, persisted). Lives in a ref since
  // it's only read on demand via getFollowRecommendations, not rendered directly.
  const recommendationsRef = useRef<WotRecommendation[]>([]);
  const prevPubkeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const prev = prevPubkeyRef.current;
    const next = user?.pubkey;
    if (prev !== undefined && prev !== next) {
      setLists(undefined);
      setMyTopics(undefined);
      setMyTopicsEvent(undefined);
      setBookmarkedPackKeys(new Set());
      setBookmarks10003(null);
      contactHandleRef.current?.unobserve();
      contactHandleRef.current = null;
      wotWorkerRef.current?.terminate();
      wotWorkerRef.current = null;
      wotInFlightRef.current = false;
      wotAttemptedRef.current = false;
      networkIndexRef.current = new Map();
      recommendationsRef.current = [];
      setWotIndexVersion((v) => v + 1);
      setIsFetchingWoT(false);
      setWotProfileCount(0);
      setWotLastComputed(null);
    }
    prevPubkeyRef.current = next;
  }, [user?.pubkey]);

  // Tear down the WoT worker if the provider unmounts mid-computation.
  useEffect(() => {
    return () => {
      wotWorkerRef.current?.terminate();
      wotWorkerRef.current = null;
    };
  }, []);

  // Instant contact-list availability. The moment a user is present, hydrate
  // `follows` from the persistent cache — before, and independent of, the worker.
  // This is the load-bearing list for every following/network feed, so it must
  // never wait on worker hydration timing or IndexedDB surviving. We also re-seed
  // the worker store with the raw kind-3 so author-scoped reads + outbox routing
  // have it even if IndexedDB was evicted. The standing kind-3 observe still
  // revalidates with anything newer (stale-while-revalidate).
  useEffect(() => {
    const pubkey = user?.pubkey;
    if (!pubkey) return;
    const cached = readCachedContacts(pubkey);
    if (!cached) return;
    try {
      dataLayer.addEvent(cached.event);
    } catch {
      // best-effort: ingestion failing just means we rely on the relay copy
    }
    setUser((prev) => {
      if (!prev || prev.pubkey !== pubkey) return prev;
      if (prev.follows && prev.follows.length > 0) return prev; // network already won
      return { ...prev, follows: cached.follows } as User;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.pubkey]);

  const fetchLatestContactList = (): Promise<Event | null> => {
    if (!user) {
      requestLogin();
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      let filter = {
        kinds: [3],
        authors: [user.pubkey],
        limit: 1,
      };
      let latestEvent: Event | null = null;
      const handle = dataLayer.observe([filter], {
        onEvent(event: Event) {
          // Keep track of the most recent event
          if (!latestEvent || event.created_at > latestEvent.created_at) {
            latestEvent = event;
          }
        },
      });
      setTimeout(() => {
        handle.unobserve();
        resolve(latestEvent);
      }, 2000);
    });
  };

  const handleListEvent = (event: Event) => {
    setLists((prevMap) => {
      let a_tag = getATagFromEvent(event);
      const newMap = new Map(prevMap);
      newMap.set(a_tag, event);
      return newMap;
    });
  };

  const handleListSelected = (id: string | null) => {
    if (!id) {
      setSelectedList(undefined);
      return;
    }
    if (!lists?.has(id)) throw Error("List not found");
    setSelectedList(id);
  };

  const handleContactListEvent = async (event: Event) => {
    if (event.pubkey !== user?.pubkey) return;

    // Newness is decided against the persistent cache, not just the in-memory map,
    // so an in-memory reset (account switch, remount) can't make us re-accept a
    // stale list. Only act on a genuinely newer contact list.
    const cached = readCachedContacts(event.pubkey);
    if (cached && event.created_at <= cached.event.created_at) return;

    const follows = Array.from(await parseContacts(event));

    // Persist aggressively so following/network feeds always have the list on the
    // next launch — independent of the worker store / IndexedDB, the gap that made
    // the empty-feed bug recur.
    writeCachedContacts(event.pubkey, { event, follows });

    setUser((prevUser) =>
      prevUser && prevUser.pubkey === event.pubkey
        ? ({ ...prevUser, follows } as User)
        : prevUser,
    );

    const a_tag = `${event.kind}:${event.pubkey}`;
    setLists((prevMap) => {
      const newMap = new Map(prevMap);
      newMap.set(a_tag, event);
      return newMap;
    });
  };

  const fetchContacts = () => {
    if (!user || !user.pubkey) return;
    // Keep ONE standing interest open. Under the dataLayer contract the local
    // EOSE fires before the worker's upstream fetch returns, so the contact list
    // (kind 3) arrives later via onEvent — we must NOT unobserve on EOSE or we
    // tear the interest down before the worker delivers it.
    contactHandleRef.current?.unobserve();
    let contactListFilter = {
      kinds: [3],
      authors: [user.pubkey],
    };
    contactHandleRef.current = dataLayer.observe([contactListFilter], {
      onEvent: (event: Event) => {
        handleContactListEvent(event);
      },
    });
  };

  const fetchLists = () => {
    // Packs I created + packs I'm mentioned in. collectOnce keeps the interest
    // open across the worker's upstream fetch (local EOSE is not completion) and
    // resolves once the stream goes quiet.
    collectOnce([{ kinds: [39089], limit: 100, authors: [user!.pubkey] }]).then((evts) =>
      evts.forEach(handleListEvent),
    );
    collectOnce([{ kinds: [39089], limit: 100, "#p": [user!.pubkey] }]).then((evts) =>
      evts.forEach(handleListEvent),
    );
  };

  const fetchAndHydratePacks = (adrefs: string[]) => {
    adrefs.forEach((adref) => {
      const parts = adref.split(":");
      const pubkey = parts[1];
      const identifier = parts.slice(2).join(":");
      if (!pubkey) return;
      collectOnce([
        { kinds: [39089], authors: [pubkey], "#d": [identifier], limit: 1 },
      ]).then((evts) => evts.forEach(handleListEvent));
    });
  };

  const processBookmarksEvent = async (event: Event) => {
    let adrefs: string[] = [];

    // Decrypt private tags from content (NIP-44 encrypted to self)
    if (event.content) {
      try {
        const signer = await signerManager.getSigner();
        const pubkey = await signer.getPublicKey();
        const decrypted = await signer.nip44Decrypt!(pubkey, event.content);
        const privateTags: string[][] = JSON.parse(decrypted);
        if (Array.isArray(privateTags)) {
          adrefs.push(
            ...privateTags
              .filter((t) => Array.isArray(t) && t[0] === "a" && t[1]?.startsWith("39089:"))
              .map((t) => t[1])
          );
        }
      } catch {
        // Fall through to public tags
      }
    }

    // Also read any unencrypted public tags (backwards compat)
    const publicAdrefs = event.tags
      .filter((t) => t[0] === "a" && t[1]?.startsWith("39089:"))
      .map((t) => t[1]);
    const allAdrefs = Array.from(new Set([...adrefs, ...publicAdrefs]));

    setBookmarkedPackKeys(new Set(allAdrefs));
    fetchAndHydratePacks(allAdrefs);
  };

  const fetchBookmarks = () => {
    if (!user) return;
    collectOnce([{ kinds: [10003], authors: [user.pubkey], limit: 1 }]).then((evts) => {
      for (const event of evts) {
        setBookmarks10003((prev) => {
          if (!prev || event.created_at > prev.created_at) {
            processBookmarksEvent(event);
            return event;
          }
          return prev;
        });
      }
    });
  };

  const buildAndPublishBookmarks = async (adrefs: string[]): Promise<Event> => {
    const signer = await signerManager.getSigner();
    const pubkey = await signer.getPublicKey();
    const privateTags = adrefs.map((a) => ["a", a]);
    const encrypted = await signer.nip44Encrypt!(pubkey, JSON.stringify(privateTags));

    // Preserve all existing public tags except our own 39089 a-tags (which are now private).
    // This ensures we don't wipe pre-existing bookmarks (notes, URLs, hashtags, etc.)
    // added by other clients.
    const existingPublicTags = (bookmarks10003?.tags ?? []).filter(
      (t) => !(t[0] === "a" && t[1]?.startsWith("39089:"))
    );

    const template: EventTemplate = {
      kind: 10003,
      created_at: Math.floor(Date.now() / 1000),
      tags: existingPublicTags,
      content: encrypted,
    };
    const signed = await signer.signEvent(template);
    await dataLayer.publishEvent(signed);
    return signed;
  };

  const bookmarkFollowPack = async (packEvent: Event): Promise<void> => {
    const identifier = packEvent.tags.find((t) => t[0] === "d")?.[1] || "";
    const adref = `39089:${packEvent.pubkey}:${identifier}`;
    const current = Array.from(bookmarkedPackKeys);
    if (current.includes(adref)) return;
    const newAdrefs = [...current, adref];
    const signed = await buildAndPublishBookmarks(newAdrefs);
    setBookmarks10003(signed);
    setBookmarkedPackKeys(new Set(newAdrefs));
    handleListEvent(packEvent);
  };

  const unbookmarkFollowPack = async (packEvent: Event): Promise<void> => {
    const identifier = packEvent.tags.find((t) => t[0] === "d")?.[1] || "";
    const adref = `39089:${packEvent.pubkey}:${identifier}`;
    const newAdrefs = Array.from(bookmarkedPackKeys).filter((k) => k !== adref);
    const signed = await buildAndPublishBookmarks(newAdrefs);
    setBookmarks10003(signed);
    setBookmarkedPackKeys(new Set(newAdrefs));
  };

  const subscribeToContacts = () => {
    if (!user || !user.follows?.length) return;
    // Guard against concurrent subscriptions: webOfTrust isn't set on `user`
    // until EOSE, so the triggering effect could otherwise fire again mid-fetch.
    if (wotInFlightRef.current) return;
    wotAttemptedRef.current = true;
    // Claim the in-flight slot synchronously, before the async cache read below,
    // so the triggering effect can't re-enter during the await.
    wotInFlightRef.current = true;

    const pubkey = user.pubkey;
    const follows = user.follows;
    const seedFromUser = user.webOfTrust ? Array.from(user.webOfTrust) : [];

    // Background fetch: pull kind-3 lists from every follow and build both the
    // union set and the inverted "network index". The aggregation + serialization
    // run in a dedicated worker (see src/utils/wot-worker.ts) — doing it inline
    // used to loop every `p` tag of up to 500 lists on the UI thread and hang it.
    // The main thread here only forwards raw events and persists the result.
    const startFetch = (seedUnion: string[]) => {
      setWotProfileCount(0);
      setIsFetchingWoT(true); // Drives the non-blocking progress in Network settings.

      const filter: Filter = { kinds: [3], authors: follows, limit: 500 };

      const worker = new Worker(new URL("../utils/wot-worker", import.meta.url));
      wotWorkerRef.current = worker;
      // Seed the union with whatever we already have so a sparse fetch can only
      // ever add to the web of trust, never shrink it (e.g. a backfill that comes
      // back with fewer contact lists must not wipe a good cached union). `follows`
      // + `self` let the worker exclude already-followed/own pubkeys from the
      // follow-recommendation list it builds at commit.
      worker.postMessage({
        type: "init",
        seedUnion: Array.from(new Set<string>(seedUnion)),
        follows,
        self: pubkey,
      });

      // Under the dataLayer contract the local EOSE fires before the worker's
      // upstream fetch returns the contact lists, so we can't commit on EOSE
      // (that would persist an empty/stale union and tear down the fetch). Instead
      // we keep the interest open and ask the worker to commit once the stream
      // goes quiet, with a hard cap so the computation can never hang.
      let committed = false;
      let quietTimer: ReturnType<typeof setTimeout> | null = null;

      const commit = () => {
        if (committed) return;
        committed = true;
        if (quietTimer) clearTimeout(quietTimer);
        clearTimeout(hardTimer);
        handle.unobserve();
        // The worker replies with the finished union + serialized index; everything
        // heavy (Set/Map building, JSON stringify) already happened off-thread.
        worker.postMessage({ type: "commit" });
      };

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setWotProfileCount(msg.size);
          return;
        }
        if (msg.type !== "result") return;

        worker.terminate();
        if (wotWorkerRef.current === worker) wotWorkerRef.current = null;
        wotInFlightRef.current = false;
        setIsFetchingWoT(false);
        setWotProfileCount(msg.size);

        const union: string[] = msg.union;
        const recommendations: WotRecommendation[] = msg.recommendations ?? [];
        // Don't persist an empty result — leave any existing cache intact so
        // the next session retries instead of being stuck empty. The cache lives
        // in IndexedDB (see ../utils/wotCache); putWotCache swallows its own
        // errors, so the in-memory index below is always set regardless.
        if (union.length > 0) {
          const now = Date.now();
          void putWotCache({
            pubkey,
            union,
            serializedIndex: msg.serializedIndex,
            recommendations,
            time: now,
          });
          setWotLastComputed(now);
        }

        recommendationsRef.current = recommendations;
        networkIndexRef.current = deserializeNetworkIndex(msg.serializedIndex);
        setWotIndexVersion((v) => v + 1);
        setUser((prev) =>
          prev ? ({ ...prev, webOfTrust: new Set(union) } as User) : null,
        );
      };

      const handle = dataLayer.observe([filter], {
        onEvent: (event: Event) => {
          // Forward to the worker; it owns the union/index aggregation. We keep
          // main-thread work to a single postMessage per event.
          worker.postMessage({
            type: "event",
            pubkey: event.pubkey,
            tags: event.tags,
          });
          // Commit ~1.5s after the stream goes quiet.
          if (quietTimer) clearTimeout(quietTimer);
          quietTimer = setTimeout(commit, 1500);
        },
      });

      // Hard cap: commit no later than 10s even if events keep dribbling in.
      const hardTimer = setTimeout(commit, 10000);
    };

    // Read the cache (IndexedDB, async), migrating any legacy localStorage copy
    // on first run, then either hydrate from it or kick off the worker fetch.
    void (async () => {
      let cached = await getWotCache(pubkey);
      if (!cached) {
        const migrated = migrateLegacyWotCache(pubkey);
        if (migrated) {
          cached = migrated;
          void putWotCache(migrated);
        }
      }

      if (cached?.time) setWotLastComputed(cached.time);

      // Only trust a non-empty cache within TTL. An empty array is never a valid
      // result — treat it as a cache miss and re-fetch rather than leaving the
      // user with an empty web of trust for the next 5 days.
      const cacheValid =
        !!cached &&
        Array.isArray(cached.union) &&
        cached.union.length > 0 &&
        cached.time > 0 &&
        Date.now() - cached.time < WOT_TTL;

      if (cacheValid) {
        // The union set powers the "in your wider network" check — restore it now.
        setUser((prev: User | null) =>
          prev ? { ...prev, webOfTrust: new Set(cached!.union) } : null,
        );

        if (cached!.serializedIndex) {
          try {
            networkIndexRef.current = deserializeNetworkIndex(cached!.serializedIndex);
            // Restore cached follow suggestions if present. Absent for users whose
            // cache predates this feature — they'll populate on the next compute.
            recommendationsRef.current = cached!.recommendations ?? [];
            setWotIndexVersion((v) => v + 1);
            wotInFlightRef.current = false;
            return; // Fully hydrated from cache — no network needed.
          } catch {
            // Corrupt index — fall through and rebuild it.
          }
        }
        // Existing flat-list user (cached union but no index): silently backfill
        // the index below. The union is already live, so this isn't user-visible.
      }

      startFetch(cached?.union ?? seedFromUser);
    })();
  };

  // Manual refresh from the Network settings panel. Busts the cache timestamp so
  // the validity check misses, then re-runs the (worker-backed) fetch. The union
  // is seeded from the existing cache, so a recompute can only grow it.
  const recomputeWebOfTrust = () => {
    if (!user?.pubkey || wotInFlightRef.current) return;
    void clearWotCacheTime(user.pubkey);
    wotAttemptedRef.current = false;
    subscribeToContacts();
  };

  const getNetworkFollowers = useCallback(
    (pk: string): string[] => {
      const sources = networkIndexRef.current.get(pk);
      return sources ? Array.from(sources) : [];
    },
    // Recreated whenever the index changes so consumers depending on this
    // function (in effect/memo deps) recompute once it's ready.
    [wotIndexVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const getTrustScore = useCallback(
    (pk: string): number => networkIndexRef.current.get(pk)?.size ?? 0,
    [wotIndexVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const rankByTrust = useCallback(
    (pubkeys: string[]): string[] => {
      const idx = networkIndexRef.current;
      // Stable sort by descending score; ties keep their original order.
      return pubkeys
        .map((pk, i) => ({ pk, i, score: idx.get(pk)?.size ?? 0 }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map((e) => e.pk);
    },
    [wotIndexVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const getFollowRecommendations = useCallback(
    (limit?: number): WotRecommendation[] => {
      // Re-filter against the current follow list so anyone followed since the
      // last compute drops off without waiting for a recompute. (Already-sorted.)
      const followed = new Set(user?.follows ?? []);
      const recs = recommendationsRef.current.filter((r) => !followed.has(r.pubkey));
      return limit != null ? recs.slice(0, limit) : recs;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wotIndexVersion, user?.follows],
  );

  const fetchMyTopics = async () => {
    if (!user) return;

    const signer = signerManager.getSigner().catch(() => null);
    if (!signer) return;

    const evts = await collectOnce([
      { kinds: [10015], authors: [user.pubkey], limit: 1 },
    ]);
    if (evts.length === 0) {
      if (!myTopicsEvent) setMyTopicsEvent(null);
      return;
    }
    for (const event of evts) {
      if (myTopicsEvent && event.created_at <= myTopicsEvent.created_at) continue;
      setMyTopicsEvent(event);
      processMyTopicsFromEvent(event);
    }
  };

  const processMyTopicsFromEvent = async (event: Event) => {
    const topics = new Set<string>();

    // Parse "t" tags from the event
    event.tags.forEach((tag) => {
      if (tag[0] === "t" && tag[1]) {
        topics.add(tag[1]);
      }
    });
    // Decrypt and parse content if available
    if (event.content) {
      try {
        const signer = await signerManager.getSigner();
        if (!signer) return;
        const decrypted = await signer.nip44Decrypt!(
          user!.pubkey,
          event.content,
        );
        const contentTags = JSON.parse(decrypted);
        if (Array.isArray(contentTags)) {
          contentTags.forEach((tag: any) => {
            if (Array.isArray(tag) && tag[0] === "t" && tag[1]) {
              topics.add(tag[1]);
            }
          });
        }
      } catch (e) {
        console.error("Failed to decrypt topics content:", e);
      }
    }

    setMyTopics(topics);
  };

  useEffect(() => {
    if (!user) return;
    if (user) {
      if (!lists) fetchLists();
      if (!user.follows || user.follows.length === 0) fetchContacts();
      if (!wotAttemptedRef.current && (!user.webOfTrust || user.webOfTrust.size === 0))
        subscribeToContacts();
      if (!myTopics) fetchMyTopics();
      if (bookmarkedPackKeys.size === 0 && !bookmarks10003) fetchBookmarks();
    }
    // `relayRefresh` re-runs these one-shot fetches after the worker hydrates, so
    // a kind-3/list/bookmark read that EOSE'd on a cold store retries against the
    // populated one — the guards above keep it to only what's still missing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, myTopics, user, relayRefresh]);

  // Warm profile cache with followed pubkeys
  useEffect(() => {
    if (!user?.follows?.length) return;
    for (const pubkey of user.follows) {
      if (!profiles.has(pubkey)) {
        fetchUserProfileThrottled(pubkey);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.follows]);

  // Read the latest kind-10015 (interests). collectOnce keeps the interest open
  // across the worker's upstream fetch — committing on the instant local EOSE
  // would read an empty list and wipe the user's existing topics on write.
  const fetchLatestInterests = async (pubkey: string): Promise<Event | null> => {
    const evts = await collectOnce([
      { kinds: [10015], authors: [pubkey], limit: 1 },
    ]);
    return evts.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
  };

  const addTopicToMyTopics = async (topic: string): Promise<void> => {
    const signer = await signerManager.getSigner();
    if (!signer) throw Error("No signer available");

    const pubkey = await signer.getPublicKey();
    const existingEvent = await fetchLatestInterests(pubkey);
    const tags = existingEvent?.tags ?? [];

    // Already present — nothing to do.
    if (tags.some((tag) => tag[0] === "t" && tag[1] === topic)) return;

    const eventTemplate: EventTemplate = {
      kind: 10015,
      created_at: Math.floor(Date.now() / 1000),
      tags: [...tags, ["t", topic]],
      content: existingEvent?.content ?? "",
    };

    const signed = await signer.signEvent(eventTemplate);
    await dataLayer.publishEvent(signed);
    processMyTopicsFromEvent(signed);
    fetchMyTopics();
  };

  const removeTopicFromMyTopics = async (topic: string): Promise<void> => {
    const signer = await signerManager.getSigner();
    if (!signer) throw Error("No signer available");

    const pubkey = await signer.getPublicKey();
    const existingEvent = await fetchLatestInterests(pubkey);
    const oldTags = existingEvent?.tags ?? [];
    const newTags = oldTags.filter(
      (tag) => !(tag[0] === "t" && tag[1] === topic),
    );

    // Nothing changed — topic wasn't there.
    if (newTags.length === oldTags.length) return;

    const eventTemplate: EventTemplate = {
      kind: 10015,
      created_at: Math.floor(Date.now() / 1000),
      tags: newTags,
      content: existingEvent?.content ?? "",
    };

    const signed = await signer.signEvent(eventTemplate);
    await dataLayer.publishEvent(signed);
    processMyTopicsFromEvent(signed);
    fetchMyTopics();
  };

  const unfollowContact = async (pubkeyToRemove: string): Promise<void> => {
    if (!user) return;
    const contactEvent = await fetchLatestContactList();
    const existingTags = contactEvent?.tags || [];
    const updatedTags = existingTags.filter(([t, pk]) => !(t === "p" && pk === pubkeyToRemove));
    const newEvent: EventTemplate = {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags: updatedTags,
      content: contactEvent?.content || "",
    };
    const signer = await signerManager.getSigner();
    const signed = await signer.signEvent(newEvent);
    await dataLayer.publishEvent(signed);
    setUser((prev) => {
      if (!prev) return null;
      return { ...prev, follows: (prev.follows || []).filter(pk => pk !== pubkeyToRemove) };
    });
  };

  return (
    <ListContext.Provider
      value={{
        lists,
        selectedList,
        handleListSelected,
        fetchLatestContactList,
        unfollowContact,
        myTopics,
        addTopicToMyTopics,
        removeTopicFromMyTopics,
        bookmarkedPackKeys,
        bookmarkFollowPack,
        unbookmarkFollowPack,
        fetchAndHydratePacks,
        getNetworkFollowers,
        getTrustScore,
        rankByTrust,
        getFollowRecommendations,
        isFetchingWoT,
        wotProfileCount,
        wotLastComputed,
        recomputeWebOfTrust,
      }}
    >
      {children}
    </ListContext.Provider>
  );
}
