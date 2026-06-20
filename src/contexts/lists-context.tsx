import {
  ReactNode,
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Box, LinearProgress, Modal, Typography } from "@mui/material";
import { Event, EventTemplate, Filter } from "nostr-tools";
import { parseContacts, getATagFromEvent } from "../nostr";
import { useUserContext } from "../hooks/useUserContext";
import { useAppContext } from "../hooks/useAppContext";
import { User } from "./user-context";
import { dataLayer } from "@formstr/local-relay";
import { collectOnce } from "../dataLayer/collect";
import { signerManager } from "../singletons/Signer/SignerManager";

const WOT_STORAGE_KEY_PREFIX = `pollerama:webOfTrust`;
const WOT_TTL = 5 * 24 * 60 * 60 * 1000; // 5 days in milliseconds

// The web-of-trust "network index" maps every reachable pubkey to the subset of
// the user's own follows that follow them. It powers the "followed by … you
// follow" row on profiles. Persisted in a compact form that references each
// source (one of the user's follows) by integer index, keeping it small enough
// for localStorage even on large follow graphs.
type SerializedNetworkIndex = { follows: string[]; edges: Record<string, number[]> };

function serializeNetworkIndex(index: Map<string, Set<string>>): string {
  const follows: string[] = [];
  const followIdx = new Map<string, number>();
  const edges: Record<string, number[]> = {};
  index.forEach((sources, target) => {
    const arr: number[] = [];
    sources.forEach((src) => {
      let i = followIdx.get(src);
      if (i === undefined) {
        i = follows.length;
        follows.push(src);
        followIdx.set(src, i);
      }
      arr.push(i);
    });
    edges[target] = arr;
  });
  return JSON.stringify({ follows, edges });
}

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
  const wotInFlightRef = useRef(false);
  const wotAttemptedRef = useRef(false);
  // Standing interest in the user's own contact list (kind 3). Kept open so the
  // worker's upstream fetch can stream it in after the local EOSE.
  const contactHandleRef = useRef<{ unobserve: () => void } | null>(null);
  // pubkey -> set of the user's follows who follow them. Lives in a ref (large,
  // mutated incrementally); `wotIndexVersion` bumps to notify consumers.
  const networkIndexRef = useRef<Map<string, Set<string>>>(new Map());
  const [wotIndexVersion, setWotIndexVersion] = useState(0);
  // Blocking modal shown while the WoT is fetched/computed — the stream of
  // contact lists is heavy enough to make the UI janky, so we block instead.
  const [isFetchingWoT, setIsFetchingWoT] = useState(false);
  const [wotProfileCount, setWotProfileCount] = useState(0);
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
      wotInFlightRef.current = false;
      wotAttemptedRef.current = false;
      networkIndexRef.current = new Map();
      setWotIndexVersion((v) => v + 1);
      setIsFetchingWoT(false);
      setWotProfileCount(0);
    }
    prevPubkeyRef.current = next;
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
    const follows = await parseContacts(event);
    let a_tag = `${event.kind}:${event.pubkey}`;

    setLists((prevMap) => {
      const pastEvent = prevMap?.get(a_tag);

      // Only update if this event is newer than what we have
      if (event.created_at > (pastEvent?.created_at || 0)) {
        setUser((prevUser) => {
          if (!prevUser) return null;
          return {
            ...prevUser,
            follows: Array.from(follows),
          } as User;
        });
        const newMap = new Map(prevMap);
        newMap.set(a_tag, event);
        return newMap;
      }

      // Return unchanged map if this event is older
      return prevMap;
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

    const pubkey = user.pubkey;
    const unionKey = `${WOT_STORAGE_KEY_PREFIX}${pubkey}`;
    const timeKey = `${WOT_STORAGE_KEY_PREFIX}${pubkey}_time`;
    const indexKey = `${WOT_STORAGE_KEY_PREFIX}${pubkey}_index`;

    const storedTime = localStorage.getItem(timeKey);
    let cachedUnion: string[] | null = null;
    try {
      const raw = localStorage.getItem(unionKey);
      cachedUnion = raw ? JSON.parse(raw) : null;
    } catch {
      cachedUnion = null;
    }
    // Only trust a non-empty cache within TTL. An empty array is never a valid
    // result — treat it as a cache miss and re-fetch rather than leaving the
    // user with an empty web of trust for the next 5 days.
    const cacheValid =
      Array.isArray(cachedUnion) &&
      cachedUnion.length > 0 &&
      storedTime &&
      Date.now() - Number(storedTime) < WOT_TTL;

    if (cacheValid) {
      // The union set powers the "in your wider network" check — restore it now.
      setUser((prev: User | null) =>
        prev ? { ...prev, webOfTrust: new Set(cachedUnion!) } : null,
      );

      const storedIndex = localStorage.getItem(indexKey);
      if (storedIndex) {
        try {
          networkIndexRef.current = deserializeNetworkIndex(storedIndex);
          setWotIndexVersion((v) => v + 1);
          return; // Fully hydrated from cache — no network needed.
        } catch {
          // Corrupt index — fall through and rebuild it.
        }
      }
      // Existing flat-list user (cached union but no index): silently backfill
      // the index below. The union is already live, so this isn't user-visible.
    }

    // Background fetch: pull kind-3 lists from every follow and build both the
    // union set and the inverted "network index". We accumulate locally and only
    // commit once at EOSE — calling setUser per-event used to re-render the whole
    // app on each of up to 500 events and hang it, so it stays off the hot path.
    wotInFlightRef.current = true;
    setWotProfileCount(0);
    setIsFetchingWoT(true); // Block the UI — the contact-list stream is heavy.

    const filter: Filter = { kinds: [3], authors: user.follows, limit: 500 };
    // Seed the union with whatever we already have so a sparse fetch can only
    // ever add to the web of trust, never shrink it (e.g. a backfill that comes
    // back with fewer contact lists must not wipe a good cached union).
    const union = new Set<string>(cachedUnion ?? user.webOfTrust ?? []);
    const index = new Map<string, Set<string>>();
    let lastUiUpdate = 0;

    // Under the dataLayer contract the local EOSE fires before the worker's
    // upstream fetch returns the contact lists, so we can't commit on EOSE
    // (that would persist an empty/stale union and tear down the fetch). Instead
    // we keep the interest open and commit once the stream goes quiet, with a
    // hard cap so the blocking modal can never hang.
    let committed = false;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const commit = () => {
      if (committed) return;
      committed = true;
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      handle.unobserve();
      wotInFlightRef.current = false;
      setIsFetchingWoT(false);
      setWotProfileCount(union.size);

      // Don't persist an empty result — leave any existing cache intact so
      // the next session retries instead of being stuck empty.
      if (union.size > 0) {
        try {
          localStorage.setItem(unionKey, JSON.stringify(Array.from(union)));
          localStorage.setItem(timeKey, Date.now().toString());
          localStorage.setItem(indexKey, serializeNetworkIndex(index));
        } catch {
          // localStorage quota exceeded — keep the index in memory for this
          // session; it'll be recomputed next load.
        }
      }

      networkIndexRef.current = index;
      setWotIndexVersion((v) => v + 1);
      setUser((prev) =>
        prev ? ({ ...prev, webOfTrust: union } as User) : null,
      );
    };

    const handle = dataLayer.observe([filter], {
      onEvent: (event: Event) => {
        const source = event.pubkey; // one of the user's follows
        for (const tag of event.tags) {
          if (tag[0] === "p" && tag[1]) {
            const target = tag[1];
            union.add(target);
            let sources = index.get(target);
            if (!sources) {
              sources = new Set();
              index.set(target, sources);
            }
            sources.add(source);
          }
        }
        // Throttle progress updates so the modal doesn't re-render per event.
        const now = Date.now();
        if (now - lastUiUpdate > 200) {
          lastUiUpdate = now;
          setWotProfileCount(union.size);
        }
        // Commit ~1.5s after the stream goes quiet.
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(commit, 1500);
      },
    });

    // Hard cap: commit no later than 10s even if events keep dribbling in.
    const hardTimer = setTimeout(commit, 10000);

    return handle;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, myTopics, user]);

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
    <>
      <Modal open={isFetchingWoT} aria-labelledby="wot-modal-title">
        <Box
          sx={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: { xs: "85%", sm: 420 },
            maxWidth: "90vw",
            bgcolor: "background.paper",
            borderRadius: 2,
            boxShadow: 24,
            p: 4,
            outline: "none",
          }}
        >
          <Typography id="wot-modal-title" variant="h6" gutterBottom>
            Computing your web of trust
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Please wait while we analyze the people you follow. This powers your
            feeds and content moderation, and only happens occasionally.
          </Typography>
          <LinearProgress sx={{ mb: 1.5, borderRadius: 1, height: 8 }} />
          <Typography variant="caption" color="text.secondary">
            Loaded {wotProfileCount.toLocaleString()} profiles
          </Typography>
        </Box>
      </Modal>
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
        }}
      >
        {children}
      </ListContext.Provider>
    </>
  );
}
