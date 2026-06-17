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
import { useRelays } from "../hooks/useRelays";
import { useUserContext } from "../hooks/useUserContext";
import { useAppContext } from "../hooks/useAppContext";
import { User } from "./user-context";
import { nostrRuntime } from "../singletons";
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
  const { relays } = useRelays();
  const { profiles, fetchUserProfileThrottled } = useAppContext();
  const wotInFlightRef = useRef(false);
  const wotAttemptedRef = useRef(false);
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
      const handle = nostrRuntime.subscribe(relays, [filter], {
        onEvent(event: Event) {
          // Keep track of the most recent event
          if (!latestEvent || event.created_at > latestEvent.created_at) {
            latestEvent = event;
          }
        },
      });
      setTimeout(() => {
        handle.unsubscribe();
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
    let contactListFilter = {
      kinds: [3],
      authors: [user.pubkey],
    };
    const contactHandle = nostrRuntime.subscribe(relays, [contactListFilter], {
      onEvent: (event: Event) => {
        handleContactListEvent(event);
      },
      onEose: () => contactHandle.unsubscribe(),
    });
  };

  const fetchLists = () => {
    // Packs I created
    const myPacksHandle = nostrRuntime.subscribe(relays, [{ kinds: [39089], limit: 100, authors: [user!.pubkey] }], {
      onEvent: handleListEvent,
      onEose: () => myPacksHandle.unsubscribe(),
    });
    // Packs I'm mentioned in
    const mentionedPacksHandle = nostrRuntime.subscribe(relays, [{ kinds: [39089], limit: 100, "#p": [user!.pubkey] }], {
      onEvent: handleListEvent,
      onEose: () => mentionedPacksHandle.unsubscribe(),
    });
  };

  const fetchAndHydratePacks = (adrefs: string[]) => {
    adrefs.forEach((adref) => {
      const parts = adref.split(":");
      const pubkey = parts[1];
      const identifier = parts.slice(2).join(":");
      if (!pubkey) return;
      const packHandle = nostrRuntime.subscribe(
        relays,
        [{ kinds: [39089], authors: [pubkey], "#d": [identifier], limit: 1 }],
        { onEvent: handleListEvent, onEose: () => packHandle.unsubscribe() }
      );
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
    const bookmarksHandle = nostrRuntime.subscribe(relays, [{ kinds: [10003], authors: [user.pubkey], limit: 1 }], {
      onEvent: (event) => {
        setBookmarks10003((prev) => {
          if (!prev || event.created_at > prev.created_at) {
            processBookmarksEvent(event);
            return event;
          }
          return prev;
        });
      },
      onEose: () => bookmarksHandle.unsubscribe(),
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
    await Promise.allSettled(nostrRuntime.publish(relays, signed));
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

    const handle = nostrRuntime.subscribe(relays, [filter], {
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
      },
      onEose() {
        handle.unsubscribe();
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
      },
    });

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

    const filter: Filter = {
      kinds: [10015],
      authors: [user.pubkey],
      limit: 1,
    };

    return new Promise<void>((resolve) => {
      const handle = nostrRuntime.subscribe(relays, [filter], {
        onEvent: async (event: Event) => {
          if (myTopicsEvent && event.created_at <= myTopicsEvent.created_at)
            return;
          setMyTopicsEvent(event);
          processMyTopicsFromEvent(event);
        },
        onEose: () => {
          handle.unsubscribe();
          resolve();
        },
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        handle.unsubscribe();
        if (!myTopicsEvent) {
          setMyTopicsEvent(null);
        }
        resolve();
      }, 10000);
    });
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
    if (!nostrRuntime) return;
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

  const addTopicToMyTopics = async (topic: string): Promise<void> => {
    const signer = await signerManager.getSigner();
    if (!signer) throw Error("No signer available");

    const pubkey = await signer.getPublicKey();

    // Fetch existing kind 10015 event
    const filter = {
      kinds: [10015],
      authors: [pubkey],
      limit: 1,
    };

    let existingEvent: Event | null = null;

    return new Promise((resolve, reject) => {
      const handle = nostrRuntime.subscribe(relays, [filter], {
        onEvent: (event) => {
          existingEvent = event;
        },
        onEose: async () => {
          handle.unsubscribe();
          try {
            const tags = existingEvent?.tags ?? [];

            // Check if topic already exists
            const topicExists = tags.some(
              (tag) => tag[0] === "t" && tag[1] === topic,
            );
            if (topicExists) {
              resolve();
              return;
            }

            // Add the new topic tag
            const newTags = [...tags, ["t", topic]];

            const eventTemplate: EventTemplate = {
              kind: 10015,
              created_at: Math.floor(Date.now() / 1000),
              tags: newTags,
              content: existingEvent?.content ?? "",
            };

            const signed = await signer.signEvent(eventTemplate);
            await Promise.allSettled(nostrRuntime.publish(relays, signed));
            processMyTopicsFromEvent(signed);
            fetchMyTopics();
            resolve();
          } catch (error) {
            reject(error);
          }
        },
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        handle.unsubscribe();
        if (!existingEvent) {
          // Create new event if none exists
          handleNewEvent();
        }
      }, 5000);

      async function handleNewEvent() {
        try {
          const eventTemplate: EventTemplate = {
            kind: 10015,
            created_at: Math.floor(Date.now() / 1000),
            tags: [["t", topic]],
            content: "",
          };

          const signed = await signer.signEvent(eventTemplate);
          await Promise.allSettled(nostrRuntime.publish(relays, signed));
          processMyTopicsFromEvent(signed);
          fetchMyTopics();
          resolve();
        } catch (error) {
          reject(error);
        }
      }
    });
  };
  const removeTopicFromMyTopics = async (topic: string): Promise<void> => {
    const signer = await signerManager.getSigner();
    if (!signer) throw Error("No signer available");

    const pubkey = await signer.getPublicKey();

    const filter: Filter = {
      kinds: [10015],
      authors: [pubkey],
      limit: 1,
    };

    let existingEvent: Event | null = null;

    return new Promise((resolve, reject) => {
      const handle = nostrRuntime.subscribe(relays, [filter], {
        onEvent: (event) => {
          existingEvent = event;
        },
        onEose: async () => {
          handle.unsubscribe();
          try {
            const oldTags = existingEvent?.tags ?? [];

            // Filter out the topic tag
            const newTags = oldTags.filter(
              (tag) => !(tag[0] === "t" && tag[1] === topic),
            );

            // If nothing changed, exit
            if (newTags.length === oldTags.length) {
              resolve();
              return;
            }

            const eventTemplate: EventTemplate = {
              kind: 10015,
              created_at: Math.floor(Date.now() / 1000),
              tags: newTags,
              content: existingEvent?.content ?? "",
            };

            const signed = await signer.signEvent(eventTemplate);
            await Promise.allSettled(nostrRuntime.publish(relays, signed));

            // Update local state immediately
            processMyTopicsFromEvent(signed);
            fetchMyTopics();

            resolve();
          } catch (error) {
            reject(error);
          }
        },
      });

      setTimeout(() => {
        handle.unsubscribe();
        resolve(); // No existing event → nothing to remove
      }, 5000);
    });
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
    await Promise.allSettled(nostrRuntime.publish(relays, signed));
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
