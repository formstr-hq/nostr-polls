import { ReactNode, createContext, useEffect, useRef, useState } from "react";
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

interface ListContextInterface {
  lists: Map<string, Event> | undefined;
  selectedList: string | undefined;
  handleListSelected: (id: string | null) => void;
  fetchLatestContactList(): Promise<Event | null>;
  refetchContacts: () => void;
  unfollowContact(pubkeyToRemove: string): Promise<void>;
  myTopics: Set<string> | undefined;
  addTopicToMyTopics: (topic: string) => Promise<void>;
  removeTopicFromMyTopics: (topic: string) => Promise<void>;
  bookmarkedPackKeys: Set<string>;
  bookmarkFollowPack: (packEvent: Event) => Promise<void>;
  unbookmarkFollowPack: (packEvent: Event) => Promise<void>;
  fetchAndHydratePacks: (adrefs: string[]) => void;
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
  const [isFetchingWoT, setIsFetchingWoT] = useState(false);
  const prevPubkeyRef = useRef<string | undefined>(undefined);

  // Contact-list fetch state — retry-with-backoff so kind-3 always resolves
  // to either "populated" or "definitively empty" instead of "still undefined".
  const contactsHandleRef = useRef<{ unsubscribe: () => void } | null>(null);
  const contactsAttemptRef = useRef(0);
  const contactsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevPubkeyRef.current;
    const next = user?.pubkey;
    if (prev !== undefined && prev !== next) {
      setLists(undefined);
      setMyTopics(undefined);
      setMyTopicsEvent(undefined);
      setBookmarkedPackKeys(new Set());
      setBookmarks10003(null);
      setIsFetchingWoT(false);
      cleanupContactsFetch();
      contactsAttemptRef.current = 0;
    }
    prevPubkeyRef.current = next;
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

      // Only apply if this event is strictly newer than what we currently hold.
      // Guards against late/duplicate arrivals from multiple relays overwriting
      // a more recent contact list with a stale one.
      if (event.created_at <= (pastEvent?.created_at || 0)) return prevMap;

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
    });
  };

  // Tears down any in-flight contacts subscription + retry timer.
  const cleanupContactsFetch = () => {
    contactsHandleRef.current?.unsubscribe();
    contactsHandleRef.current = null;
    if (contactsTimerRef.current) clearTimeout(contactsTimerRef.current);
    contactsTimerRef.current = null;
  };

  // Runs one fetch attempt. If EOSE arrives with no event, retries once with
  // fresh:true. After the second EOSE-without-event we treat it as authoritative
  // "this pubkey has no kind-3" and set follows = [] so feeds can render an
  // empty state instead of spinning forever.
  const runContactsFetchAttempt = (useFresh: boolean) => {
    if (!user || !user.pubkey) return;
    cleanupContactsFetch();

    const pubkeyAtAttempt = user.pubkey;
    let receivedEvent = false;

    contactsHandleRef.current = nostrRuntime.subscribe(
      relays,
      [{ kinds: [3], authors: [pubkeyAtAttempt] }],
      {
        onEvent: (event: Event) => {
          receivedEvent = true;
          handleContactListEvent(event);
        },
        onEose: () => {
          // Buffer briefly so late-arriving events from slow relays still land.
          contactsTimerRef.current = setTimeout(() => {
            contactsHandleRef.current?.unsubscribe();
            contactsHandleRef.current = null;
            contactsTimerRef.current = null;
            if (receivedEvent) return;
            if (contactsAttemptRef.current < 2) {
              contactsAttemptRef.current += 1;
              runContactsFetchAttempt(true);
            } else {
              // Definitively no kind-3 — mark as checked-empty so feeds can
              // render an empty state and we don't retry on every effect run.
              setUser((prev) => {
                if (!prev || prev.pubkey !== pubkeyAtAttempt) return prev;
                return { ...prev, follows: [] } as User;
              });
            }
          }, 1500);
        },
        fresh: useFresh,
      }
    );
  };

  const fetchContacts = () => {
    contactsAttemptRef.current = 1;
    runContactsFetchAttempt(false);
  };

  const refetchContacts = () => {
    contactsAttemptRef.current = 1;
    runContactsFetchAttempt(true);
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

    const storedWoT = localStorage.getItem(
      `${WOT_STORAGE_KEY_PREFIX}${user.pubkey}`,
    );
    const storedTime = localStorage.getItem(
      `${WOT_STORAGE_KEY_PREFIX}${user.pubkey}_time`,
    );
    const currentTime = new Date().getTime();

    // Use cached WoT if within TTL (5 days)
    if (storedWoT && storedTime && currentTime - Number(storedTime) < WOT_TTL) {
      setUser((prev: User | null) => {
        if (!prev) return null;
        return {
          ...prev,
          webOfTrust: new Set(JSON.parse(storedWoT) || []),
        };
      });
      return;
    }

    setIsFetchingWoT(true); // Show warning that WoT is being fetched

    const filter: Filter = {
      kinds: [3],
      authors: user.follows,
      limit: 500,
    };

    const handle = nostrRuntime.subscribe(relays, [filter], {
      onEvent: (event: Event) => {
        const newPubkeys = event.tags
          .filter((tag) => tag[0] === "p" && tag[1])
          .map((tag) => tag[1]);

        setUser((prev) => {
          if (!prev) return null;

          const prevTrust = prev.webOfTrust ?? new Set<string>();
          const newSet = new Set([...Array.from(prevTrust), ...newPubkeys]);

          // Store in localStorage with 5-day TTL
          localStorage.setItem(
            `${WOT_STORAGE_KEY_PREFIX}${user.pubkey}`,
            JSON.stringify(Array.from(newSet)),
          );
          const currentTime = new Date().getTime();
          localStorage.setItem(
            `${WOT_STORAGE_KEY_PREFIX}${user.pubkey}_time`,
            currentTime.toString(),
          );
          return {
            ...prev,
            webOfTrust: newSet,
          } as User;
        });
      },
      onEose() {
        handle.unsubscribe();
        setIsFetchingWoT(false); // Hide warning after fetching
      },
    });

    return handle;
  };

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
      // Only kick off the fetch when we have no signal yet (follows === undefined).
      // After the retry loop resolves, follows is either populated or [] — both
      // are terminal states we shouldn't refetch from on every render.
      if (user.follows === undefined && !contactsHandleRef.current) fetchContacts();
      if (!user.webOfTrust || user.webOfTrust.size === 0) subscribeToContacts();
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
      {isFetchingWoT && (
        <div className="warning">
          fetching web of trust... may take a few seconds..
        </div>
      )}
      <ListContext.Provider
        value={{
          lists,
          selectedList,
          handleListSelected,
          fetchLatestContactList,
          refetchContacts,
          unfollowContact,
          myTopics,
          addTopicToMyTopics,
          removeTopicFromMyTopics,
          bookmarkedPackKeys,
          bookmarkFollowPack,
          unbookmarkFollowPack,
          fetchAndHydratePacks,
        }}
      >
        {children}
      </ListContext.Provider>
    </>
  );
}
